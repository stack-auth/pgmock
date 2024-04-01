import { Ipv4Address } from "../addresses/ip-address.js";
import { MacAddress } from "../addresses/mac-address.js";
import { Logger } from "../logger.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { tcpChecksum } from "../utils/internet-checksum.js";
import { isZeroIn16BitsOnesComplement } from "../utils/ones-complement.js";
import { wait } from "../utils/wait.js";
import { Ipv4Data } from "./ipv4.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";
import nodecrypto from "crypto";

export type TcpFrame = Ipv4Data;
export type TcpData = never;

export type TcpHandler<T extends Tcp> = ProtocolHandler<T> & {
  connect(srcIp: Ipv4Address, destIp: Ipv4Address, srcPort: number, destPort: number): TcpSocket,
  listen(serverIp: Ipv4Address, serverPort: number, callback: (socket: TcpSocket) => void): void,
  listenExact(serverIp: Ipv4Address, clientIp: Ipv4Address, serverPort: number, clientPort: number): TcpSocket,
};

type SubProtocol = SubProtocolFor<Tcp>;

const handlerPrivateMethodsSymbol = Symbol("handlerPrivateMethods");


export class Tcp<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<TcpFrame, TcpData, TcpFrame, TcpData, SubProtocols> {
  public readonly displayName = "TCP";
  public readonly ipProtocolNumber = 0x06;  // TCP

