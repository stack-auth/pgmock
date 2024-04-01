import { Ipv4Address } from "../addresses/ip-address.js";
import { Logger } from "../logger.js";
import { toBigEndianFromInt, toUnsignedIntFromBigEndian } from "../utils/endianness.js";
import { internetChecksum } from "../utils/internet-checksum.js";
import { isZeroIn16BitsOnesComplement } from "../utils/ones-complement.js";
import { Ipv4Data } from "./ipv4.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";
import nodecrypto from "crypto";

export type IcmpFrame = Ipv4Data;
export type IcmpData =
& {
  srcIp: Ipv4Address,
  destIp: Ipv4Address,
  data: Uint8Array,
}
& (
  | {
    type: 0x00 | 0x08,  // echo reply/request
    code: 0x00,
    identifier: number,
    sequenceNumber: number,
  }
);

type SubProtocol = SubProtocolFor<Icmp>;

type AdditionalOptions = {
  pingServer: Ipv4Address | false,
};

type AdditionalHandlerMethods = {
  ping: (options: Pick<IcmpData, "srcIp" | "destIp">) => Promise<void>,
};

export class Icmp<SubProtocols extends { [K in string]: SubProtocol } = any> extends Protocol<IcmpFrame, IcmpData, IcmpFrame, IcmpData, SubProtocols, AdditionalOptions> {
  public readonly displayName = "ICMP";
  public readonly ipProtocolNumber = 0x1;

  public constructor(options: Partial<ProtocolOptions<SubProtocols> & AdditionalOptions>) {
    super({
      pingServer: false,
      ...options,
    });
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<IcmpFrame, IcmpData, IcmpFrame, IcmpData>): ProtocolHandler<this> & AdditionalHandlerMethods {
    const outstandingPings = new Map<number, () => void>();

    const onSendData = (data: IcmpData) => {
      let restOfHeader;
      let payload;
      switch (data.type) {
        case 0x00: case 0x08: {  // echo reply/request
          if (data.code !== 0x00) {
            throw new Error(`Network adapter sending packet with unimplemented ICMP code ${data.code} for echo request`);
          }

          restOfHeader = new Uint8Array([
            ...toBigEndianFromInt(2, data.identifier),
            ...toBigEndianFromInt(2, data.sequenceNumber),
          ]);
          payload = data.data;
          break;
        }
        default: {
          throw new Error("Network adapter received packet with unimplemented ICMP type, dropping the entire packet: " + data.type);
        }
      }

      const icmpBytes = new Uint8Array([
        data.type, data.code,
        0xff, 0xff,  // checksum, we will update this later
        ...restOfHeader,
        ...payload,
      ]);
      const icmpChecksumField = ~internetChecksum(icmpBytes);
      icmpBytes[2] = icmpChecksumField >> 8 & 0xff;
      icmpBytes[3] = icmpChecksumField & 0xff;
  
      if (!isZeroIn16BitsOnesComplement(internetChecksum(icmpBytes))) {
        throw new Error("Network adapter tried to send packet with invalid ICMP checksum, this should never happen");
      }      


      context.sendFrame({
        srcIp: data.srcIp,
        destIp: data.destIp,
        protocol: this.ipProtocolNumber,
        dscp: 0,
        ecn: 0,
        flags: {
          dontFragment: false,
        },
        timeToLive: 64,
        payload: icmpBytes,
      });
    };

    context.onProcessFrame((frame) => {
      if (frame.protocol !== this.ipProtocolNumber) {
        return { consumed: false };
      }

      const type = frame.payload[0];
      const code = frame.payload[1];
      const checksum = toUnsignedIntFromBigEndian(frame.payload.slice(2, 4));
      
      const data = frame.payload.slice(8);

      const actualChecksum = internetChecksum(frame.payload);
      if (!isZeroIn16BitsOnesComplement(actualChecksum)) {
        Logger.warn(`Network adapter received packet with invalid ICMP checksum 0x${actualChecksum.toString(16)}, ignoring it`);
        return { consumed: true };
      }

      switch (type) {
        case 0x00: case 0x08: {  // echo reply, request
          if (code !== 0x00) {
            Logger.warn("Network adapter received packet with unimplemented ICMP code, dropping the entire packet", code);
            return { consumed: true };
          }

          const identifier = toUnsignedIntFromBigEndian(frame.payload.slice(4, 6));
          const sequenceNumber = toUnsignedIntFromBigEndian(frame.payload.slice(6, 8));

          if (type === 0x08 && this.options.pingServer && frame.destIp.equals(this.options.pingServer)) {  // echo request with ping server enabled
            onSendData({
              srcIp: this.options.pingServer,
              destIp: frame.srcIp,
              type: 0x00,
              code: 0x00,
              identifier,
              sequenceNumber,
              data,
            });
          } else {
            const pingId = identifier << 16 | sequenceNumber;
            const resolve = outstandingPings.get(pingId);  // exists iff this is a reply to a ping we sent
            if (resolve) {
              if (type === 0x00) {
                outstandingPings.delete(identifier << 16 | sequenceNumber);
                resolve();
              }
            } else {
              context.processData({
                srcIp: frame.srcIp,
                destIp: frame.destIp,
                type,
                code,
                identifier,
                sequenceNumber,
                data,
              });
            }
          }
          break;
        }
        default: {
          Logger.warn("Network adapter received packet with unimplemented ICMP type, dropping the entire packet", type);
          break;
        }
      }

      return { consumed: true };
    });

    context.onSendData(onSendData);

    return {
      ...base,
      ping: async (options) => {
        const pingId = nodecrypto.randomBytes(4).readInt32BE(0);
        const promise = new Promise<void>((resolve) => outstandingPings.set(pingId, resolve));
        onSendData({
          type: 0x08,
          code: 0x00,
          identifier: pingId >> 16,
          sequenceNumber: pingId & 0xffff,
          data: new Uint8Array(0),
          ...options
        });
        await promise;
      }
    };
  }
}
