export function toUnsignedIntFromBigEndian(byteArray: Uint8Array) {
  return byteArray.reduce((acc, byte, index) => acc + byte * 256 ** (byteArray.length - index - 1), 0);
}

export function toBigEndianFromInt(bytes: number, int: number): Uint8Array {
  if (!Number.isSafeInteger(int)) {
    throw new Error("int must be an integer in the safe integer range");
  }
  if (int < 0) {
    int = 256 ** bytes + int;
  }
  if (int < 0) {
    throw new Error("int is too small to fit in the specified number of bytes");
  }
  if (int >= 256 ** bytes) {
    throw new Error("int is too large to fit in the specified number of bytes");
  }

  const result = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    result[i] = int / 256 ** (bytes - i - 1);
  }
  return result;
}
