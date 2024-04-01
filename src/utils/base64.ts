export function base64ToUint8Array(base64: string) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
      if (bytes[i] > 255) {
        throw new Error("Either atob or string iteration is not spec compliant, please make sure your runtime is supported");
      }
  }
  return bytes;
}

export function base64FromUint8Array(uint8Array: Uint8Array) {
  let binary_string = "";
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary_string += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary_string);
}
