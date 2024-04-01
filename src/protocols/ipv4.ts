import { Ipv4Address } from "../addresses/ip-address.js";
import { Logger } from "../logger.js";
import { Router } from "../routers/router.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { internetChecksum } from "../utils/internet-checksum.js";
import { isZeroIn16BitsOnesComplement } from "../utils/ones-complement.js";
import { EthernetData } from "./ethernet.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";

export type Ipv4Frame = EthernetData;
export type Ipv4Data = {
  srcIp: Ipv4Address,
  destIp: Ipv4Address,
  flags: {
    dontFragment: boolean,
  },
  protocol: number,
  timeToLive: number,
  dscp: number,
  ecn: number,
  payload: Uint8Array,
};

type SubProtocol = SubProtocolFor<Ipv4>;

// TODO options, fragmentation
export class Ipv4<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<Ipv4Frame, Ipv4Data, Ipv4Frame, Ipv4Data, SubProtocols, { router: Router }> {
  public readonly displayName = "IPv4";
  public readonly etherType = 0x0800;
  
  public constructor(options: Partial<ProtocolOptions<SubProtocols>> & { router: Router }) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<Ipv4Frame, Ipv4Data, Ipv4Frame, Ipv4Data>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      if (frame.etherType !== this.etherType) {
        return { consumed: false };
      }

      const ipVersion = frame.payload[0] >> 4;
      if (ipVersion !== 4) {
        Logger.warn("Network adapter received packet with unsupported IPv4 version, ignoring it", ipVersion);
        return { consumed: true };
      }

      const ipHeaderLength = (frame.payload[0] & 0x0f) * 4;
      const dscp = frame.payload[1] >> 2;
      const ecn = frame.payload[1] & 0x03;
      const totalLength = toUnsignedIntFromBigEndian(frame.payload.slice(2, 4));
      const identification = toUnsignedIntFromBigEndian(frame.payload.slice(4, 6));
      const ipFlags = frame.payload[6] >> 5;
      const df = !!(ipFlags & 0x02);
      const mf = !!(ipFlags & 0x01);
      const fragmentOffset = ((frame.payload[6] & 0x1f) << 8) + frame.payload[7];
      const timeToLive = frame.payload[8];
      const protocol = frame.payload[9];
      const checksum = toUnsignedIntFromBigEndian(frame.payload.slice(10, 12));
      const srcIp = new Ipv4Address(frame.payload.slice(12, 16));
      const destIp = new Ipv4Address(frame.payload.slice(16, 20));
      const ipOptions = frame.payload.slice(20, ipHeaderLength);
      const payload = frame.payload.slice(ipHeaderLength, totalLength);

      const data = {
        srcIp,
        destIp,
        flags: {
          dontFragment: df,
        },
        protocol,
        timeToLive,
        dscp,
        ecn,
        payload,
      };

      const ipChecksum = internetChecksum(frame.payload.slice(0, ipHeaderLength));
      if (!isZeroIn16BitsOnesComplement(ipChecksum)) {
        Logger.warn(`Network adapter received packet with invalid IPv4 checksum 0x${ipChecksum.toString(16)}, ignoring it`, { data });
        return { consumed: true };
      }

      if (ipOptions.length !== 0) {
        // TODO need to fix this
        Logger.warn("Network adapter received packet with unsupported IPv4 options, ignoring it", { data });
        return { consumed: true };
      }

      if (mf || fragmentOffset !== 0) {
        // TODO need to fix this
        Logger.warn("Network adapter received packet with unimplemented IPv4 fragmentation, skipping the entire packet", { data });
        return { consumed: true };
      }

      context.processData(data);

      return { consumed: true };
    });

    context.onSendData((data) => {
      const ipHeaderLength = 20;
      const moreFragments = false;
      const flagsBits = (data.flags.dontFragment ? 0x02 : 0x00) | (moreFragments ? 0x01 : 0x00);
      const ipHeaderBytes = new Uint8Array([
        0x40 + ipHeaderLength / 4,  // version 4, header length
        data.dscp << 2 | data.ecn,
        ...toBigEndianFromInt(2, ipHeaderLength + data.payload.length),  // total length
        0x00, 0x00,  // identification
        flagsBits << 5, 0x00, // flags, fragment offset
        data.timeToLive,
        data.protocol,
        0xff, 0xff,  // checksum, we will update this later
        ...data.srcIp.bytes,
        ...data.destIp.bytes,
      ]);
      if (ipHeaderBytes.length !== ipHeaderLength) {
        throw new Error("IP header length is invalid, this should never happen");
      }
      const ipChecksumField = ~internetChecksum(ipHeaderBytes);
      ipHeaderBytes[10] = ipChecksumField >> 8 & 0xff;
      ipHeaderBytes[11] = ipChecksumField & 0xff;

      if (!isZeroIn16BitsOnesComplement(internetChecksum(ipHeaderBytes.slice(0, ipHeaderLength)))) {
        throw new Error("Network adapter sending packet with invalid IPv4 checksum, this should never happen");
      }

      const srcDevice = this.options.router.getDevice(data.srcIp);
      if (!srcDevice) {
        throw new Error(`Can't find source device with IP ${data.srcIp} (available devices: ${this.options.router.listDevices().map((device) => device.ip).join(", ")})`);
      }

      const destDevice = this.options.router.getDevice(data.destIp);
      if (!destDevice) {
        throw new Error(`Can't find destination device with IP ${data.destIp}`);
      }

      context.sendFrame({
        srcMac: srcDevice.mac,
        destMac: destDevice.mac,
        etherType: this.etherType,
        payload: new Uint8Array([
          ...ipHeaderBytes,
          ...data.payload,
        ]),
      });
    });

    return {
      ...base,
    };
  }
}
