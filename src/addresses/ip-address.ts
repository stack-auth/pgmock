export class Ipv4Address {
  static ZeroAddress = new Ipv4Address("0.0.0.0");
  static BroadcastAddress = new Ipv4Address("255.255.255.255");

  public readonly bytes: Uint8Array;

  constructor(bytes: Iterable<number>);
  constructor(str: string);
  constructor(data: Iterable<number> | string) {
    if (typeof data === "string") {
      data = data.split(".").map((byte) => parseInt(byte, 10));
    }

    const bytesArray = new Uint8Array(data);
    if (bytesArray.length !== 4) {
      throw new Error("IPv4 address must be 4 bytes");
    }
    this.bytes = bytesArray;
  }

  bitNot() {
    return Ipv4Address._fromSignedInt(~this.toInt() & 0xffffffff);
  }

  bitAnd(other: Ipv4Address) {
    return Ipv4Address._fromSignedInt(this.toInt() & other.toInt());
  }

  bitOr(other: Ipv4Address) {
    return Ipv4Address._fromSignedInt(this.toInt() | other.toInt());
  }

  bitXor(other: Ipv4Address) {
    return Ipv4Address._fromSignedInt(this.toInt() ^ other.toInt());
  }

  equals(other: Ipv4Address) {
    return this.bytes.every((byte, i) => byte === other.bytes[i]);
  }

  isRecipientOfTarget(targetAddress: Ipv4Address) {
    return targetAddress.equals(Ipv4Address.BroadcastAddress) || targetAddress.equals(this);
  }

  toString() {
    return Array.from(this.bytes).map((byte) => byte.toString(10)).join(".");
  }

  toInt() {
    return this.bytes.reduce((prev, cur) => prev * 256 + cur, 0);
  }

  static _fromSignedInt(signedInt: number) {
    if (signedInt < 0) {
      signedInt = 0xffffffff + signedInt + 1;
    }
    return Ipv4Address.fromInt(signedInt);
  }

  static fromInt(int: number) {
    if (!Number.isInteger(int)) {
      throw new Error(`Received non-integer 0x${int.toString(16)}, cannot translate into Ipv4Address`);
    }
    if (int < 0 || int > 0xffffffff) {
      throw new Error(`Can't convert integer 0x${int.toString(16)} into Ipv4Address`);
    }
    return new Ipv4Address([
      int / 256 / 256 / 256 & 0xff,
      int / 256 / 256 & 0xff,
      int / 256 & 0xff,
      int & 0xff,
    ]);
  }
}
