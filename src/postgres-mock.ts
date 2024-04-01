import { Ipv4Address } from "./addresses/ip-address.js";
import { bootEmulator, sendScript } from "./boot.js";
import { NodePostgresConnector } from "./connectors/node-postgres.js";
import { PostgresConnectionSocket } from "./connectors/sockets.js";
import { Logger } from "./logger.js";
import { NetworkAdapter } from "./network-adapter.js";

export type SerialTerminal = {
  write(data: Uint8Array | string): void;
  onReceiveByte(callback: (byte: number) => void): void;
};

export type PostgresMockCreationOptions = {
  /**
   * Advanced options for expert use cases.
   */
  subtle?: {
    v86Options?: any,
  },
};

export class PostgresMock {
  private _curPort = 12400;
  private _curShellScriptId = 0;
  private readonly _serialTerminal: SerialTerminal;

  private constructor(
    private _emulator: {
      network_adapter: NetworkAdapter,
      add_listener: (event: string, callback: (e: any) => void) => void,
      serial0_send: (data: Uint8Array | string) => void,
      destroy: () => void,
    } | null
  ) {
    if (!_emulator) {
      throw new Error("Must use PostgresMock.create() to create a PostgresMock instance");
    }

    this._serialTerminal = {
      write: (data: Uint8Array | string) => {
        _emulator.serial0_send(data);
      },
      onReceiveByte: (callback: (byte: number) => void) => {
        _emulator.add_listener("serial0-output-byte", callback);
      },
    };
  }

  /**
   * Creates a new PostgresMock instance.
   * 
   * Remember to call `destroy()` on the instance when you're done with it to free up resources.
   * 
   * @param options Options for creating the PostgresMock instance. See `PostgresMockCreationOptions` for more information.
   */
  public static async create(options: PostgresMockCreationOptions = {}) {
    Logger.log("Creating PostgresMock. Don't forget to destroy it!");
    const emulator = await bootEmulator(options);
    return new PostgresMock(emulator);
  }

  /**
   * Runs a shell command on the Postgres emulator.
   * 
   * Does not currently return the output of the command.
   */
  public runShellCommand(command: string) {
    if (!this._emulator) {
      throw new Error("Postgres emulator has already been destroyed!");
    }
    Logger.log("Executing shell command on pgmock emulator", command);

    sendScript(this._emulator, `pgmock-shell-command-${this._curShellScriptId++}.sh`, command);
  }

  /**
   * Creates a Socket object to communicate with the Postgres instance, similar to but less capable than a net.Socket object.
   */
  public createSocket() {
    if (!this._emulator) {
      throw new Error("Postgres emulator has already been destroyed!");
    }

    return new PostgresConnectionSocket(
      this._emulator.network_adapter.ethernet.protocols.ipv4.protocols.tcp,
      this._emulator.network_adapter.router.ip,
      new Ipv4Address("192.168.0.1"),
      () => this._assignPort(),
      5432,
    );
  }

  /**
   * If running on Node.js, serves the Postgres mock on the given port. Returns a Postgres connection URL of the form `postgresql://...@localhost:PORT`.
   */
  public async listen(port: number) {
    if (!this._emulator) {
      throw new Error("Postgres emulator has already been destroyed!");
    }

    const errorDesc = "listen() is only available in Node.js environments, but the `net` module was not found.";
    let net;
    try {
      net = await import("net");
    } catch (e) {
      throw new Error(errorDesc);
    }
    if (!net?.createServer) {
      throw new Error(errorDesc);
    }
    Logger.log("Dependencies imported");
    
    const server = net.createServer((socket) => {
      const pgSocket = this.createSocket();
      pgSocket.connect();
      socket.on("data", (data) => {
        pgSocket.write(data);
      });
      pgSocket.on("data", (data) => {
        socket.write(data);
      });
    });
    Logger.log("pgmock server created");
  
    await new Promise<void>(resolve => server.listen(port, resolve));
    const actualPort = (server.address() as any).port;
    Logger.log("pgmock server listening on port", actualPort);

    return `postgresql://postgres:pgmock@localhost:${actualPort}`;
  }

  /**
   * Returns a configuration object for a node-postgres ("pg") client.
   *
   * @example
   * ```typescript
   * import { Client } from "pg";
   * import { PostgresMock } from "pgmock";
   * 
   * const mock = await PostgresMock.create();
   * const pgClient = new Client(mock.getNodePostgresConfig());
   * 
   * // you can use pgClient like any other node-postgres client
   * await pgClient.connect();
   * const res = await pgClient.query('SELECT $1::text as message', ['Hello world!']);
   * Logger.log("Postgres query result:", res);
   * 
   * // it's good practice to destroy the mock in the end to prevent memory leaks
   * mock.destroy();
   * ```
   */
  public getNodePostgresConfig() {
    if (!this._emulator) {
      throw new Error("Postgres emulator has already been destroyed!");
    }

    return NodePostgresConnector.getConfig(
      this._emulator.network_adapter.ethernet.protocols.ipv4.protocols.tcp,
      this._emulator.network_adapter.router.ip,
      new Ipv4Address("192.168.0.1"),
      () => this._assignPort(),
      5432,
    );
  }

  /**
   * Advanced functionality for PostgresMock, giving direct access to the emulator.
   * 
   * This may change in future versions, so use with caution. Useful for debugging and advanced use cases.
   * 
   * If you don't know what you're doing, you probably don't need this.
   */
  public get subtle() {
    const that = this;
    return {
      /**
       * The underlying V86 emulator.
       * 
       * For advanced use cases only, as modifying this can break your pgmock setup.
       * 
       * Check the [corresponding file in the V86 repository](https://github.com/copy/v86/blob/master/src/browser/starter.js) for more information.
       */
      get v86() {
        return that._emulator;
      },

      /**
       * Starts capturing the network traffic between the emulator and the host.
       * 
       * When the network capture is stopped, the captured data is returned in the `pcap` format, from where it can be read with tools like Wireshark.
       */
      startNetworkCapture() {
        if (!that._emulator) {
          throw new Error("Postgres emulator has already been destroyed!");
        }

        return that._emulator.network_adapter.startCapture();
      },

      /**
       * The serial terminal interface of the emulator.
       * 
       * Meant to be used for visual debugging, and not for programmatic access.
       */
      get serialTerminal() {
        return that._serialTerminal;
      }
    };
  }

  private _assignPort() {
    Logger.log("Assigning new port", this._curPort);
    return this._curPort++;
  }

  public destroy() {
    if (!this._emulator) {
      throw new Error("Postgres emulator has already been destroyed!");
    }

    Logger.log("Destroying PostgresMock.");
    this._emulator.destroy();
    this._emulator = null;
  }
}
