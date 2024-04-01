import { Ipv4Address } from "../addresses/ip-address.js";
import { MacAddress } from "../addresses/mac-address.js";
import { Logger } from "../logger.js";
import { ArpData } from "../protocols/arp.js";
import { DhcpData } from "../protocols/dhcp.js";
import { HandlerContext, Protocol, ProtocolHandler } from "../protocols/protocol.js";
import { toBigEndianFromInt } from "../utils/endianness.js";
import { pick } from "../utils/objects.js";


class ArpImplementation extends Protocol<ArpData, never, ArpData, never, {}, { router: Router }> {
  public readonly displayName = "RouterARP";

  constructor(router: Router) {
    super({
      router,
    });
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<ArpData, never, ArpData, never>): ProtocolHandler<this> {
    const router = this.options.router;

    context.onProcessFrame((frame) => {
      const isRouterSource = router.mac.equals(frame.srcMac);
      const isRouterDest = router.mac.isRecipientOfTarget(frame.destMac);
      if (isRouterSource) {
        return { consumed: true };
      }
      if (!isRouterDest) {
        return { consumed: false };
      }

      if (frame.hardwareType !== 0x1) {
        Logger.warn(`Network adapter received ARP packet with unknown hardware type ${frame.hardwareType}, dropping it`);
        return { consumed: true };
      }

      const queriedMac = router.getDevice(frame.queriedIp)?.mac;

      if (queriedMac) {
        context.sendFrame({
          operation: 0x2,  // reply
          srcMac: router.mac,
          destMac: frame.srcMac,
          hardwareType: frame.hardwareType,
          hardwareSize: frame.hardwareSize,
          protocolType: frame.protocolType,
          protocolSize: frame.protocolSize,
          originMac: frame.originMac,
          originIp: frame.originIp,
          queriedMac,
          queriedIp: frame.queriedIp,
        });
      } else {
        // TODO what is the right behaviour here? right now we just ignore the packet
        Logger.warn("Network adapter received ARP packet with unknown IP, dropping it", frame.queriedIp.toString());
      }

      return { consumed: true };
    });

    return {
      ...base,
    };
  }
}

class DhcpImplementation extends Protocol<DhcpData, never, DhcpData, never, {}, { router: Router }> {
  public readonly displayName = "RouterDHCP";
  
  constructor(router: Router) {
    super({
      router,
    });
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<DhcpData, never, DhcpData, never>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      const routerIp = this.options.router.ip;
      const isRouterSource = routerIp.equals(frame.srcIp);
      const isRouterDest = routerIp.isRecipientOfTarget(frame.destIp);
      if (isRouterSource && frame.srcPort === 67) {
        return { consumed: true };
      }
      if (!isRouterDest || frame.destPort !== 67) {
        return { consumed: false };
      }

      const dhcpMessageTypeOption = frame.options.find((option) => option.code === 53);
      if (!dhcpMessageTypeOption) {
        return { consumed: false };
      }

      const dhcpMessageType = dhcpMessageTypeOption.data[0];

      switch (dhcpMessageType) {
        case 1: case 3: {  // DHCPDISCOVER, DHCPREQUEST
          const device = this.options.router.getOrRegisterDevice(frame.clientHardwareAddress);
          if (!device) {
            Logger.warn(`Can't register device, did we run out of IP addresses? Droppping DHCP packet.`);
            return { consumed: true };
          }

          if (dhcpMessageType === 3) {
            device?.confirm();
          }

          context.sendFrame({
            srcIp: routerIp,
            srcPort: frame.destPort,
            destIp: device.ip,
            destPort: frame.srcPort,
            operation: 0x02,
            hops: 0,
            serverName: "",
            bootFileName: "",
            seconds: 0,
            flags: 0,
            yourIpAddress: device.ip,
            serverIpAddress: this.options.router.ip,
            gatewayIpAddress: Ipv4Address.ZeroAddress,
            options: [
              {
                code: 0x35,  // DHCP message type OFFER or ACK
                data: new Uint8Array([dhcpMessageType === 1 ? 2 : 5]),
              },
              {
                code: 0x01,  // Subnet mask
                data: this.options.router.subnetMask.bytes,
              },
              {
                code: 0x03,  // Router
                data: this.options.router.ip.bytes,
              },
              {
                code: 0x06,  // Domain name server
                data: this.options.router.ip.bytes,
              },
              {
                code: 0x0c,  // Host name
                data: new TextEncoder().encode("emulatorhost"),
              },
              {
                code: 0x0f,  // Domain name
                data: new TextEncoder().encode("emulatorhost"),
              },
              {
                code: 0x1c,  // Broadcast address
                data: Ipv4Address.BroadcastAddress.bytes,
              },
              {
                code: 0x33,  // Lease time
                data: toBigEndianFromInt(4, 0x00015180),
              },
              {
                code: 0x36,  // DHCP server identifier
                data: this.options.router.ip.bytes,
              },
            ],
            ...pick(
              frame,
              "hardwareType",
              "hardwareAddressLength",
              "xid",
              "clientHardwareAddress",
              "clientIpAddress",
            ),
          });
          return { consumed: true };
        }
        default: {
          return { consumed: false };
        }
      }
    });

    return {
      ...base,
    };
  }
}
type Device = {
  readonly mac: MacAddress,
  readonly ip: Ipv4Address,
  readonly isConfirmed: boolean,
  confirm(): void,
};

