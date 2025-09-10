import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  tokenStore: "cookie",

  // get your Stack Auth API keys from https://app.stack-auth.com and store them in a safe place (eg. environment variables)
  publishableClientKey: INSERT_YOUR_PUBLISHABLE_CLIENT_KEY_HERE,
});
