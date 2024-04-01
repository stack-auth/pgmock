export function throwErr(err: string | Error): never {
  throw typeof err === "string" ? new Error(err) : err;
}