  public constructor(options: Partial<ProtocolOptions<SubProtocols>>) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<TcpFrame, TcpData, TcpFrame, TcpData>): TcpHandler<this> {
    const tcpSockets = new Map<string, TcpSocket>();
    const listeners = new Map<string, (socket: TcpSocket) => void>();

    const registerSocket = (socket: TcpSocket) => {
      if (tcpSockets.has(socket.connectionString!)) {
        throw new Error(`TcpSocket with connection string ${socket.connectionString} already exists`);
      }
      tcpSockets.set(socket.connectionString!, socket);
      socket[handlerPrivateMethodsSymbol].onSendPacketCallbacks.push((packet) => {
        const headerSize = 20 + (packet.options?.length ?? 0);
        Logger.log("Network adapter sending TCP packet:", { packet, headerSize });
        const tcpPacketBinary = new Uint8Array([
          ...toBigEndianFromInt(2, packet.srcPort),
          ...toBigEndianFromInt(2, packet.destPort),
          ...toBigEndianFromInt(4, packet.seq),
          ...toBigEndianFromInt(4, packet.ack),
          (
            (headerSize / 4) << 4  // data offset
            | (packet.flags["ns (deprecated)"] ? 0x01 : 0x00)  // ns flag/reserved
          ),   
          (  // flags
            (packet.flags.cwr ? 0x80 : 0x00)
            | (packet.flags.ece ? 0x40 : 0x00)
            | (packet.flags.urg ? 0x20 : 0x00)
            | (packet.flags.ack ? 0x10 : 0x00)
            | (packet.flags.psh ? 0x08 : 0x00)
            | (packet.flags.rst ? 0x04 : 0x00)
            | (packet.flags.syn ? 0x02 : 0x00)
            | (packet.flags.fin ? 0x01 : 0x00)
          ),
          ...toBigEndianFromInt(2, packet.windowSize || 0xffff),
          ...toBigEndianFromInt(2, 0x0),  // checksum, we will fill this later
          ...toBigEndianFromInt(2, packet.urgentPointer ?? 0x0),
          ...packet.options ?? [],
          ...packet.data,
        ]);
        const checksumField = ~tcpChecksum(packet.srcIp, packet.destIp, tcpPacketBinary);
        tcpPacketBinary[16] = checksumField >> 8;
        tcpPacketBinary[17] = checksumField & 0xff;

        context.sendFrame({
          srcIp: packet.srcIp,
          destIp: packet.destIp,
          protocol: this.ipProtocolNumber,
          payload: tcpPacketBinary,
          flags: {
            dontFragment: true,
          },
          dscp: 0,
          ecn: 0,
          timeToLive: 64,
        });
      });
    }

    context.onProcessFrame((frame) => {
      if (frame.protocol !== this.ipProtocolNumber) {
        return { consumed: false };
      }

      const dataOffset = frame.payload[12] >> 4;
      const tcpPacket: TcpPacket = {
        srcIp: frame.srcIp,
        destIp: frame.destIp,
        srcPort: toUnsignedIntFromBigEndian(frame.payload.slice(0, 2)),
        destPort: toUnsignedIntFromBigEndian(frame.payload.slice(2, 4)),
        seq: toUnsignedIntFromBigEndian(frame.payload.slice(4, 8)),
        ack: toUnsignedIntFromBigEndian(frame.payload.slice(8, 12)),
        flags: {
          "ns (deprecated)": !!(frame.payload[12] & 0x01),
          cwr: !!(frame.payload[13] & 0x80),
          ece: !!(frame.payload[13] & 0x40),
          urg: !!(frame.payload[13] & 0x20),
          ack: !!(frame.payload[13] & 0x10),
          psh: !!(frame.payload[13] & 0x08),
          rst: !!(frame.payload[13] & 0x04),
          syn: !!(frame.payload[13] & 0x02),
          fin: !!(frame.payload[13] & 0x01),
        },
        windowSize: toUnsignedIntFromBigEndian(frame.payload.slice(14, 16)),
        urgentPointer: toUnsignedIntFromBigEndian(frame.payload.slice(18, 20)),
        options: frame.payload.slice(20, dataOffset * 4),
        data: frame.payload.slice(dataOffset * 4),
      };
      const checksumField = toUnsignedIntFromBigEndian(frame.payload.slice(16, 18));
      const connectionKey = connectionString(tcpPacket.destIp, tcpPacket.srcIp, tcpPacket.destPort, tcpPacket.srcPort);

      Logger.log("Network adapter received TCP packet:", { tcpPacket, connectionKey });

      const tcpc = tcpChecksum(tcpPacket.srcIp, tcpPacket.destIp, frame.payload);
      if (!isZeroIn16BitsOnesComplement(tcpc)) {
        Logger.warn(`Network adapter received packet with invalid TCP checksum ${tcpc}, ignoring it`);
        return { consumed: true };
      }

      let socket = tcpSockets.get(connectionKey);
      if (!socket || socket.isClosed()) {
        if (listeners.has(`${tcpPacket.destIp}:${tcpPacket.destPort}`)) {
          const listenerCallback = listeners.get(`${tcpPacket.destIp}:${tcpPacket.destPort}`)!;
          socket = new TcpSocket(true, tcpPacket.destIp, tcpPacket.srcIp, tcpPacket.destPort, tcpPacket.srcPort);
          registerSocket(socket);
          socket[handlerPrivateMethodsSymbol].listen();
          listenerCallback(socket);
        }
      }
      if (socket) {
        socket[handlerPrivateMethodsSymbol].process(tcpPacket);
      }

      return { consumed: true };
    });

    return {
      ...base,
      connect: (srcIp: Ipv4Address, destIp: Ipv4Address, srcPort: number, destPort: number) => {
        const socket = new TcpSocket(false, srcIp, destIp, srcPort, destPort);
        registerSocket(socket);
        socket[handlerPrivateMethodsSymbol].connect();
        return socket;
      },
      listen: (serverIp: Ipv4Address, serverPort: number, callback: (socket: TcpSocket) => void) => {
        const key = `${serverIp}:${serverPort}`;
        if (listeners.has(key)) {
          throw new Error(`Tcp.listen() called on already listening address-port pair ${key}`);
        }
        listeners.set(key, callback);
      },
      listenExact: (serverIp: Ipv4Address, clientIp: Ipv4Address, serverPort: number, clientPort: number) => {
        const socket = new TcpSocket(true, serverIp, clientIp, serverPort, clientPort);
        registerSocket(socket);
        socket[handlerPrivateMethodsSymbol].listen();
        return socket;
      }
    };
  }
}

function connectionString(srcIp: Ipv4Address, destIp: Ipv4Address, srcPort: number, destPort: number) {
  return `${srcIp}:${srcPort} -> ${destIp}:${destPort}`;
}

type TcpPacket = {
  srcIp: Ipv4Address;
  destIp: Ipv4Address;
  srcPort: number;
  destPort: number;
  seq: number;
  ack: number;
  flags: {
    "ns (deprecated)"?: boolean;
    cwr?: boolean;
    ece?: boolean;
    urg?: boolean;
    ack?: boolean;
    psh?: boolean;
    rst?: boolean;
    syn?: boolean;
    fin?: boolean;
  };
  windowSize?: number;
  urgentPointer?: number;
  options?: Uint8Array;
  data: Uint8Array;
};


export class TcpSocket {
  private _state: "INIT" | "LISTEN" | "SYN_SENT" | "SYN_RECEIVED" | "ESTABLISHED" | "CLOSED" = "INIT";
  private _seq: number;
  private _ack: number = 0;
  private _onDataCallbacks: ((data: TcpPacket) => void)[] = [];
  private _onEstablishedCallbacks: (() => void)[] = [];
  private _onCloseCallbacks: (() => void)[] = [];
  private _sentPacketsUnacknowledged: TcpPacket[] = [];
  private _receivedPacketsUnacknowledged: TcpPacket[] = [];
  private _writeOnceEstablished: Uint8Array[] = [];

