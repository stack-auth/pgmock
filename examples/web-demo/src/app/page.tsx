"use client";

import { Editor } from "@monaco-editor/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PostgresMock } from "../../../../dist/main";
import Terminal from "./terminal";
import { Client } from "pg";

export default function Home() {
  const [query, setQuery] = useState("select * from books;");
  const [queryLoadingCounter, setQueryLoadingCounter] = useState(0);
  const [queryResult, setQueryResult] = useState<string>("");
  const [mock, setMock] = useState<PostgresMock | null>(null);
  const [client, setClient] = useState<Client | null>(null);

  useEffect(() => {
    let cancelled = false;
    const destructorPromise = (async () => {
      const mock = await PostgresMock.create();
      if (!cancelled) setMock(mock);
      const client = new Client(mock.getNodePostgresConfig());
      await client.connect();
      await client.query(`
        create table books (id serial primary key, title text);
        insert into books (title) values ('The Great Gatsby');
        insert into books (title) values ('Heartstopper');
        insert into books (title) values ('The Catcher in the Rye');
      `);
      if (!cancelled) setClient(client);
      await client.query(`select * from books;`);
      return () => {
        mock.destroy();
      };
    })();
    return () => {
      cancelled = true;
      destructorPromise.then(destructor => destructor());
    };
  }, []);

  return (
    <main>
      <h1>pgmock Web Demo</h1>
      <p>
        <Link href="https://github.com/stackframe-projects/pgmock" target="_blank" rel="noopener noreferrer">pgmock repository</Link>
        {" — "}
        <Link href="https://discord.gg/pD4nyYyKrb" target="_blank" rel="noopener noreferrer">Discord</Link>
      </p>
      <p style={{
        color: "grey",
        fontSize: "0.8em",
      }}>
        This is a web demo for pgmock, a feature-complete PostgreSQL mock for WebAssembly.
      </p>
      <p style={{
        color: "grey",
        fontSize: "0.8em",
      }}>
        It is designed for use in unit and E2E testing, but can run standalone in-memory in a browser. For more information, check the <Link href="https://github.com/stackframe-projects/pgmock" target="_blank" rel="noopener noreferrer">pgmock repository</Link>.
      </p>
      <p style={{
        color: "grey",
        fontSize: "0.8em",
      }}>
        If your primary use case is to run a database in the browser (and only the browser), you might want to consider <Link href="https://github.com/electric-sql/pglite" target="_blank" rel="noopener noreferrer">pglite</Link> instead. It is more performant and lightweight (with a limited feature set). pgmock is designed for feature parity with production PostgreSQL environments, as you would want in a testing environment.
      </p>
      <h2>node-postgres Queries</h2>
      <div>
        <div style={{
          border: "1px solid grey",
        }}>
          <Editor
            height="100px"
            defaultLanguage="sql"
            defaultValue={query}
            onChange={(value) => setQuery(value ?? "")}
          />
        </div>
        <button
          disabled={queryLoadingCounter > 0 || !client}
          onClick={async () => {
            setQueryLoadingCounter(q => q + 1);
            try {
              const res = await client!.query(query);
              setQueryResult(JSON.stringify(res.rows, null, 2));
            } catch (e: any) {
              console.error(e);
              setQueryResult(e?.message ?? `${e}`);
            } finally {
              setQueryLoadingCounter(q => q - 1);
            }
          }}
        >
          {!mock ? "Downloading Postgres image... This may take a minute or two." : !client ? "Connecting to instance..." : queryLoadingCounter > 0 ? "..." : "Run query"}
        </button>
        <pre style={{ maxHeight: 100, overflowY: "scroll", backgroundColor: "rgba(0.5, 0.5, 0.5, 0.05)" }}>
          {queryResult}
        </pre>
        <div
          style={{
            color: "grey",
            fontSize: "0.8em",
          }}
        >
          Example source code:
          <pre>
            const postgresMock = new PostgresMock();<br />
            const client = new pg.Client(postgresMock.getNodePostgresConfig());<br />
            await client.connect();<br />
            await client.query(...);
          </pre>
        </div>
      </div>
      <h2>Serial console</h2>
      {mock ? (
        <div>
          <Terminal
            onInit={(terminal) => {
              terminal.onData((data) => {
                mock?.subtle.serialConsole.write(data);
              });
              mock?.subtle.serialConsole.onReceiveByte((byte) => {
                terminal.write(new Uint8Array([byte]));
              });
              terminal.write("Welcome to the serial console of your pgmock database.\r\n");
            }}
          />
          <div
            style={{
              color: "grey",
              fontSize: "0.8em",
            }}
          >
            Example source code:
            <pre>
              const postgresMock = new PostgresMock();<br />
              const connectionString = postgresMock.listen(5432);<br />
              console.log(`Connect to Postgres: psql ${'{'}connectionString{'}'}`);
            </pre>
          </div>
        </div>
      ) : (
        <p>Downloading Postgres image...</p>
      )}
    </main>
  );
}
