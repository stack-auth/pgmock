import { toBigEndianFromInt } from "./endianness.js";
import { Ipv4Address } from "../addresses/ip-address.js";

export function internetChecksum(data: Iterable<number>) {
  // ones' complement sum
  let res = [...data].reduce((acc, byte, index) => {
    if (index % 2 === 0) {
      return acc + byte * 256;
    } else {
      return acc + byte;
    }
  }, 0);
  while (res > 0xffff) {
    res = (res & 0xffff) + (res >> 16);
  }
  return res;
}

function pseudoChecksum(srcIp: Ipv4Address, destIp: Ipv4Address, packetBinary: Uint8Array, protocol: number) {
  return internetChecksum([
    ...srcIp.bytes,
    ...destIp.bytes,
    0x00,
    protocol,
    ...toBigEndianFromInt(2, packetBinary.length),
    ...packetBinary,
  ]);
}

export function tcpChecksum(srcIp: Ipv4Address, destIp: Ipv4Address, tcpPacketBinary: Uint8Array) {
  return pseudoChecksum(srcIp, destIp, tcpPacketBinary, 0x06);
}

export function udpChecksum(srcIp: Ipv4Address, destIp: Ipv4Address, udpPacketBinary: Uint8Array) {
  const res = pseudoChecksum(srcIp, destIp, udpPacketBinary, 0x11);
  if (udpPacketBinary[6] === 0x00 && udpPacketBinary[7] === 0x00) {
    return 0;
  }
  return res;
}
