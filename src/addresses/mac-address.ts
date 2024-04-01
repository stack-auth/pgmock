export class MacAddress {
  static ZeroAddress = new MacAddress("00:00:00:00:00:00");
  static BroadcastAddress = new MacAddress("ff:ff:ff:ff:ff:ff");

  public readonly bytes: Uint8Array;

  constructor(bytes: Iterable<number>);
  constructor(str: string);
  constructor(data: Iterable<number> | string) {
    if (typeof data === "string") {
      data = data.split(":").map((byte) => parseInt(byte, 16));
    }

    const bytesArray = new Uint8Array(data);
    if (bytesArray.length !== 6) {
      throw new Error("MAC address must be 6 bytes");
    }
    this.bytes = bytesArray;
  }

  equals(other: MacAddress) {
    return this.bytes.every((byte, i) => byte === other.bytes[i]);
  }

  isRecipientOfTarget(targetAddress: MacAddress) {
    return targetAddress.equals(MacAddress.BroadcastAddress) || targetAddress.equals(this);
  }


  toString() {
    return Array.from(this.bytes).map((byte) => byte.toString(16).padStart(2, "0")).join(":");
  }
}
