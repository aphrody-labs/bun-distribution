import {
	BodyParams,
	Context,
	Controller,
	Get,
	PathParams,
	Post,
	QueryParams,
	Req,
	Res,
	UseBefore,
} from "@tsed/common";
import { BadRequest, Forbidden, Unauthorized } from "@tsed/exceptions";
import type { Request, Response } from "express";
import { Client, MetadataStorage } from "@aphrody/discordx";

import { CookieAuthorize } from "@/api/middlewares";
import { urlsConfig } from "@/configs";
import type { UserDTO } from "@/services";
import { AuditLogService, Logger, MetricsService, Stats } from "@/services";
import { BaseController } from "@/utils/classes";
import { UserRole } from "@/utils/enums";
import { isInMaintenance, resolveDependenciesSync, setMaintenance } from "@/utils/functions";

/**
 * Hub ops pour le dashboard admin web (CookieAuthorize + rôle staff).
 * Agrège users / wallet / health / audit / maintenance — domaines absents des
 * onglets ranked/clans existants.
 */
@Controller("/admin/ops")
@UseBefore(CookieAuthorize)
export class AdminOpsController extends BaseController {
	private auditLog: AuditLogService;
	private stats: Stats;
	private client: Client;
	private metrics: MetricsService;
	private logger: Logger;

	constructor() {
		super();
		[this.auditLog, this.stats, this.metrics, this.logger] =
			resolveDependenciesSync([AuditLogService, Stats, MetricsService, Logger]);
		this.client = (globalThis as typeof globalThis & { __roseGriffonDiscordClient?: Client }).__roseGriffonDiscordClient ?? resolveDependenciesSync([Client])[0];
	}

	private requireStaff(ctx: Context, minRole = UserRole.Moderator): UserDTO {
		const user = ctx.get("user") as UserDTO | undefined;
		if (!user) throw new Unauthorized("Non authentifié");
		if ((user.role ?? 0) < minRole) throw new Forbidden("Réservé au staff");
		return user;
	}

	/** Snapshot multi-domaines pour la Vue d'ensemble. */
	@Get("/overview")
	async overview(@Context() ctx: Context, @Req() req: Request, @Res() res: Response) {
		this.requireStaff(ctx);
		return this.forwardAdmin("/ops/overview", req, res);
	}

	/** Liste utilisateurs DB (pagination + recherche). */
	@Get("/users")
	async listUsers(
		@Context() ctx: Context,
		@Res() res: Response,
		@Req() req: Request,
		@QueryParams("page") page = 1,
		@QueryParams("pagination") pagination = 25,
		@QueryParams("q") q?: string
	) {
		this.requireStaff(ctx);
		const query = new URLSearchParams({ page: String(page), pagination: String(pagination) });
		if (q?.trim()) query.set("q", q.trim());
		return this.forwardAdmin(`/ops/users?${query}`, req, res);
	}

	/** Patch rôle utilisateur (Admin+). */
	@Post("/users/:id/role")
	async setUserRole(
		@PathParams("id") id: string,
		@BodyParams() body: { role: number },
		@Context() ctx: Context,
		@Req() req: Request,
		@Res() res: Response
	) {
		this.requireStaff(ctx, UserRole.Administrator);
		return this.forwardAdmin(`/users/${encodeURIComponent(id)}/role`, req, res, body);
	}

	/** Top wallets + derniers mouvements. */
	@Get("/wallets")
	async wallets(@Context() ctx: Context, @Res() res: Response, @Req() req: Request, @QueryParams("limit") limit = 30) {
		this.requireStaff(ctx, UserRole.Moderator);
		return this.forwardAdmin(`/ops/wallets?limit=${encodeURIComponent(String(limit))}`, req, res);
	}

	/** Crédit / débit admin (amount > 0 crédit, < 0 débit). */
	@Post("/wallets/:userId/adjust")
	async adjustWallet(
		@PathParams("userId") userId: string,
		@BodyParams() body: { amount: number; reason?: string },
		@Context() ctx: Context,
		@Req() req: Request,
		@Res() res: Response
	) {
		this.requireStaff(ctx, UserRole.Administrator);
		return this.forwardAdmin(`/wallets/${encodeURIComponent(userId)}/adjust`, req, res, body);
	}

