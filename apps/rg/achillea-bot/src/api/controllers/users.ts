import {
	BodyParams,
	Context,
	Controller,
	Get,
	PathParams,
	Post,
	Put,
	QueryParams,
	Req,
	Res,
	UseBefore,
} from "@tsed/common";
import { BadRequest, NotFound, Unauthorized } from "@tsed/exceptions";
import type { Response } from "express";

import { CookieAuthorize } from "@/api/middlewares";
import {
	CustomImagesUpload,
	PlayerCardService,
	UserService,
} from "@/services";
import type { UserDTO } from "@/services";
import { BaseController } from "@/utils/classes";
import { MatchMode, UserRole } from "@/utils/enums";
import { resolveDependenciesSync } from "@/utils/functions";

@Controller("/users")
export class UsersController extends BaseController {
	private userService: UserService;
	private imageService: CustomImagesUpload;
	private cardService: PlayerCardService;

	constructor() {
		super();

		[this.userService, this.imageService, this.cardService] =
			resolveDependenciesSync([
				UserService,
				CustomImagesUpload,
				PlayerCardService,
			]);
	}

	@Put("/me/profile")
	@UseBefore(CookieAuthorize)
	async updateMyProfile(@BodyParams() body: { bio?: string | null; twitchUrl?: string | null }, @Req() req: any, @Res() res: Response) {
		const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(`${process.env.UNIFIED_API_URL ?? "http://127.0.0.1:8800"}/v1/achillea/users/me/profile`, { method: "PUT", headers, body: JSON.stringify(body) });
		return res.status(upstream.status).json(await upstream.json());
	}

	// IMPORTANT : routes statiques AVANT @Get('/:id') sinon Express matche le wildcard.

	// Indexe / met en cache les avatars Discord de la cohorte (staff, joueurs actifs,
	// membres de clan) dans user.avatar → le ranked (ranked/db.ts), le leaderboard et les
	// membres de clan les lisent sans fetch Discord. Lancé en arrière-plan (~1-2 min). Admin.
	@Post("/resync-avatars")
	@UseBefore(CookieAuthorize)
	resyncAvatars(@Context() ctx: Context, @Res() res: Response) {
		const user = ctx.get("user") as UserDTO | undefined;
		if (!user || (user.role ?? 0) < UserRole.Administrator) {
			return res.status(403).json({ error: "Réservé au staff" });
		}
		void this.userService.resyncAvatars().catch((e) => console.error("[resync-avatars]", e));
		return res.json({ started: true });
	}

	@Get("/leaderboard")
	async leaderboard(
		@Res() res: Response,
		@QueryParams("mode") mode: number = 2,
		@QueryParams("season") seasonId: string | null = null,
		@QueryParams("limit") limit: number = 50,
		@QueryParams("offset") offset: number = 0
	) {
		const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
		const safeOffset = Math.max(0, Number(offset) || 0);
		const safeMode: MatchMode = Number(mode) === 4 ? MatchMode.TWO_VS_TWO : MatchMode.ONE_VS_ONE;

		const season = seasonId ? `&season=${encodeURIComponent(seasonId)}` : "";
		const response = await fetch(`${process.env.UNIFIED_API_URL ?? "http://127.0.0.1:8800"}/v1/achillea/users/leaderboard?mode=${safeMode}${season}&limit=${safeLimit}&offset=${safeOffset}`);
		res.status(response.status).setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
		return res.json(await response.json());
	}

	@Get("/me/ranked-history")
	@UseBefore(CookieAuthorize)
	async myRankedHistory(
		@Context("user") user: UserDTO,
		@Req() req: any,
		@Res() res: Response,
		@QueryParams("mode") mode?: number,
		@QueryParams("limit") limit: number = 20,
		@QueryParams("offset") offset: number = 0
	) {
		const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
		const safeOffset = Math.max(0, Number(offset) || 0);
		const safeMode = mode != null ? Number(mode) : null;
		const query = new URLSearchParams({ limit: String(safeLimit), offset: String(safeOffset) });
		if (safeMode !== null && Number.isFinite(safeMode)) query.set("mode", String(safeMode));
		const upstream = await this.forwardAuthenticated(req, `/v1/achillea/users/me/ranked-history?${query}`);
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	@Get("/:id/ranked-history")
	async rankedHistory(
		@PathParams("id") id: string,
		@Res() res: Response,
		@QueryParams("mode") mode?: number,
		@QueryParams("limit") limit: number = 20,
		@QueryParams("offset") offset: number = 0,
	) {
		const query = new URLSearchParams({
			limit: String(Math.max(1, Math.min(100, Number(limit) || 20))),
			offset: String(Math.max(0, Number(offset) || 0)),
		});
		if (mode != null && Number.isFinite(Number(mode))) query.set("mode", String(mode));
		const upstream = await fetch(`${process.env.UNIFIED_API_URL ?? "http://127.0.0.1:8800"}/v1/achillea/users/${encodeURIComponent(id)}/ranked-history?${query}`);
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	@Get("/me/ranked-trend")
	@UseBefore(CookieAuthorize)
	async myRankedTrend(
		@Context("user") user: UserDTO,
		@Req() req: any,
		@Res() res: Response,
		@QueryParams("mode") mode?: number,
		@QueryParams("days") days: number = 7,
		@QueryParams("last") last: number = 20
	) {
		const safeMode = mode != null ? Number(mode) : null;
		const safeDays = Math.max(1, Math.min(90, Number(days) || 7));
		const safeLast = Math.max(1, Math.min(50, Number(last) || 20));
		const query = new URLSearchParams({ days: String(safeDays), last: String(safeLast) });
		if (safeMode !== null && Number.isFinite(safeMode)) query.set("mode", String(safeMode));
		const upstream = await this.forwardAuthenticated(req, `/v1/achillea/users/me/ranked-trend?${query}`);
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	/** Compatibility transport only: identity and ranked reads belong to the unified API. */
	private async forwardAuthenticated(req: any, path: string): Promise<globalThis.Response> {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		return fetch(`${process.env.UNIFIED_API_URL ?? "http://127.0.0.1:8800"}${path}`, { headers });
	}


	@Get("/:id")
	async getUser(@PathParams("id") id: string, @Res() res: Response) {
		const upstream = await fetch(`${process.env.UNIFIED_API_URL ?? "http://127.0.0.1:8800"}/v1/achillea/users/${encodeURIComponent(id)}`);
		res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
		return res.status(upstream.status || 503).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	@Get("/:id/card.png")
	async getPlayerCard(@PathParams("id") id: string, @Res() res: Response) {
		try {
			const buf = await this.cardService.generateCard(id);
			res.setHeader("Content-Type", "image/png");
			res.setHeader("Content-Length", buf.length);
			res.setHeader("Cache-Control", "public, max-age=300");
			res.setHeader("Content-Disposition", `inline; filename="player-${id}-card.png"`);

			return res.status(200).send(buf);
		} catch (err: any) {
			if (err?.status === 404) throw err;

			throw new BadRequest(err?.message ?? "Erreur lors de la génération de la carte joueur");
		}
	}

	@Post("/:id/card/regenerate")
	@UseBefore(CookieAuthorize)
	async regeneratePlayerCard(
		@PathParams("id") id: string,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) throw new Unauthorized("Non authentifié");

		try {
			const path = await this.cardService.generateAndSave(id);

			return res.status(200).json({ success: true, path });
		} catch (err: any) {
			if (err?.status === 404) throw err;

			return res
				.status(400)
				.json({ success: false, error: err?.message ?? "Génération impossible" });
		}
	}
}
