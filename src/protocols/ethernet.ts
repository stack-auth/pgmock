import { MacAddress } from "../addresses/mac-address.js";
import { Logger } from "../logger.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";

export type EthernetFrame = Uint8Array;
export type EthernetData = {
  srcMac: MacAddress,
  destMac: MacAddress,
  etherType: number,
  payload: Uint8Array,
};

type SubProtocol = SubProtocolFor<Ethernet>;

export class Ethernet<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<EthernetFrame, EthernetData, EthernetFrame, EthernetData, SubProtocols> {
  public readonly displayName = "Ethernet";
  public constructor(options: Partial<ProtocolOptions<SubProtocols>>) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<EthernetFrame, EthernetData, EthernetFrame, EthernetData>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      const destMac = new MacAddress(frame.slice(0, 6));
      const srcMac = new MacAddress(frame.slice(6, 12));
      const vlanTag = toUnsignedIntFromBigEndian(frame.slice(12, 14));
      const isVlanTagged = vlanTag === 0x8100 || vlanTag === 0x88a8;  // VLAN (IEEE 802.1Q or IEEE 802.1ad)
      if (isVlanTagged) {
        // TODO 802.1Q tag (VLAN)
        Logger.warn("Network adapter received packet with unimplemented VLAN tags, dropping the entire packet", vlanTag);
        return { consumed: true };
      }
      const etherType = !isVlanTagged ? vlanTag : toUnsignedIntFromBigEndian(frame.slice(16, 18));
      const ethernetPayload = frame.slice(isVlanTagged ? 18 : 14);

      context.processData({
        destMac: destMac,
        srcMac: srcMac,
        etherType,
        payload: ethernetPayload,
      });

      return { consumed: true };
    });

    context.onSendData((data) => {
      const ethernetPacketBinary = new Uint8Array([
        ...data.destMac.bytes,
        ...data.srcMac.bytes,
        ...toBigEndianFromInt(2, data.etherType),
  
        ...data.payload,
      ]);
  
      context.sendFrame(ethernetPacketBinary);
    });

    return {
      ...base,
    };
  }
}