  constructor(
    public readonly isServer: boolean,
    public readonly srcIp: Ipv4Address,
    public readonly destIp: Ipv4Address,
    public readonly srcPort: number,
    public readonly destPort: number,
  ) {
    this._seq = Math.floor((nodecrypto.randomBytes(4).readInt32BE(0) & 0x3fffffff) / 100) * 100;
  }

  protected _onDataCallback(data: TcpPacket) {
    for (const callback of this._onDataCallbacks) {
      callback(data);
    }
  }

  onData(callback: (data: Uint8Array) => void) {
    this._onDataCallbacks.push((packet) => callback(packet.data));
  }

  protected _onEstablishedCallback() {
    for (const data of this._writeOnceEstablished.splice(0)) {
      this.write(data);
    }

    for (const callback of this._onEstablishedCallbacks) {
      callback();
    }
  }

  onEstablished(callback: () => void) {
    this._onEstablishedCallbacks.push(callback);
  }

  protected _onCloseCallback() {
    for (const callback of this._onCloseCallbacks) {
      callback();
    }
  }

  onClose(callback: () => void) {
    this._onCloseCallbacks.push(callback);
  }

  writeUtf8(text: string) {
    this.write(new TextEncoder().encode(text));
  }

  write(data: Uint8Array) {
    if (this._state !== "ESTABLISHED") {
      this._writeOnceEstablished.push(data);
      return;
    }

    // 1200 bytes is enough so we won't need any IP fragmentation (which is currently unimplemented)
    // Ethernet is limited at 1500 bytes and there's some overhead in IP and TCP headers
    for (let i = 0; i < data.length; i += 1200) {
      this._writeSinglePacket(data.slice(i, i + 1200));
    }
  }

  private _writeSinglePacket(data: Uint8Array) {
    if (this._state !== "ESTABLISHED") {
      throw new Error("TcpSocket.write() called in invalid state");
    }

    this._sendPacket(data.length, {
      seq: this._seq,
      ack: this._ack,
      flags: {
        ack: true,
      },
      data,
    });
  }

  private _sendPacket(seqIncrement: number, packet: Omit<TcpPacket, "srcIp" | "destIp" | "srcPort" | "destPort">) {
    const tcpPacket = {
      srcIp: this.srcIp,
      destIp: this.destIp,
      srcPort: this.srcPort,
      destPort: this.destPort,
      ...packet,
    };
    this._seq += seqIncrement;  // TODO what if seq overflows int32?
    this._sentPacketsUnacknowledged.push(tcpPacket);

    (async () => {
      let timeout = 3000;
      for (let i = 1; i <= 10; i++) {
        Logger.log(`TcpSocket sending packet (${i}-th try)`, { tcpPacket, socket: this });
        this[handlerPrivateMethodsSymbol].onSendPacketCallback(tcpPacket);
        await wait(timeout);

        if (tcpPacket.data.length === 0 && !tcpPacket.flags.syn && !tcpPacket.flags.fin) {
          // no ack expected
          return;
        }
        if (!this._sentPacketsUnacknowledged.includes(tcpPacket)) {
          return;
        }

        timeout *= 1 + Math.random() * 0.6;
        Logger.log(`Timeout waiting for ack (${i}-th try)`, { tcpPacket, timeout });
      }
      Logger.error("Timeout waiting for ack; TcpSocket giving up", tcpPacket);
      this.close();
    })();
  }

  close() {
    // TODO termination protocol (kind of important)
    this._state = "CLOSED";
    this._onCloseCallback();
  }

  isInitialized() {
    return this._state !== "INIT";
  }

  isClosed() {
    return this._state === "CLOSED";
  }

  get connectionString() {
    let [aIp, bIp, aPort, bPort] = [this.srcIp, this.destIp, this.srcPort, this.destPort];
    return connectionString(aIp, bIp, aPort, bPort);
  }

