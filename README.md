# pgmock
<h3 align="center">
  <a href="https://stackframe-projects.github.io/pgmock">Demo</a> —
  <a href="https://discord.gg/pD4nyYyKrb">Discord</a>
</h3>

`pgmock` is an in-memory PostgreSQL mock server for unit and E2E tests. It requires no external dependencies and runs entirely within WebAssembly on both Node.js and the browser.

## Getting started
After `npm install pgmock`, you can run an in-memory server like so:

```typescript
const mock = await PostgresMock.create();
const connectionString = await mock.listen(5432);
```

Recommended: If you use `node-postgres` (`pg` on npm), `pgmock` provides you with a configuration object that doesn't require you to serve on a port (and also works in the browser):

```typescript
const mock = await PostgresMock.create();
const client = new pg.Client(mock.getNodePostgresConfig());

await client.connect();
console.log(await client.query('SELECT $1::text as message', ['Hello world!']));
```

It is considered good practice to destroy the mock server after you are done with it to free up resources:

```typescript
mock.destroy();
```

## Browser support

`pgmock` fully supports browser environments. While webapps can't listen to TCP ports, you can still use `PostgresMock.createSocket` and the `node-postgres` configuration. However, if your bundler statically analyzes imports, the default configuration may throw an error because of missing Node.js modules. Check `examples/web-demo/next.config.mjs` for an example on how to configure Webpack for bundling.

If your primary use case is to run a database in the browser (and only the browser), you might want to consider [pglite](https://github.com/electric-sql/pglite) instead. It is more performant and lightweight (with a limited feature set). `pgmock` is designed for full compatibility with production PostgreSQL environments, as you would want in a testing environment.

## How does it work?

There are two approaches to run Postgres in WebAssembly; by [forking it to support WASM natively](https://github.com/electric-sql/postgres-wasm) or by [emulating the Postgres server in an x86 emulator](https://supabase.com/blog/postgres-wasm). The former is more performant and uses considerably less memory, but only supports single-user mode (no connections), and cannot use any extensions.

To prevent discrepancies between testing and production, and because performance is not usually a concern in tests, `pgmock` currently uses the latter approach. In the mid-term future, once native Postgres WASM forks mature, we plan to switch to that. We don't expect there to be many breaking changes besides the APIs inside `PostgresMock.subtle`.

`pgmock` differs from previous Postgres-in-the-browser projects by providing full feature-compatibility entirely inside the JavaScript runtime, without depending on a network proxy for communication. We did this by simulating a network stack in JavaScript that behaves like a real network, that can simulate TCP connections even on platforms that do not allow raw socket access.

## Wanna contribute? 

Great! We have a [Discord server](https://discord.gg/pD4nyYyKrb) where you can talk to us.
