import { PostgresMock } from "pgmock";

(async () => {
  console.log("Starting Postgres mock server...");

  const mock = await PostgresMock.create();
  const connectionString = await mock.listen(0);
  console.log(`Postgres mock is now listening on ${connectionString}`);
  console.log(`To access: psql ${connectionString}`);
})().catch(console.error);
