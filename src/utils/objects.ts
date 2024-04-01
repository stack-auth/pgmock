export function pick<T extends object, S extends keyof T & (string | number)>(from: T, ...keys: `${S}`[]): Pick<T, S> {
  const set = new Set(keys);
  return Object.fromEntries(Object.entries(from).filter(([k, v]) => set.has(k as any))) as any;
}
