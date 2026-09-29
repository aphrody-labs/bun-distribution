import {
	BodyParams,
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
import { Default, Groups, Maximum, Minimum } from "@tsed/schema";
import type { Request, Response } from "express";

import { CookieAuthorize } from "@/api/middlewares";
import { urlsConfig } from "@/configs";
import { paginate } from "@/api/models/interfaces";
import { TournamentsService, UserService } from "@/services";
import { BaseController } from "@/utils/classes";
import { TournamentState } from "@/utils/enums";
import { resolveDependenciesSync } from "@/utils/functions";

import { BlacklistedAuthorize } from "../middlewares/blacklistedAuthorize";

@Controller("/tournaments")
export class TournamentsController extends BaseController {
	private userService: UserService;
	private tournamentsService: TournamentsService;

	constructor() {
		super();

		[this.userService, this.tournamentsService] = resolveDependenciesSync([
			UserService,
			TournamentsService,
		]);
	}

	@Get("/")
	async getTournaments(
		@Res() res: Response,
		@QueryParams("page")
		@Default(1)
		@Minimum(1)
		page: number,

		@QueryParams("pagination")
		@Default(25)
		@Minimum(1)
		@Maximum(50)
		pagination: number,

		@QueryParams("organization")
		organizationId: number | undefined,

		@QueryParams("states")
		@Default(undefined)
		states: TournamentState[]
	): Promise<any> {
		// Public reads are owned by the unified Kysely API. The bot remains only
		// the compatibility transport for old ranked/site URLs.
		const upstreamUrl = new URL("/v1/achillea/tournaments", urlsConfig.unifiedApi);
		upstreamUrl.searchParams.set("page", String(page ?? 1));
		upstreamUrl.searchParams.set("pageSize", String(pagination ?? 25));
		if (organizationId !== undefined)
			upstreamUrl.searchParams.set("organization", String(organizationId));
		if (states?.length) upstreamUrl.searchParams.set("states", states.join(","));
		const upstream = await fetch(upstreamUrl);
		if (upstream.ok) {
			const payload = (await upstream.json()) as { data?: unknown[]; count?: number };
			const total = payload.count ?? payload.data?.length ?? 0;
			res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
			return res.json(paginate(payload.data ?? [], total, pagination ?? 25, page ?? 1));
		}
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	/**
	 * Classement circuit : cumul de points sur tous les tournois élimination
	 * terminés (projection de l'API unifiée). Public, aucune auth
	 * requise — mêmes données que la page "Tournois" liste déjà publiquement.
	 */
	@Get("/circuit/ranking")
	async getCircuitRanking(@Res() res: Response) {
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/circuit/ranking`);
		res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	/**
	 * Hub statistiques circuit — vue d'ensemble, records all-time, joueurs/clans
	 * enrichis (buts, séries), historique complet des éditions. Public.
	 */
	@Get("/circuit/stats")
	async getStatsHub(@Res() res: Response) {
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/circuit/stats`);
		res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	/**
	 * Profil circuit d'un joueur (cumul all-time + historique tournoi par tournoi) —
	 * page profil public `/users/:id`. Public, aucune auth requise.
	 */
	@Get("/circuit/players/:userId")
	async getPlayerCircuitProfile(@PathParams("userId") userId: string, @Res() res: Response) {
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/circuit/players/${encodeURIComponent(userId)}`);
		res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	/**
	 * Top 10 + stats matchs d'un tournoi (page publique). Fonctionne aussi en cours
	 * de tournoi (stats sur les matchs déjà joués, top10 vide tant que non résolvable).
	 */
	@Get("/:id/summary")
	async getTournamentSummary(@PathParams("id") id: number, @Res() res: Response) {
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/${id}/summary`);
		res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	@Get("/:id")
	async getTournament(
		@PathParams("id") id: number,
		@Res() res: Response
	) {
		const headers: Record<string, string> = { accept: "application/json" };
		const requestHeaders = (res.req?.headers ?? {}) as Record<
			string,
			string | string[] | undefined
		>;
		for (const name of ["cookie", "authorization"] as const) {
			const value = requestHeaders[name];
			if (typeof value === "string") headers[name] = value;
			else if (Array.isArray(value) && value[0]) headers[name] = value[0];
		}
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/${id}`, {
			headers,
		});
		if (upstream.ok) {
			res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
			return res.status(upstream.status).json(await upstream.json());
		}
		return res.status(upstream.status).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	@Post("/create/achillea")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async create(@Req() req: Request, @Res() res: Response) {
		return this.forwardMutation("/tournaments/create/achillea", req, res, req.body ?? {});
	}

	/**
	 * Mise à jour complète d'un tournoi (champs + images logo/affiche).
	 * Auth : TO / org manager / SuperAdmin.
	 * Path dédié (évite collision avec PUT /start/:id).
	 */
	@Put("/:id/edit")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async update(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/${id}/edit`, req, res, req.body ?? {}, "PUT");
	}

	@Post("/open-registrations/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async openRegistrations(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/open-registrations/${id}`, req, res);
	}

	@Post("/participate/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async participate(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/participate/${id}`, req, res);
	}

	@Post("/unregister/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async unregister(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/unregister/${id}`, req, res);
	}

	private async forwardMutation(
		path: string,
		req: Request,
		res: Response,
		body: unknown = {},
		method: "POST" | "PUT" = "POST"
	) {
		const headers: Record<string, string> = {
			accept: "application/json",
			"content-type": "application/json",
		};
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, {
			method,
			headers,
			body: JSON.stringify(body),
		});
		const text = await upstream.text();
		res
			.status(upstream.status)
			.type(upstream.headers.get("content-type")?.includes("json") ? "json" : "text");
		return res.send(text);
	}

	/**
	 * Bascule « qui saisit les scores » (staff seul / joueurs).
	 * Endpoint dédié : l'organisateur la change en cours de tournoi, sans repasser
	 * par la mise à jour complète du tournoi.
	 */
	@Post("/:id/score-policy")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async setScorePolicy(
		@PathParams("id") id: number,
		@BodyParams() body: { policy: string },
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/score-policy`, req, res, body);
	}

	@Post("/report-score")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async reportGameScore(@Req() req: Request, @Res() res: Response) {
		return this.forwardMutation("/tournaments/report-score", req, res, req.body ?? {});
	}

	@Post("/validate-score")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async validateScore(@Req() req: Request, @Res() res: Response) {
		return this.forwardMutation("/tournaments/validate-score", req, res, req.body ?? {});
	}

	@Post("/unvalidate-score")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async unvalidateScore(@Req() req: Request, @Res() res: Response) {
		return this.forwardMutation("/tournaments/unvalidate-score", req, res, req.body ?? {});
	}

	@Post("/remove-participant/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async removeParticipant(
		@BodyParams() body: { userId: string; reason?: string },
		@PathParams("id") id: number,
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/remove-participant/${id}`, req, res, body);
	}

	/**
	 * Disqualification d'un participant (motif obligatoire).
	 * Tournoi en cours : ses matchs non terminés passent en forfait et le bracket avance.
	 */
	@Post("/:id/disqualify")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async disqualifyParticipant(
		@PathParams("id") id: number,
		@BodyParams() body: { userId: string; reason: string },
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/disqualify`, req, res, body);
	}

	/** Annule une disqualification (avant le démarrage du tournoi uniquement). */
	@Post("/:id/reinstate")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async reinstateParticipant(
		@PathParams("id") id: number,
		@BodyParams() body: { userId: string },
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/reinstate`, req, res, body);
	}

	/** Promotion manuelle d'un joueur depuis la liste d'attente. */
	@Post("/:id/promote-participant")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async promoteParticipant(
		@PathParams("id") id: number,
		@BodyParams() body: { userId: string },
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/promote-participant`, req, res, body);
	}

	/**
	 * Clôture manuelle d'un tournoi en cours. `force` passe outre les matchs non
	 * terminés (le forçage est journalisé).
	 */
	@Post("/:id/close")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async closeTournament(
		@PathParams("id") id: number,
		@BodyParams() body: { force?: boolean },
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/close`, req, res, body);
	}

	/** Annulation d'un tournoi — l'état passe à `Canceled`, rien n'est supprimé. */
	@Post("/:id/cancel")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async cancelTournament(
		@PathParams("id") id: number,
		@BodyParams() body: { reason: string },
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/cancel`, req, res, body);
	}

	/** Restauration d'un tournoi annulé dans son état précédent. */
	@Post("/:id/restore")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async restoreTournament(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/${id}/restore`, req, res);
	}

	/**
	 * Journal du tournoi (inscriptions, retraits, DQ, scores, changements d'état).
	 * Public ; les motifs (DQ, annulation) ne sont renvoyés qu'aux organisateurs.
	 */
	@Get("/:id/events")
	async getTournamentEvents(@PathParams("id") id: number, @Res() res: Response) {
		const headers: Record<string, string> = { accept: "application/json" };
		const requestHeaders = (res.req?.headers ?? {}) as Record<
			string,
			string | string[] | undefined
		>;
		for (const name of ["cookie", "authorization"] as const) {
			const value = requestHeaders[name];
			if (typeof value === "string") headers[name] = value;
			else if (Array.isArray(value) && value[0]) headers[name] = value[0];
		}
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/${id}/events`, {
			headers,
		});
		res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=30");
		return res.status(upstream.status).json(await upstream.json());
	}

	@Post("/set-participant-seeding/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async setParticipantSeeding(
		@PathParams("id") id: number,
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(
			`/tournaments/set-participant-seeding/${id}`,
			req,
			res,
			req.body ?? {}
		);
	}

	/**
	 * Verse manuellement le bonus AP podium (1er / 2e / demis) d'un tournoi terminé.
	 * Idempotent. Formats élimination uniquement.
	 */
	@Post("/:id/apply-placement-prizes")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async applyPlacementPrizes(
		@PathParams("id") id: number,
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/${id}/apply-placement-prizes`, req, res, {}, "POST");
	}

	/** Seed 1..N selon le classement ranked solo (ELO décroissant). Écrase le seeding actuel. */
	@Post("/seed-by-ranked/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async seedByRanked(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/seed-by-ranked/${id}`, req, res);
	}

	/** Mélange aléatoire des seeds 1..N. */
	@Post("/seed-random/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async seedRandom(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/seed-random/${id}`, req, res);
	}

	/** Retire toutes les seeds. */
	@Post("/clear-seeds/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async clearSeeds(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/clear-seeds/${id}`, req, res);
	}

	@Post("/generate-bracket/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async generateBracket(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/generate-bracket/${id}`, req, res);
	}

	@Post("/add-managers/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async addManagers(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/add-managers/${id}`, req, res, req.body ?? {});
	}

	@Post("/remove-manager/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async removeManager(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/remove-manager/${id}`, req, res, req.body ?? {});
	}

	@Put("/start/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async startTournament(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardMutation(`/tournaments/start/${id}`, req, res, {}, "PUT");
	}

	@Put("/next-phase/:id")
	@UseBefore(CookieAuthorize, BlacklistedAuthorize)
	async nextPhase(
		@PathParams("id") id: number,
		@Req() req: Request,
		@Res() res: Response
	) {
		return this.forwardMutation(`/tournaments/next-phase/${id}`, req, res, {}, "PUT");
	}

	@Get("/lobbies/:id")
	async getLobbies(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardRead(`/tournaments/lobbies/${id}`, req, res);
	}

	@Get("/lobby/:id")
	@Groups("details")
	async getLobby(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) {
		return this.forwardRead(`/tournaments/lobby/${id}`, req, res);
	}

	private async forwardRead(path: string, req: Request, res: Response) {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, { headers });
		const text = await upstream.text();
		res
			.status(upstream.status)
			.type(upstream.headers.get("content-type")?.includes("json") ? "json" : "text");
		return res.send(text);
	}
}