	private async forwardAdmin(path: string, req: Request, res: Response, body?: unknown) {
		const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/admin${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const text = await upstream.text();
		res.status(upstream.status).type("json");
		return res.send(text);
	}

	/** Santé bot / host (cookie staff, pas Bearer dev). */
	@Get("/health")
	async health(@Context() ctx: Context, @Res() res: Response) {
		this.requireStaff(ctx);
		const maintenance = await isInMaintenance();
		return res.json({
			bot: {
				online: this.client.user?.presence?.status !== "offline",
				uptime: this.client.uptime ?? 0,
				username: this.client.user?.username ?? null,
				guilds: this.client.guilds?.cache?.size ?? 0,
				maintenance,
			},
			host: await this.stats.getHostUsage().catch(() => null),
			pid: await this.stats.getPidUsage().catch(() => null),
			latency: this.stats.getLatency?.() ?? null,
		});
	}

	@Post("/maintenance")
	async setMaint(
		@BodyParams() body: { maintenance: boolean },
		@Context() ctx: Context,
		@Res() res: Response
	) {
		this.requireStaff(ctx, UserRole.SuperAdministrator);
		const next = !!body?.maintenance;
		await setMaintenance(next);
		return res.json({ maintenance: next });
	}

	/** Dernières entrées audit. */
	@Get("/audit")
	async audit(@Context() ctx: Context, @Res() res: Response, @QueryParams("limit") limit = 50) {
		this.requireStaff(ctx, UserRole.Administrator);
		const rows = await this.auditLog.listRecent(Number(limit));
		return res.json({
			data: rows.map((r) => ({
				id: r.id,
				ts: r.ts,
				actorId: r.actor_id,
				action: r.action,
				targetType: r.target_type,
				targetId: r.target_id,
				reason: r.reason,
			})),
		});
	}

	/** Métriques Prometheus en JSON simplifié (compteurs). */
	@Get("/metrics-summary")
	async metricsSummary(@Context() ctx: Context, @Res() res: Response) {
		this.requireStaff(ctx);
		const text = await this.metrics.render();
		// Parse basique des compteurs name value
		const counters: Record<string, number> = {};
		for (const line of text.split("\n")) {
			if (!line || line.startsWith("#")) continue;
			const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([0-9.eE+-]+)/);
			if (m) counters[m[1]] = (counters[m[1]] ?? 0) + Number(m[2]);
		}
		return res.json({ counters, rawLines: text.split("\n").length });
	}

	/**
	 * Serveurs Discord où le bot est présent (cache live du client, pas le
	 * scanner /guilds — dont le script d'alimentation a disparu du dépôt).
	 */
	@Get("/guilds")
	async guilds(@Context() ctx: Context, @Res() res: Response) {
		this.requireStaff(ctx);
		const data = [...this.client.guilds.cache.values()].map((g) => ({
			id: g.id,
			name: g.name,
			iconURL: g.iconURL(),
			memberCount: g.memberCount,
			ownerId: g.ownerId,
			createdAt: g.joinedAt,
		}));
		data.sort((a, b) => b.memberCount - a.memberCount);
		return res.json({ data });
	}

	/** Génère une invitation ponctuelle pour un serveur où le bot est présent. */
	@Get("/guilds/:id/invite")
	async guildInvite(@PathParams("id") id: string, @Context() ctx: Context, @Res() res: Response) {
		this.requireStaff(ctx, UserRole.Administrator);
		const guild = await this.client.guilds.fetch(id).catch(() => null);
		if (!guild) throw new BadRequest("Serveur introuvable");

		const { ChannelType, PermissionsBitField } = await import("discord.js");
		const channels = await guild.channels.fetch();
		for (const channel of channels.values()) {
			const canInvite =
				channel &&
				(guild.members.me
					?.permissionsIn(channel)
					.has(PermissionsBitField.Flags.CreateInstantInvite) ??
					false) &&
				(channel.type === ChannelType.GuildText ||
					channel.type === ChannelType.GuildVoice ||
					channel.type === ChannelType.GuildAnnouncement);
			if (canInvite) {
				const invite = await (channel as any).createInvite({ maxAge: 3600, maxUses: 1 });
				return res.json({ url: invite.url });
			}
		}
		throw new BadRequest("Aucun salon disponible pour créer une invitation");
	}

	/** Liste des slash-commands enregistrées (lecture seule). */
	@Get("/commands")
	async commands(@Context() ctx: Context, @Res() res: Response) {
		this.requireStaff(ctx);
		const commands = MetadataStorage.instance.applicationCommands.map((c) => c.toJSON());
		return res.json({ data: commands });
	}

	/** Dernières lignes de logs process bot (tail borné, cf. Logger). */
	@Get("/logs")
	async logs(@Context() ctx: Context, @Res() res: Response) {
		this.requireStaff(ctx, UserRole.SuperAdministrator);
		return res.json({ data: this.logger.getLastLogs() });
	}
}
