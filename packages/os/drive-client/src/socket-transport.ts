/**
 * Bun socket transports (Unix and TCP) for the Spacedrive daemon. Bun-only:
 * webviews and browsers use TauriTransport or HttpTransport from "./transport".
 */

import { DEFAULT_EVENT_SUBSCRIPTION } from "./event-filter";
import type { SubscriptionOptions, Transport } from "./transport";

/**
 * TCP socket transport for Bun/Node environments
 * Connects to daemon via TCP (e.g., "127.0.0.1:6969")
 */
export class TcpSocketTransport implements Transport {
	constructor(private socketAddr: string) {}

	async sendRequest(request: any): Promise<any> {
		// Parse socket address (e.g., "127.0.0.1:6969")
		const [hostname, portStr] = this.socketAddr.split(":");
		const port = parseInt(portStr, 10);

		return new Promise((resolve, reject) => {
			let buffer = "";

			// @ts-ignore - Bun global
			Bun.connect({
				hostname,
				port,
				socket: {
					data(socket: any, data: any) {
						buffer += new TextDecoder().decode(data);

						const newlineIndex = buffer.indexOf("\n");
						if (newlineIndex !== -1) {
							const line = buffer.slice(0, newlineIndex).trim();
							socket.end();
							try {
								resolve(JSON.parse(line));
							} catch (e) {
								reject(e);
							}
						}
					},
					open(socket: any) {
						const requestLine = JSON.stringify(request) + "\n";
						socket.write(requestLine);
					},
					error(_socket: any, error: Error) {
						reject(error);
					},
					close(_socket: any) {
						if (buffer && !buffer.includes("\n")) {
							reject(new Error("Connection closed without complete response"));
						}
					},
				},
			});
		});
	}

	async subscribe(
		callback: (event: any) => void,
		options?: SubscriptionOptions,
	): Promise<() => void> {
		// Parse socket address
		const [hostname, portStr] = this.socketAddr.split(":");
		const port = parseInt(portStr, 10);

		let socketInstance: any = null;
		let buffer = "";

		// Subscribe to relevant events
		const subscribeRequest = {
			Subscribe: {
				event_types: options?.event_types ?? DEFAULT_EVENT_SUBSCRIPTION,
				filter: options?.filter ?? null,
			},
		};

		// @ts-ignore - Bun global
		socketInstance = await Bun.connect({
			hostname,
			port,
			socket: {
				data(_socket: any, data: any) {
					buffer += new TextDecoder().decode(data);

					let newlineIndex: number;
					while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
						const line = buffer.slice(0, newlineIndex).trim();
						buffer = buffer.slice(newlineIndex + 1);

						if (line) {
							try {
								const response = JSON.parse(line);

								// Handle DaemonResponse variants
								if (response === "Subscribed" || response.Subscribed !== undefined) {
									// Subscription acknowledgment, don't forward
								} else if (response.Event) {
									// Event message, forward to callback
									callback(response.Event);
								} else if (response.LogMessage) {
									// Log message, forward to callback
									callback(response.LogMessage);
								} else {
									console.warn("[TcpSocketTransport] Unexpected response:", response);
								}
							} catch (e) {
								console.error("[TcpSocketTransport] Parse error:", e);
							}
						}
					}
				},
				open(socket: any) {
					// Send subscription request once connected
					socket.write(JSON.stringify(subscribeRequest) + "\n");
				},
				error(_socket: any, error: Error) {
					console.error("[TcpSocketTransport] Socket error:", error);
				},
				close(_socket: any) {
					console.log("[TcpSocketTransport] Connection closed");
				},
			},
		});

		// Return unsubscribe function
		return () => {
			if (socketInstance) {
				socketInstance.end();
			}
		};
	}
}

/**
 * Unix socket transport for Bun/Node environments
 * Note: This won't work in browser, use TauriTransport instead
 */
export class UnixSocketTransport implements Transport {
	constructor(private socketPath: string) {}

	async sendRequest(request: any): Promise<any> {
		// Bun runtime only: Bun sockets are handler-based (no stream reader).
		return new Promise((resolve, reject) => {
			let buffer = "";
			let settled = false;

			// @ts-ignore - Bun global
			Bun.connect({
				unix: this.socketPath,
				socket: {
					data(socket: any, data: any) {
						buffer += new TextDecoder().decode(data);

						const newlineIndex = buffer.indexOf("\n");
						if (newlineIndex !== -1 && !settled) {
							settled = true;
							const line = buffer.slice(0, newlineIndex).trim();
							socket.end();
							try {
								resolve(JSON.parse(line));
							} catch (e) {
								reject(e);
							}
						}
					},
					open(socket: any) {
						socket.write(JSON.stringify(request) + "\n");
					},
					error(_socket: any, error: Error) {
						if (!settled) {
							settled = true;
							reject(error);
						}
					},
					close(_socket: any) {
						if (!settled) {
							settled = true;
							reject(new Error("Connection closed without response"));
						}
					},
				},
			}).catch(reject);
		});
	}

	async subscribe(
		callback: (event: any) => void,
		options?: SubscriptionOptions,
	): Promise<() => void> {
		// Subscribe to relevant events (excludes spammy LogMessage/JobProgress)
		const subscribeRequest = {
			Subscribe: {
				event_types: options?.event_types ?? DEFAULT_EVENT_SUBSCRIPTION,
				filter: options?.filter ?? null,
			},
		};

		let buffer = "";

		// @ts-ignore - Bun global
		const socket = await Bun.connect({
			unix: this.socketPath,
			socket: {
				data(_socket: any, data: any) {
					buffer += new TextDecoder().decode(data);

					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (!line.trim()) continue;

						try {
							const response = JSON.parse(line);
							if (response && typeof response === "object" && "Event" in response) {
								callback(response.Event);
							}
						} catch (error) {
							console.error("Failed to parse event:", error);
						}
					}
				},
				open(conn: any) {
					conn.write(JSON.stringify(subscribeRequest) + "\n");
				},
				error(_socket: any, error: Error) {
					console.error("[UnixSocketTransport] Socket error:", error);
				},
			},
		});

		return () => socket.end();
	}
}
