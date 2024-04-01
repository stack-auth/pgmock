import { Ipv4Address } from "../addresses/ip-address.js";
import { MacAddress } from "../addresses/mac-address.js";
import { Logger } from "../logger.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { EthernetData } from "./ethernet.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";

export type ArpFrame = EthernetData;
type ArpDataInner<
  HardwareType extends number,
  HardwareAddressKeyName extends string,
  HardwareAddress,
  ProtocolType extends number,
  ProtocolAddressKeyName extends string,
  ProtocolAddress
> =
  & {  // base
    srcMac: MacAddress,
    destMac: MacAddress,
    hardwareType: HardwareType,
    protocolType: ProtocolType,
    hardwareSize: number,
    protocolSize: number,
  }
  & (  // operation type
    | (
      & {
        operation: 0x1,  // request
      }
      & Record<`origin${HardwareAddressKeyName}`, HardwareAddress>
      & Record<`origin${ProtocolAddressKeyName}`, ProtocolAddress>
      & Record<`queried${ProtocolAddressKeyName}`, ProtocolAddress>
    )
    | (
      & {
        operation: 0x2,  // reply
      }
      & Record<`queried${HardwareAddressKeyName}`, HardwareAddress>
      & Record<`queried${ProtocolAddressKeyName}`, ProtocolAddress>
      & Record<`origin${HardwareAddressKeyName}`, HardwareAddress>
      & Record<`origin${ProtocolAddressKeyName}`, ProtocolAddress>
    )
  );
export type ArpData = ArpDataInner<0x1, "Mac", MacAddress, 0x0800, "Ip", Ipv4Address>;

type SubProtocol = SubProtocolFor<Arp>;

export class Arp<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<ArpFrame, ArpData, ArpFrame, ArpData, SubProtocols> {
  public readonly displayName = "ARP";
  public etherType = 0x0806;

  public constructor(options: Partial<ProtocolOptions<SubProtocols>>) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<ArpFrame, ArpData, ArpFrame, ArpData>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      if (frame.etherType !== this.etherType) {
        return { consumed: false };
      }

      const hardwareType = toUnsignedIntFromBigEndian(frame.payload.slice(0, 2));
      const protocolType = toUnsignedIntFromBigEndian(frame.payload.slice(2, 4));
      const hardwareSize = frame.payload[4];
      const protocolSize = frame.payload[5];
      const operation = toUnsignedIntFromBigEndian(frame.payload.slice(6, 8));
      const senderHardwareAddress = frame.payload.slice(8, 8 + hardwareSize);
      const senderProtocolAddress = frame.payload.slice(8 + hardwareSize, 8 + hardwareSize + protocolSize);
      const targetHardwareAddress = frame.payload.slice(8 + hardwareSize + protocolSize, 8 + 2 * hardwareSize + protocolSize);
      const targetProtocolAddress = frame.payload.slice(8 + 2 * hardwareSize + protocolSize, 8 + 2 * hardwareSize + 2 * protocolSize);
      
      if (hardwareType !== 0x1) {
        Logger.warn("Network adapter received ARP packet with unsupported hardware type, dropping it", hardwareType);
        return { consumed: true };
      }
      const senderMac = new MacAddress(senderHardwareAddress);
      const targetMac = new MacAddress(targetHardwareAddress);

      if (protocolType !== 0x0800) {
        Logger.warn("Network adapter received ARP packet with unsupported protocol type, dropping it", protocolType);
        return { consumed: true };
      }
      const senderIp = new Ipv4Address(senderProtocolAddress);
      const targetIp = new Ipv4Address(targetProtocolAddress);

      const base = {
        srcMac: frame.srcMac,
        destMac: frame.destMac,
        hardwareType,
        protocolType,
        hardwareSize,
        protocolSize,
      } as const;

      switch (operation) {
        case 0x1: {  // request
          context.processData({
            ...base,
            operation,
            originMac: senderMac,
            originIp: senderIp,
            queriedIp: targetIp,
          });
          break;
        }
        case 0x2: {  // reply
          context.processData({
            ...base,
            operation,
            queriedMac: senderMac,
            queriedIp: senderIp,
            originMac: targetMac,
            originIp: targetIp,
          });
          break;
        }
        default: {
          // TODO other ARP operations, if any more are needed
          Logger.warn("Network adapter received ARP packet with unsupported operation, dropping it", operation);
          break;
        }
      }

      return { consumed: true };
    });

    context.onSendData((data) => {
      let details;
      switch (data.operation) {
        case 0x1: {  // request
          details = new Uint8Array([
            ...data.originMac.bytes,
            ...data.originIp.bytes,
            ...new Uint8Array(data.hardwareSize),
            ...data.queriedIp.bytes,
          ]);
          break;
        }
        case 0x2: {  // reply
          details = new Uint8Array([
            ...data.queriedMac.bytes,
            ...data.queriedIp.bytes,
            ...data.originMac.bytes,
            ...data.originIp.bytes,
          ]);
          break;
        }
        default: {
          throw new Error("ARP operation not supported: " + (data as any).operation);
        }
      }

      context.sendFrame({
        srcMac: data.srcMac,
        destMac: data.destMac,
        etherType: 0x0806,
        payload: new Uint8Array([
          ...toBigEndianFromInt(2, data.hardwareType),
          ...toBigEndianFromInt(2, data.protocolType),
          data.hardwareSize,
          data.protocolSize,
          ...toBigEndianFromInt(2, data.operation),
          ...details
        ]),
      });
    });

    return {
      ...base,
    };
  }
}
