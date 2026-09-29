import {
	BodyParams,
	Context,
	Controller,
	Get,
	Patch,
	PathParams,
	Post,
	Req,
	Res,
	UseBefore,
} from "@tsed/common";
import type { Request, Response } from "express";

import { RankedDisputeNotifier } from "@/services";
import { BaseController } from "@/utils/classes";
import { resolveDependency } from "@/utils/functions";
import { urlsConfig } from "@/configs";
import { emitToUsers } from "../../websockets/socket-server";

@Controller("/notifications")
export class NotificationsController extends BaseController {
	private async forward(req: Request, res: Response, path: string, method = req.method) {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, { method, headers });
		const text = await upstream.text();
		res.status(upstream.status).type("json");
		return res.send(text);
	}

	@Get("/me")
	async getUserNotifications(@Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, "/notifications/me", "GET");
	}

	@Patch("/read/:id")
	async markAsRead(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/notifications/read/${encodeURIComponent(String(id))}`, "PATCH");
	}

	/**
	 * Mark a single notification as unread
	 */
	@Patch("/unread/:id")
	async markAsUnread(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/notifications/unread/${encodeURIComponent(String(id))}`, "PATCH");
	}

	/**
	 * Mark all user notifications as read
	 */
	@Patch("/read-all")
	async markAllAsRead(@Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, "/notifications/read-all", "PATCH");
	}

	// Endpoint interne appele par le sub-process Colyseus pour emettre un event
	// Socket.IO `match_found` aux deux joueurs apparies.
	// SECURITE : derriere le proxy /api du serveur ranked, l'IP loopback n'est PAS
	// fiable (toute requete publique nginx->ranked:4002->bot:4000 arrive en
	// 127.0.0.1). On exige donc le secret partage `RANKED_INTERNAL_SECRET` (meme
	// .env, envoye par match-factory.ts). A defaut de secret configure (dev local),
	// on retombe sur un controle loopback strict.
	@Post("/emit-match-found")
	async emitMatchFound(
		@Req() req: Request,
		@BodyParams() body: { userIds?: string[]; payload?: unknown },
		@Res() res: Response
	) {
		const internalSecret = process.env.RANKED_INTERNAL_SECRET ?? "";
		if (internalSecret.length > 0) {
			if (req.headers["x-internal-secret"] !== internalSecret)
				return res.status(403).json({ success: false, error: "forbidden" });
		} else {
			const remote = req.ip || req.socket.remoteAddress || "";
			const isLoopback =
				remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
			if (!isLoopback) return res.status(403).json({ success: false, error: "forbidden" });
		}

		const userIds = Array.isArray(body?.userIds)
			? body.userIds.filter((id) => typeof id === "string")
			: [];
		if (userIds.length === 0)
			return res.status(400).json({ success: false, error: "userIds required" });

		try {
			emitToUsers(userIds, "match_found", body?.payload ?? {});

			return res.status(200).json({ success: true });
		} catch (err: any) {
			console.error("[notifications] emit-match-found failed", err);

			return res.status(500).json({ success: false, error: err?.message ?? "internal" });
		}
	}

	// Endpoint interne generique : pousse un event Socket.IO arbitraire a une liste de
	// joueurs (ex. `rematch_offer` emis par le sub-process Colyseus lors d'une revanche).
	// Memes garde-fous que emit-match-found : secret partage, sinon loopback strict.
	@Post("/emit-to-users")
	async emitToUsersInternal(
		@Req() req: Request,
		@BodyParams() body: { userIds?: string[]; event?: string; payload?: unknown },
		@Res() res: Response
	) {
		const internalSecret = process.env.RANKED_INTERNAL_SECRET ?? "";
		if (internalSecret.length > 0) {
			if (req.headers["x-internal-secret"] !== internalSecret)
				return res.status(403).json({ success: false, error: "forbidden" });
		} else {
			const remote = req.ip || req.socket.remoteAddress || "";
			const isLoopback =
				remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
			if (!isLoopback) return res.status(403).json({ success: false, error: "forbidden" });
		}

		const userIds = Array.isArray(body?.userIds)
			? body.userIds.filter((id) => typeof id === "string")
			: [];
		const event = typeof body?.event === "string" ? body.event : "";
		if (userIds.length === 0 || !event)
			return res.status(400).json({ success: false, error: "userIds and event required" });

		try {
			emitToUsers(userIds, event, body?.payload ?? {});

			return res.status(200).json({ success: true });
		} catch (err: any) {
			console.error("[notifications] emit-to-users failed", err);

			return res.status(500).json({ success: false, error: err?.message ?? "internal" });
		}
	}

	/**
	 * Relaie une preuve de litige Ranked vers le salon des Tournament Organizers.
	 * Appelé en interne par le sous-process ranked après l'upload d'une capture.
	 */
	@Post("/ranked-proof")
	async rankedProofInternal(
		@Req() req: Request,
		@BodyParams() body: { lobbyId?: number; userId?: string; url?: string },
		@Res() res: Response
	) {
		const internalSecret = process.env.RANKED_INTERNAL_SECRET ?? "";
		if (internalSecret.length > 0) {
			if (req.headers["x-internal-secret"] !== internalSecret)
				return res.status(403).json({ success: false, error: "forbidden" });
		} else {
			const remote = req.ip || req.socket.remoteAddress || "";
			const isLoopback =
				remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
			if (!isLoopback) return res.status(403).json({ success: false, error: "forbidden" });
		}

		const lobbyId = Number(body?.lobbyId);
		const userId = typeof body?.userId === "string" ? body.userId : "";
		const url = typeof body?.url === "string" ? body.url : "";
		if (!lobbyId || !userId || !url)
			return res.status(400).json({ success: false, error: "lobbyId, userId, url required" });

		try {
			const notifier = await resolveDependency(RankedDisputeNotifier);
			void notifier.notifyProofToTO(lobbyId, userId, url);

			return res.status(200).json({ success: true });
		} catch (err: any) {
			console.error("[notifications] ranked-proof failed", err);

			return res.status(500).json({ success: false, error: err?.message ?? "internal" });
		}
	}
}
