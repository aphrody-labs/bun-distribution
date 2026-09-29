import http from "node:http";

import type { DefaultEventsMap, ExtendedError, Socket } from "socket.io";
import { Server as SocketIOServer } from "socket.io";

import {
	getCookieValue,
	SESSION_COOKIE_NAME,
	verifyRealtimeToken,
	verifySessionToken,
} from "@/auth";
import { urlsConfig } from "@/configs/urls";

// Socket.IO ne nécessite aucun middleware Express : le serveur HTTP natif suffit.
const server = http.createServer();

// Create a Socket.IO server on top
export const io = new SocketIOServer(server, {
	cors: {
		// Allowlist d'origines (WEB_ALLOWED_ORIGINS) au lieu de refléter n'importe quelle origine.
		origin: [...urlsConfig.allowedOrigins],
		credentials: true,
	},
});

// ─── GLOBAL JWT AUTH MIDDLEWARE ─────────────────────────────────────────
function authMiddleware(
	socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
	next: (err?: ExtendedError) => void
) {
	try {
		// Le front cross-domain (achillea.* → ranked.*) ne peut PAS s'appuyer sur le cookie
		// `token` (il ne traverse pas le domaine, exactement comme pour Colyseus). On accepte
		// donc le JWT passé dans le handshake Socket.IO (`auth: { token }`), avec repli cookie
		// pour le same-origin (dev local).
		const authToken =
			typeof (socket.handshake.auth as { token?: unknown })?.token === "string"
				? (socket.handshake.auth as { token: string }).token
				: null;
		const rawCookie = socket.handshake.headers.cookie;
		const cookieToken = rawCookie ? getCookieValue(rawCookie, SESSION_COOKIE_NAME) : null;
		const token = authToken ?? cookieToken;
		if (!token) {
			console.warn("⚠ Token absent (ni handshake auth ni cookie)");

			return next(new Error("Authentication error"));
		}

		const payload = authToken ? verifyRealtimeToken(token) : verifySessionToken(token);
		(socket as any).user = payload;

		next();
	} catch (err) {
		next(new Error("Authentication error"));
	}
}

// ─── /notifications ─────────────────────────────────────────────────────
export const notificationsNs = io.of("/notifications");

notificationsNs.use(authMiddleware);

notificationsNs.on("connection", (socket) => {
	const user = (socket as any).user;
	console.info("📬 /notifications connected", socket.id, "user:", user);

	socket.join(`user:${user.id}`);

	socket.on("disconnect", () => {
		console.info("❌ /notifications disconnected", socket.id);
	});
});

export function emitToUsers(userIds: string[], event: string, payload: any) {
	if (userIds.length === 0) {
		return;
	}

	// You can pass an array of rooms directly
	notificationsNs.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
}

export async function startSocketServer(port: number, host = "127.0.0.1"): Promise<void> {
	if (server.listening) return;

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			console.info(`🟦 Socket.IO server listening on ${host}:${port}`);
			resolve();
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}

export async function stopSocketServer(): Promise<void> {
	if (!server.listening) return;

	await new Promise<void>((resolve) => {
		io.close(() => resolve());
	});
}
