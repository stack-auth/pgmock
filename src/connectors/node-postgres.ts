import type * as net from 'net';
import { Tcp, TcpHandler } from '../protocols/tcp.js';
import { Ipv4Address } from '../addresses/ip-address.js';
import { NetLikeSocket } from './sockets.js';

export const NodePostgresConnector = {
  getConfig: (
    tcpHandler: TcpHandler<Tcp>,
    clientIp: Ipv4Address,
    serverIp: Ipv4Address,
    requestClientPort: () => number,
    serverPort: number,
  ) => {
    return {
      host: serverIp.toString(),
      port: serverPort,
      user: "postgres",
      password: "pgmock",
      stream: () => {
        return new NetLikeSocket(tcpHandler, clientIp, requestClientPort) as any as net.Socket;
      },
    };
  },
};
