import { Ipv4Address } from "./addresses/ip-address.js";
import { MacAddress } from "./addresses/mac-address.js";
import { Logger } from "./logger.js";
import { Arp } from "./protocols/arp.js";
import { Dhcp } from "./protocols/dhcp.js";
import { Ethernet, EthernetData } from "./protocols/ethernet.js";
import { Icmp } from "./protocols/icmp.js";
import { Ipv4 } from "./protocols/ipv4.js";
import { Noop } from "./protocols/noop.js";
import { AnyProtocol, Protocol, ProtocolHandler } from "./protocols/protocol.js";
import { Tcp } from "./protocols/tcp.js";
import { Udp } from "./protocols/udp.js";
import { Router } from "./routers/router.js";
import { CallbackEventTarget } from "./utils/callback-event-target.js";
import { toBigEndianFromInt } from "./utils/endianness.js";
import { throwErr } from "./utils/errors.js";

function createProtocol(router: Router) {
  return new Ethernet({
    protocols: {
      arp: new Arp({
        protocols: {
          routerArp: new Router.ArpImplementation(router),
        },
      }),
      ipv4: new Ipv4({
        router,
        protocols: {
          icmp: new Icmp({
            pingServer: new Ipv4Address("192.168.13.37"),
          }),
          tcp: new Tcp({}),
          udp: new Udp({
            protocols: {
              dhcp: new Dhcp({
                protocols: {
                  routerDhcp: new Router.DhcpImplementation(router),
                },
              }),
            }
          }),
        },
      }),
      ipv6: new Noop({
        consumeIf: (frame: EthernetData) => frame.etherType === 0x86DD,
        consoleMessage: `Received IPv6 packet. Currently unsupported, hence dropped so the sender retries with IPv4`,
      }),
    },
  });
}



export class NetworkAdapter {
  private readonly _onReceiveCallbacks: ((data: Uint8Array) => void)[] = [];
  private _ethernet: ReturnType<ReturnType<typeof createProtocol>["createHandler"]> | null;
  private _router: Router | null;
  private _isDestroyed = false;

  get ethernet() {
    this.checkNotDestroyed();
    return this._ethernet ?? throwErr("_ethernet is null but adapter not yet destroyed? this shouldn't happen");
  }

  get router() {
    this.checkNotDestroyed();
    return this._router ?? throwErr("_router is null but adapter not yet destroyed? this shouldn't happen");
  }