  [handlerPrivateMethodsSymbol] = {
    onSendPacketCallbacks: [] as ((data: TcpPacket) => void)[],
    onSendPacketCallback: (packet: TcpPacket) => {
      for (const callback of this[handlerPrivateMethodsSymbol].onSendPacketCallbacks) {
        callback(packet);
      }
    },

    listen: () => {
      if (this._state !== "INIT") {
        throw new Error("TcpSocket.listen() called in invalid state");
      }
      if (!this.isServer) {
        throw new Error("TcpSocket.listen() called on client socket");
      }

      this._state = "LISTEN";
    },
  
    connect: () => {
      if (this._state !== "INIT") {
        throw new Error("TcpSocket.connect() called in invalid state");
      }
      if (this.isServer) {
        throw new Error("TcpSocket.connect() called on server socket");
      }
  
      this._state = "SYN_SENT";
      const packet = {
        seq: this._seq,
        ack: 0,
        flags: {
          syn: true,
        },
        data: new Uint8Array(0),
      };
      this._sendPacket(1, packet);
    },

    process: (tcpPacket: TcpPacket) => {
      if (this._state === "INIT") {
        throw new Error("TcpSocket.process() called in invalid state");
      }

      Logger.log("TcpSocket processing packet", { tcpPacket, socket: this });

      if (tcpPacket.srcIp.equals(this.srcIp) && tcpPacket.srcPort === this.srcPort) {
        Logger.log("This is our own packet, ignoring it");
        return;
      }
      if (!tcpPacket.destIp.equals(this.srcIp) || tcpPacket.destPort !== this.srcPort) {
        throw new Error("TcpSocket.process() called with packet that is neither from nor for this socket");
      }

      if (tcpPacket.flags.fin) {
        this.close();
        return;
      }

      if (tcpPacket.flags.ack) {
        this._sentPacketsUnacknowledged = this._sentPacketsUnacknowledged.filter((packet) => packet.seq + packet.data.length > tcpPacket.ack);
      }

      switch (this._state) {
        case "LISTEN": {
          if (tcpPacket.flags.syn) {
            this._state = "SYN_RECEIVED";
            this._ack = tcpPacket.seq + 1;
            this._sendPacket(1, {
              seq: this._seq,
              ack: this._ack,
              flags: {
                syn: true,
                ack: true,
              },
              data: new Uint8Array(0),
            });
          }
          break;
        }
        case "SYN_RECEIVED": {
          if (tcpPacket.flags.ack) {
            this._state = "ESTABLISHED";
            setTimeout(() => this._onEstablishedCallback(), 0);
          }
          break;
        }
        case "SYN_SENT": {
          if (tcpPacket.flags.syn && tcpPacket.flags.ack) {
            this._state = "ESTABLISHED";
            this._ack = tcpPacket.seq + 1;
            this._sendPacket(0, {
              seq: this._seq,
              ack: this._ack,
              flags: {
                ack: true,
              },
              data: new Uint8Array(0),
            });
            setTimeout(() => this._onEstablishedCallback(), 0);
          }
          break;
        }
        case "ESTABLISHED": {
          // TODO DupAck retries

          Logger.log("TcpSocket received packet while in ESTABLISHED state", { tcpPacket, socket: this });

          if (this._writeOnceEstablished.length > 0) {
            throw new Error("Assertion error; writeOnceEstablished should be empty in ESTABLISHED state. This is a bug in pgmock.");
          }

          this._receivedPacketsUnacknowledged.push(tcpPacket);
          let mustAcknowledge = false;
          while (true) {
            const packet = this._receivedPacketsUnacknowledged.find((packet) => packet.seq <= this._ack);
            if (!packet) {
              break;
            }
            this._receivedPacketsUnacknowledged = this._receivedPacketsUnacknowledged.filter((p) => packet !== p); 
            if (packet.seq < this._ack) {
              Logger.log("TcpSocket received packet with seq that we already acknowledged (is it a keepalive, or did our acknowledgment die?). Acknowledging it again but not processing it further", { packet, socket: this });
              mustAcknowledge = true;  // we always acknowledge even if length === 0 so we respond correctly to TCP keepalives
              if (packet.seq + packet.data.length > this._ack) {
                Logger.warn("Something about the received seq numbers is wrong! Continuing as normal, but make sure the counterparty implementation is correct.", { packet, socket: this });
              }
            } else {
              this._ack += packet.data.length;
              if (packet.data.length > 0) {
                this._onDataCallback(packet);
                mustAcknowledge = true;
              }
            }
          }
          if (mustAcknowledge) {
            this._sendPacket(0, {
              seq: this._seq,
              ack: this._ack,
              flags: {
                ack: true,
              },
              data: new Uint8Array(0),
            });
          }
          break;
        }
        case "CLOSED": {
          // we're already closed, let's just ignore
          break;
        }
        default: {
          throw new Error("Unknown TcpSocket state " + this._state);
        }
      }
    },
  };
}
