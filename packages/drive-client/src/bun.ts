/**
 * Bun entry point: socket transports and client factories for the Spacedrive
 * daemon. Webview bundles import "@aphrody/drive-client" instead.
 */

import { SpacedriveClient } from "./client";
import { TcpSocketTransport, UnixSocketTransport } from "./socket-transport";

export { TcpSocketTransport, UnixSocketTransport };

/** Client over a Unix socket. */
export function clientFromSocket(socketPath: string): SpacedriveClient {
  return new SpacedriveClient(new UnixSocketTransport(socketPath));
}

/** Client over TCP, e.g. "127.0.0.1:6969". */
export function clientFromTcpSocket(socketAddr: string): SpacedriveClient {
  return new SpacedriveClient(new TcpSocketTransport(socketAddr));
}
