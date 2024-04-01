import { Ipv4Address } from "../addresses/ip-address.js";
import { MacAddress } from "../addresses/mac-address.js";
import { Logger } from "../logger.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { udpChecksum } from "../utils/internet-checksum.js";
import { isZeroIn16BitsOnesComplement } from "../utils/ones-complement.js";
import { Ipv4Data } from "./ipv4.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";

export type UdpFrame = Ipv4Data;
export type UdpData = {
  srcIp: Ipv4Address,
  destIp: Ipv4Address,
  srcPort: number,
  destPort: number,
  payload: Uint8Array,
};

type SubProtocol = SubProtocolFor<Udp>;

export class Udp<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<UdpFrame, UdpData, UdpFrame, UdpData, SubProtocols> {
  public readonly displayName = "UDP";
  public readonly ipProtocolNumber = 0x11;  // UDP

  public constructor(options: Partial<ProtocolOptions<SubProtocols>>) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<UdpFrame, UdpData, UdpFrame, UdpData>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      if (frame.protocol !== this.ipProtocolNumber) {
        return { consumed: false };
      }

      const srcPort = toUnsignedIntFromBigEndian(frame.payload.slice(0, 2));
      const destPort = toUnsignedIntFromBigEndian(frame.payload.slice(2, 4));
      const length = toUnsignedIntFromBigEndian(frame.payload.slice(4, 6));
      const checksum = toUnsignedIntFromBigEndian(frame.payload.slice(6, 8));
      const udpPayload = frame.payload.slice(8);
      
      const actualChecksum = udpChecksum(frame.srcIp, frame.destIp, frame.payload);
      if (!isZeroIn16BitsOnesComplement(actualChecksum)) {
        Logger.warn(`Network adapter received packet with invalid UDP checksum ${actualChecksum}, ignoring it`);
        return { consumed: true };
      }

      if (length !== frame.payload.length) {
        Logger.warn(`Network adapter received UDP packet with invalid length ${length}, ignoring it`);
        return { consumed: true };
      }

      context.processData({
        srcIp: frame.srcIp,
        destIp: frame.destIp,
        srcPort,
        destPort,
        payload: udpPayload,
      });

      return { consumed: true };
    });

    context.onSendData((data) => {
      const udpBytes = new Uint8Array([
        ...toBigEndianFromInt(2, data.srcPort),
        ...toBigEndianFromInt(2, data.destPort),
        ...toBigEndianFromInt(2, data.payload.length + 8),
        0xff, 0xff,  // checksum, we will update this later
        ...data.payload,
      ]);

      let udpChecksumField = ~udpChecksum(data.srcIp, data.destIp, udpBytes);
      if (udpChecksumField === 0) {
        udpChecksumField = 0xffff;
      }
      udpBytes[6] = udpChecksumField >> 8 & 0xff;
      udpBytes[7] = udpChecksumField & 0xff;
      
      context.sendFrame({
        srcIp: data.srcIp,
        destIp: data.destIp,
        protocol: this.ipProtocolNumber,
        payload: udpBytes,
        flags: {
          dontFragment: true,
        },
        dscp: 0,
        ecn: 0,
        timeToLive: 64,
      });
    });

    return {
      ...base,
    };
  }
}
