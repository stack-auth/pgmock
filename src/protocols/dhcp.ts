import { Ipv4Address } from "../addresses/ip-address.js";
import { MacAddress } from "../addresses/mac-address.js";
import { Logger } from "../logger.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";
import { UdpData } from "./udp.js";

export type DhcpFrame = UdpData;
export type DhcpData =
  & {
    srcIp: Ipv4Address,
    destIp: Ipv4Address,
    srcPort: number,
    destPort: number,
    operation: number,
    hops: number,
    xid: number,
    seconds: number,
    flags: number,
    clientIpAddress: Ipv4Address,
    yourIpAddress: Ipv4Address,
    serverIpAddress: Ipv4Address,
    gatewayIpAddress: Ipv4Address,
    serverName: string | null,
    bootFileName: string | null,
    options: { code: number, data: Uint8Array }[],
  }
  & (
    | {
      hardwareType: 1,
      hardwareAddressLength: 6,
      clientHardwareAddress: MacAddress,
    }
  );

type SubProtocol = SubProtocolFor<Dhcp>;

const expectedMagicCookie = 0x63825363;

export class Dhcp<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<DhcpFrame, DhcpData, DhcpFrame, DhcpData, SubProtocols> {
  public readonly displayName = "DHCP";
  public constructor(options: Partial<ProtocolOptions<SubProtocols>>) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<DhcpFrame, DhcpData, DhcpFrame, DhcpData>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      if ([frame.srcPort, frame.destPort].some(p => ![67, 68].includes(p))) {
        return { consumed: false };
      }

      const op = frame.payload[0];
      const htype = frame.payload[1];
      const hlen = frame.payload[2];
      const hops = frame.payload[3];
      const xid = frame.payload.slice(4, 8);
      const secs = toUnsignedIntFromBigEndian(frame.payload.slice(8, 10));
      const flags = toUnsignedIntFromBigEndian(frame.payload.slice(10, 12));
      const ciaddr = frame.payload.slice(12, 16);
      const yiaddr = frame.payload.slice(16, 20);
      const siaddr = frame.payload.slice(20, 24);
      const giaddr = frame.payload.slice(24, 28);
      const chaddr = frame.payload.slice(28, 28 + hlen);
      const sname = new TextDecoder().decode(frame.payload.slice(44, 108));
      const file = new TextDecoder().decode(frame.payload.slice(108, 236));
      const magicCookie = toUnsignedIntFromBigEndian(frame.payload.slice(236, 240));
      const dhcpOptionsData = frame.payload.slice(240);
      const options = [];
      for (let i = 0; i < dhcpOptionsData.length;) {
        const optionCode = dhcpOptionsData[i];
        if (optionCode === 0xff) {
          break;
        }
        const optionLength = dhcpOptionsData[i + 1];
        const optionData = dhcpOptionsData.slice(i + 2, i + 2 + optionLength);
        options.push({ code: optionCode, data: optionData });
        i += 2 + optionLength;
      }
      const dhcpClientNameOption = options.find((option) => option.code === 12);
      const clientName = dhcpClientNameOption ? new TextDecoder().decode(dhcpClientNameOption.data) : null;

      if (magicCookie !== expectedMagicCookie) {
        Logger.warn("Network adapter received DHCP packet with invalid magic cookie, ignoring it");
        return { consumed: true };
      }

      if (htype !== 1) {
        Logger.warn(`Network adapter received DHCP packet with invalid hardware type ${htype}, ignoring it`);
        return { consumed: true };
      }

      if (hlen !== 6) {
        Logger.warn(`Network adapter received DHCP packet with invalid hardware address length ${hlen} (expected 6), ignoring it`);
        return { consumed: true };
      }

      context.processData({
        srcIp: frame.srcIp,
        destIp: frame.destIp,
        srcPort: frame.srcPort,
        destPort: frame.destPort,
        operation: op,
        hops,
        xid: toUnsignedIntFromBigEndian(xid),
        seconds: secs,
        flags,
        clientIpAddress: new Ipv4Address(ciaddr),
        yourIpAddress: new Ipv4Address(yiaddr),
        serverIpAddress: new Ipv4Address(siaddr),
        gatewayIpAddress: new Ipv4Address(giaddr),
        serverName: sname,
        bootFileName: file,
        options,
        hardwareType: htype,
        hardwareAddressLength: hlen,
        clientHardwareAddress: new MacAddress(chaddr),
      });

      return { consumed: true };
    });

    context.onSendData((data) => {
      const serverName = data.serverName ?? "";
      const bootFileName = data.bootFileName ?? "";
      if (serverName.length > 63) {
        throw new Error(`DHCP server name must be at most 63 characters long, got ${serverName.length}`);
      }
      if (bootFileName.length > 127) {
        throw new Error(`DHCP boot file name must be at most 127 characters long, got ${bootFileName.length}`);
      }

      for (const option of data.options) {
        if (option.data.length > 255) {
          // TODO is 255 really the max or is there a lower limit?
          throw new Error(`DHCP option ${option.code} must be at most 255 bytes long, got ${option.data.length}`);
        }
      }

      const dhcpBytes = new Uint8Array([
        data.operation,
        data.hardwareType,
        data.hardwareAddressLength,
        data.hops,
        ...toBigEndianFromInt(4, data.xid),
        ...toBigEndianFromInt(2, data.seconds),
        ...toBigEndianFromInt(2, data.flags),
        ...data.clientIpAddress.bytes,
        ...data.yourIpAddress.bytes,
        ...data.serverIpAddress.bytes,
        ...data.gatewayIpAddress.bytes,
        ...data.clientHardwareAddress.bytes,
        ...new Uint8Array(16 - data.hardwareAddressLength),  // client hardware address padding
        ...new TextEncoder().encode(serverName),
        ...new Uint8Array(64 - serverName.length),  // server name padding
        ...new TextEncoder().encode(bootFileName),
        ...new Uint8Array(128 - bootFileName.length),  // boot file name padding
        ...toBigEndianFromInt(4, expectedMagicCookie),
        ...data.options
          .filter(o => o.code !== 0xff)
          .flatMap(o => [o.code, o.data.length, ...o.data]),
        0xff, 0x00,  // Endmark
      ]);

      context.sendFrame({
        srcIp: data.srcIp,
        destIp: data.destIp,
        srcPort: data.srcPort,
        destPort: data.destPort,
        payload: dhcpBytes,
      });
    });

    return {
      ...base,
    };
  }
}
