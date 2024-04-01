import type * as net from 'net';
import { EventEmitter } from 'events';
import { Tcp, TcpHandler, TcpSocket } from '../protocols/tcp.js';
import { Ipv4Address } from '../addresses/ip-address.js';
import { Logger } from '../logger.js';

type PartialNetSocketInterface = {
  [k in keyof net.Socket]?: net.Socket[k] extends (...args: infer A) => net.Socket ? (...args: A) => PartialNetSocketInterface : net.Socket[k];
};

export class PostgresConnectionSocket extends EventEmitter implements NetLikeSocketEventEmitter {
  private _netLikeSocket: NetLikeSocket;

  constructor(
    private readonly _tcpHandler: TcpHandler<Tcp>,
    private readonly _clientIp: Ipv4Address,
    private readonly _serverIp: Ipv4Address,
    private readonly _requestClientPort: () => number,
    private readonly _serverPort: number,
  ) {
    super();
    this._netLikeSocket = new NetLikeSocket(_tcpHandler, _clientIp, _requestClientPort);

    this._netLikeSocket.on('data', (data) => {
      this.emit('data', data);
    });
    this._netLikeSocket.on('connect', () => {
      this.emit('connect');
    });
    this._netLikeSocket.on('close', () => {
      this.emit('close');
    });
  }

  connect() {
    this._netLikeSocket.connect(this._serverPort, this._serverIp.toString());
  }

  end() {
    this._netLikeSocket.end();
  }

  get writable() {
    return this._netLikeSocket.writable;
  }

  write(data: Uint8Array) {
    return this._netLikeSocket.write(data);
  }

  destroy(error?: Error) {
    this._netLikeSocket.destroy(error);
  }
}

interface NetLikeSocketEventEmitter extends EventEmitter {
  on(event: "data", listener: (data: Uint8Array) => void): this;
  on(event: "connect", listener: () => void): this;
  on(event: "close", listener: () => void): this;
}

export class NetLikeSocket extends EventEmitter implements PartialNetSocketInterface, NetLikeSocketEventEmitter {
  private _tcpSocket: TcpSocket | null = null;
  private _isDestroyed = false;

  constructor(
    private readonly _tcp: TcpHandler<Tcp>,
    private readonly _clientIp: Ipv4Address,
    private readonly _requestClientPort: () => number,
  ) {
    super();
  }

  setNoDelay(noDelay?: boolean) {
    Logger.warn('setNoDelay called but currently unimplemented', noDelay);
    return this;
  }

  setKeepAlive(enable: number | unknown, initialDelay: number | unknown): PartialNetSocketInterface {
    Logger.warn('setKeepAlive called but currently unimplemented', enable, initialDelay);
    return this;
  }

  connect(port?: unknown, host?: unknown) {
    this.ensureNotDestroyed();

    if (typeof port !== 'number') throw new Error('Only numeric first arguments are supported');
    if (typeof host !== 'string') throw new Error('Only string second arguments are supported');

    if (this._tcpSocket) throw new Error('connect called twice');

    Logger.log('NetLikeSocket connecting', { host, port });

    let hostIp;
    try {
      hostIp = new Ipv4Address(host);
    } catch (error) {
      Logger.error('Error parsing host as IP:', { error, host, port });
      throw new Error('Only IP addresses are supported by pgmock');
    }

    this._tcpSocket = this._tcp.connect(this._clientIp, hostIp, this._requestClientPort(), port);
    this._tcpSocket.onEstablished(() => {
      this.emit('connect');
    });
    this._tcpSocket.onData((data) => {
      this.emit('data', Buffer.from(data));
    });
    this._tcpSocket.onClose(() => {
      this.emit('close');
    });

    return this;
  }

  end() {
    this.ensureNotDestroyed();
  
    this._tcpSocket?.close();
    return this;
  }
  
  destroy(error?: Error | undefined) {
    this.ensureNotDestroyed();

    if (error !== undefined) {
      this.emit('error', error);
    }
    this._tcpSocket?.close();
    this._isDestroyed = true;
    return this;
  }

  private ensureNotDestroyed() {
    if (this._isDestroyed) throw new Error('Socket is destroyed');
  }

  get writable() {
    if (!this._tcpSocket) return false;
    
    return !this._tcpSocket.isClosed();
  }

  write(data: Uint8Array) {
    this.ensureNotDestroyed();

    if (!this._tcpSocket) throw new Error('write called before connect');
    this._tcpSocket.write(data);

    return true;
  }

  ref(): never {
    // TODO implement ref()
    throw new Error(`ref() and unref() are currently not implemented in pgmock. Please open an issue if you need this feature.`);
  }

  unref(): never {
    // TODO implement ref()
    throw new Error(`ref() and unref() are currently not implemented in pgmock. Please open an issue if you need this feature.`);
  }
};