  constructor(private _bus: any) {
    Logger.log("Creating new network adapter", this);

    this._router = new Router({
      mac: new MacAddress([0x00, 0x0c, 0x13, 0x37, 0x42, 0x69]),
      ip: new Ipv4Address([192, 168, 13, 37]),
      subnetMask: new Ipv4Address([255, 255, 0, 0]),
    });
    const ethernetProtocol = createProtocol(this.router);

    const createHandlersRecursively = <T extends AnyProtocol>(
      protocol: T,
      context: {
        onProcessFrame: (callback: (frame: any) => { consumed: boolean }) => void,
        sendFrame: (frame: any) => void,
      },
    ): ReturnType<T["createHandler"]> => {
      const subProtocols = Object.entries(protocol.options.protocols) as [string, AnyProtocol][];

      const processDataTarget = new CallbackEventTarget<any | never, { consumed: boolean }, AnyProtocol | null>();
      const sendDataTarget = new CallbackEventTarget<any | never>();
      const processFrameTarget = new CallbackEventTarget<any | never, { consumed: boolean }>();
      const sendFrameTarget = new CallbackEventTarget<any | never>();

      context.onProcessFrame((frame) => {
        const results = processFrameTarget.emit(frame);
        return {
          consumed: results.some((r) => r.result.consumed),
        };
      });

      sendFrameTarget.addListener((frame) => {
        context.sendFrame(frame);
      });

      const protocolHandlers: [string, ProtocolHandler<AnyProtocol>][] = [];
      for (const [name, subProtocol] of subProtocols) {
        const subHandler = createHandlersRecursively(
          subProtocol,
          {
            onProcessFrame: (cb) => processDataTarget.addListener(cb, subProtocol),
            sendFrame: (frame: any) => {
              Logger.group(`📤 ${protocol.displayName} protocol created frame to send`);
              Logger.log({ frame, protocol });
              try {
                sendDataTarget.emit(frame);
              } finally {
                Logger.groupEnd();
              }
            },
          },
        );
        protocolHandlers.push([name, subHandler]);
      }
      const handler = protocol.createHandler(
        {
          protocols: Object.fromEntries(protocolHandlers) as any,
          onReceiveFrame: (callback) => {
            const listener = processFrameTarget.addListener(
              (data) => (callback(data as never), { consumed: false }),
            );
            return () => listener.remove();
          },
          onReceiveData: (callback) => {
            const listener = processDataTarget.addListener(
              (data) => (callback(data as never), { consumed: false }),
              null,
            );
            return () => listener.remove();
          },
          onSendFrame: (callback) => {
            const listener = sendFrameTarget.addListener(callback);
            return () => listener.remove();
          },
          onSendData: (callback) => {
            const listener = sendDataTarget.addListener(callback as any);
            return () => listener.remove();
          },
          destroy: () => {
            processFrameTarget.removeAllListeners();
            processDataTarget.removeAllListeners();
            sendFrameTarget.removeAllListeners();
            sendDataTarget.removeAllListeners();
            for (const [, subHandler] of protocolHandlers) {
              subHandler.destroy();
            }
          },
        },
        {
          onProcessFrame: context.onProcessFrame,
          sendFrame: context.sendFrame,
          processData: (data) => {
            Logger.group(`📥 ${protocol.displayName} protocol created data to process`);
            Logger.log({ data, protocol });
            try {
              const callbackResults = processDataTarget.emit(data);
              let isConsumed = callbackResults.some((r) => r.result.consumed);
              if (!isConsumed) {
                Logger.warn(`Unconsumed data created by ${protocol.displayName} protocol, most likely the subprotocol is not supported`, { data, protocol, callbackResults });
              }
            } finally {
              Logger.groupEnd();
            }
          },
          onSendData: (cb) => sendDataTarget.addListener(cb as any),
        },
      );
      return handler as any;
    };
    this._ethernet = createHandlersRecursively(ethernetProtocol, {
      onProcessFrame: (callback) => {
        this._onReceiveCallbacks.push(callback);
      },
      sendFrame: (frame) => {
        this.send(frame);
      },
    });

    this._bus.register("net0-send", (data: Iterable<number>) => {
      this.onReceive(new Uint8Array(data));
    }, this);
  }

  onReceive(data: Uint8Array) {
    this.checkNotDestroyed();

    for (const callback of this._onReceiveCallbacks) {
      callback(data);
    }
  }

  send(data: Uint8Array) {
    this.checkNotDestroyed();

    this._bus.send("net0-receive", new Uint8Array(data));
    this.onReceive(data);
  }

  startCapture(): {
    stop: () => { pcapData: Uint8Array },
  } {
    this.checkNotDestroyed();

    const frames: Uint8Array[] = [
      new Uint8Array([
        ...toBigEndianFromInt(4, 0xA1B2C3D4),  // magic number (little endian, microsecond resolution)
        ...toBigEndianFromInt(2, 0x0002),  // major version
        ...toBigEndianFromInt(2, 0x0004),  // minor version
        ...toBigEndianFromInt(4, 0x00000000),  // timezone offset (deprecated)
        ...toBigEndianFromInt(4, 0x00000000),  // timestamp accuracy (deprecated)
        ...toBigEndianFromInt(4, 0xFFFFFFFF),  // snapshot length
        ...toBigEndianFromInt(2, 0x0000),  // no FCS
        ...toBigEndianFromInt(2, 0x0001),  // Ethernet link type
      ]),
    ];
    const stop = this.ethernet.onReceiveFrame((frame) => {
      const date = new Date();
      frames.push(new Uint8Array([
        ...toBigEndianFromInt(4, Math.floor(date.getTime() / 1000)),  // timestamp seconds
        ...toBigEndianFromInt(4, (date.getTime() % 1000) * 1000),  // timestamp microseconds
        ...toBigEndianFromInt(4, frame.length),  // captured length
        ...toBigEndianFromInt(4, frame.length),  // original length
        ...frame,
      ]));
    });

    return {
      stop: () => {
        stop();
        const pcapData = new Uint8Array(frames.flatMap((f) => [...f]));
        return {
          pcapData,
        };
      },
    };
  }

  destroy() {
    this.checkNotDestroyed();

    this.ethernet.destroy();
    this._onReceiveCallbacks.length = 0;

    this._isDestroyed = true;
    this._bus = null;
    this._ethernet = null;
    this._router = null;
  } 

  checkNotDestroyed() {
    if (this._isDestroyed) {
      throw new Error("Network adapter has already been destroyed");
    }
  }
}