export class Router implements Device {
  static ArpImplementation = ArpImplementation;
  static DhcpImplementation = DhcpImplementation;

  public readonly mac: MacAddress;
  public readonly ip: Ipv4Address;
  public readonly isConfirmed: true = true;
  public readonly subnetMask: Ipv4Address;

  private _addressTable = new Map<number, MacAddress>();
  private _devices = new Map<string, Device>();

  constructor(options: {
    mac: MacAddress,
    ip: Ipv4Address,
    subnetMask: Ipv4Address,
  }) {
    this.mac = options.mac;
    this.ip = options.ip;
    this.subnetMask = options.subnetMask;
    this._registerDevice(this);
  }

  public get subnet() {
    return this.subnetMask.bitAnd(this.ip);
  }

  public confirm() {
    // do nothing, router is always confirmed
  }

  public registerDevice(mac: MacAddress): Device | undefined {
    const ip = this._getNextFreeIp();
    if (!ip) return undefined;

    const device = {
      mac,
      ip,
      isConfirmed: false,
      confirm() {
        device.isConfirmed = true;
      }
    };
    this._registerDevice(device);
    return device;
  }

  private _registerDevice(device: Device) {
    this._addressTable.set(device.ip.toInt(), device.mac);
    this._devices.set(device.mac.toString(), device);
  }

  private _getNextFreeIp() {
    const allBitsZero = this.subnet;
    const allBitsSet = this.subnet.bitOr(this.subnetMask.bitNot());
    const specialAddresses = [  // some addresses are often special by convention, don't assign them
      allBitsZero,
      allBitsSet,
    ];

    for (let curIpInt = 0; curIpInt <= 0xffffffff;) {
      const curIp = Ipv4Address.fromInt(curIpInt);
      const actualSubnet = this.subnet;
      const curIpSubnet = this.subnetMask.bitAnd(curIp);
      const subnetDifference = actualSubnet.bitXor(curIpSubnet);
      if (!subnetDifference.equals(Ipv4Address.ZeroAddress)) {
        curIpInt += subnetDifference.toInt();
        continue;
      }

      if (!specialAddresses.find(a => a.equals(curIp))) {
        if (!this.isIpAssigned(curIp)) {
          return curIp;
        }
      }
      curIpInt++;
    }
    return null;
  }

  public getDevice(mac: MacAddress): Device | undefined;
  public getDevice(ip: Ipv4Address): Device | undefined;
  public getDevice(localAddress: MacAddress | Ipv4Address) {
    const mac = localAddress instanceof MacAddress ? localAddress : this._addressTable.get(localAddress.toInt());
    if (!mac) {
      return undefined;
    }
  
    return this._devices.get(mac.toString()) ?? undefined;
  }

  public getOrRegisterDevice(mac: MacAddress): Device | undefined {
    return this.getDevice(mac) ?? this.registerDevice(mac);
  }

  public listDevices() {
    return [...this._devices.values()];
  }

  public isIpAssigned(ip: Ipv4Address): boolean {
    return this._addressTable.has(ip.toInt());
  }
}
