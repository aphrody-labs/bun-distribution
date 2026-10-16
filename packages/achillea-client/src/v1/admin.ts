/**
 * Surface d'exploitation : `/admin/ops`, `/admin/db`, `/bot`, `/health`,
 * `/database`, `/metrics`, `/moderation/sync`, `/proxy` et le statut racine.
 *
 * Trois régimes d'authentification cohabitent et ne sont pas interchangeables :
 * - `/admin/*` : cookie de session + rôle staff en base ;
 * - `/bot`, `/health/*`, `/database/*`, `/stats/*` : jeton porteur de dev ;
 * - `/moderation/sync` : signature HMAC d'un bot tiers.
 *
 * L'administration du ranked (`/admin/lobbies`, `/admin/seasons`,
 * `/admin/ranked`) vit avec son domaine, dans `ranked.ts`.
 */

import { z } from "zod";

import { pageMetaSchema } from "./common";
import {
	AchilleaResource,
	encodePathSegment,
	type AchilleaClientResult,
} from "./http";
import type {
	AdminAuditRow,
	AdminGuildRow,
	AdminHealthResponse,
	AdminInviteResponse,
	AdminMetricsSummary,
	AdminOpsOverview,
	AdminRoleUpdateResult,
	AdminTransactionRow,
	AdminUserRow,
	AdminWalletAdjustResult,
	AdminWalletRow,
	AdminWalletsResponse,
	BotMonitoringResponse,
	DatabaseBackupResult,
	DbColumn,
	DbMutationResult,
	DbQueryResult,
	DbRowsPage,
	DbTableRow,
	HealthCheckResponse,
	MaintenanceResponse,
	ModerationSyncResult,
	UploadedImage,
} from "./pending-contracts";

// ── Hub ops ─────────────────────────────────────────────────────────────────

export const adminOpsOverviewSchema = z.object({
	users: z.object({ total: z.number(), staff: z.number() }),
	wallet: z.object({ wallets: z.number(), totalBalance: z.number(), txToday: z.number() }),
	moderation: z.object({ sanctionsActive: z.number(), licensesActive: z.number() }),
	community: z.object({
		tournamentsOngoing: z.number(),
		clansPending: z.number(),
		orgsPending: z.number(),
		castEventsOpen: z.number(),
	}),
	ranked: z.object({
		activeMatches: z.number(),
		contestedMatches: z.number(),
		finishedToday: z.number(),
		matchesToday: z.number(),
		totalPlayers: z.number(),
	}),
	audit24h: z.number(),
	bot: z.object({
		online: z.boolean(),
		uptime: z.number(),
		maintenance: z.boolean(),
		guilds: z.number(),
	}).optional(),
	generatedAt: z.string().optional(),
}) satisfies z.ZodType<AdminOpsOverview>;

export const adminUserRowSchema = z.object({
	id: z.string(),
	username: z.string().nullable(),
	displayName: z.string().nullable(),
	avatar: z.string().nullable(),
	role: z.number(),
	lastInteract: z.string().nullable(),
}) satisfies z.ZodType<AdminUserRow>;

export const adminUsersPageSchema = z.object({
	data: z.array(adminUserRowSchema),
	meta: pageMetaSchema,
});

export type AdminUsersPage = z.infer<typeof adminUsersPageSchema>;

export const adminRoleUpdateResultSchema = z.object({
	success: z.boolean(),
	id: z.string(),
	role: z.number(),
}) satisfies z.ZodType<AdminRoleUpdateResult>;

export const adminWalletRowSchema = z.object({
	userId: z.string(),
	displayName: z.string(),
	balance: z.number(),
	currency: z.string(),
}) satisfies z.ZodType<AdminWalletRow>;

export const adminTransactionRowSchema = z.object({
	id: z.union([z.string(), z.number()]),
	type: z.string(),
	amount: z.number(),
	reason: z.string().nullable(),
	fromUserId: z.string().nullable(),
	toUserId: z.string().nullable(),
	createdAt: z.string(),
}) satisfies z.ZodType<AdminTransactionRow>;

export const adminWalletsResponseSchema = z.object({
	top: z.array(adminWalletRowSchema),
	recent: z.array(adminTransactionRowSchema),
}) satisfies z.ZodType<AdminWalletsResponse>;

export const adminWalletAdjustResultSchema = z.object({
	success: z.boolean(),
	userId: z.string(),
	balance: z.number(),
}) satisfies z.ZodType<AdminWalletAdjustResult>;

export const adminHealthResponseSchema = z.object({
	bot: z.object({
		online: z.boolean(),
		uptime: z.number(),
		username: z.string().nullable(),
		guilds: z.number(),
		maintenance: z.boolean(),
	}),
	host: z.unknown(),
	pid: z.unknown(),
	latency: z.unknown(),
}) satisfies z.ZodType<AdminHealthResponse>;

export const adminAuditRowSchema = z.object({
	id: z.string(),
	ts: z.string(),
	actorId: z.string().nullable(),
	action: z.string(),
	targetType: z.string(),
	targetId: z.string().nullable(),
	reason: z.string().nullable(),
}) satisfies z.ZodType<AdminAuditRow>;

export const adminMetricsSummarySchema = z.object({
	counters: z.record(z.string(), z.number()),
	rawLines: z.number(),
}) satisfies z.ZodType<AdminMetricsSummary>;

export const adminGuildRowSchema = z.object({
	id: z.string(),
	name: z.string(),
	iconURL: z.string().nullable(),
	memberCount: z.number(),
	ownerId: z.string(),
	createdAt: z.string().nullable(),
}) satisfies z.ZodType<AdminGuildRow>;

export const adminInviteResponseSchema = z.object({
	url: z.string(),
}) satisfies z.ZodType<AdminInviteResponse>;

export const maintenanceResponseSchema = z.object({
	maintenance: z.boolean(),
}) satisfies z.ZodType<MaintenanceResponse>;

// ── Console base de données ─────────────────────────────────────────────────

export const dbTableRowSchema = z.object({
	name: z.string(),
	estimatedRows: z.number(),
	protected: z.boolean(),
}) satisfies z.ZodType<DbTableRow>;

export const dbColumnSchema = z.object({
	name: z.string(),
	dataType: z.string(),
	nullable: z.boolean(),
	default: z.string().nullable(),
	isPrimaryKey: z.boolean(),
}) satisfies z.ZodType<DbColumn>;

export const dbRowsPageSchema = z.object({
	data: z.array(z.record(z.string(), z.unknown())),
	columns: z.array(dbColumnSchema),
	meta: pageMetaSchema,
}) satisfies z.ZodType<DbRowsPage>;

export const dbMutationResultSchema = z.object({
	success: z.boolean(),
	row: z.record(z.string(), z.unknown()).nullable().optional(),
}) satisfies z.ZodType<DbMutationResult>;

export const dbQueryResultSchema = z.object({
	data: z.array(z.record(z.string(), z.unknown())),
	rowCount: z.number(),
	durationMs: z.number(),
}) satisfies z.ZodType<DbQueryResult>;

// ── Bot, santé, sauvegardes, proxy ──────────────────────────────────────────

export const healthCheckResponseSchema = z.object({
	online: z.boolean(),
	uptime: z.number().nullable(),
	lastStartup: z.unknown().optional(),
}) satisfies z.ZodType<HealthCheckResponse>;

export const botMonitoringResponseSchema = z.object({
	botStatus: z.object({
		online: z.boolean(),
		uptime: z.number().nullable(),
		maintenance: z.boolean(),
	}),
	host: z.unknown(),
	pid: z.unknown(),
	latency: z.unknown(),
}) satisfies z.ZodType<BotMonitoringResponse>;

export const databaseBackupResultSchema = z.object({
	message: z.string(),
	data: z.object({ snapshotName: z.string() }).optional(),
}) satisfies z.ZodType<DatabaseBackupResult>;

export const uploadedImageSchema = z.object({
	id: z.string(),
	url: z.string(),
}) satisfies z.ZodType<UploadedImage>;

export const moderationSyncResultSchema = z.object({
	ok: z.boolean(),
	sanctionId: z.string(),
}) satisfies z.ZodType<ModerationSyncResult>;

/** Statut de l'API ranked : `{ ok, ts, activeChallenges }`. */
export const apiHealthSchema = z.object({
	ok: z.boolean(),
	ts: z.number(),
	activeChallenges: z.number(),
});

export type ApiHealth = z.infer<typeof apiHealthSchema>;

/** Couple d'entités Discord + base renvoyé par `/bot/guilds` et `/bot/users`. */
export const discordAndDatabaseSchema = z.object({
	discord: z.unknown(),
	database: z.unknown().nullable(),
});

export type DiscordAndDatabase = z.infer<typeof discordAndDatabaseSchema>;

export type AdminUsersQuery = {
	page?: number;
	/** Taille de page — le contrôleur l'attend sous le nom `pagination`. */
	pagination?: number;
	/** Recherche sur pseudo, nom affiché ou identifiant. */
	q?: string;
}

export type DbRowsQuery = {
	page?: number;
	limit?: number;
	sort?: string;
	order?: "asc" | "desc";
}

/** En-têtes de signature du webhook de modération cross-serveurs. */
export const MODERATION_SIGNATURE_HEADER = "x-achillea-signature" as const;
export const MODERATION_TIMESTAMP_HEADER = "x-achillea-timestamp" as const;

/** 49 routes (13 ops, 7 base de données, 13 bot, 9 santé et métriques, 4 sauvegardes, 3 divers). */
export class AdminResource extends AchilleaResource {
	// ── /admin/ops ────────────────────────────────────────────────────────────

	/** `GET /admin/ops/overview` — instantané multi-domaines du tableau de bord. */
	overview(): Promise<AchilleaClientResult<AdminOpsOverview>> {
		return this.http.get("/admin/ops/overview", adminOpsOverviewSchema);
	}

	/** `GET /admin/ops/users` — comptes en base, paginés et recherchables. */
	users(query: AdminUsersQuery = {}): Promise<AchilleaClientResult<AdminUsersPage>> {
		return this.http.get("/admin/ops/users", adminUsersPageSchema, { query });
	}

	/** `POST /admin/ops/users/:id/role` — change le rôle d'un compte (Admin+). */
	setUserRole(
		id: string,
		role: number
	): Promise<AchilleaClientResult<AdminRoleUpdateResult>> {
		return this.http.post(
			`/admin/ops/users/${encodePathSegment(id)}/role`,
			adminRoleUpdateResultSchema,
			{ role }
		);
	}

	/** `GET /admin/ops/wallets` — plus gros soldes et derniers mouvements. */
	wallets(limit?: number): Promise<AchilleaClientResult<AdminWalletsResponse>> {
		return this.http.get("/admin/ops/wallets", adminWalletsResponseSchema, {
			query: { limit },
		});
	}

	/** `POST /admin/ops/wallets/:userId/adjust` — crédit (> 0) ou débit (< 0) staff. */
	adjustWallet(
		userId: string,
		amount: number,
		reason?: string
	): Promise<AchilleaClientResult<AdminWalletAdjustResult>> {
		return this.http.post(
			`/admin/ops/wallets/${encodePathSegment(userId)}/adjust`,
			adminWalletAdjustResultSchema,
			{ amount, reason }
		);
	}

	/** `GET /admin/ops/health` — santé bot et hôte, via le cookie staff. */
	health(): Promise<AchilleaClientResult<AdminHealthResponse>> {
		return this.http.get("/admin/ops/health", adminHealthResponseSchema);
	}

	/** `POST /admin/ops/maintenance` — bascule le mode maintenance (SuperAdmin). */
	setMaintenance(maintenance: boolean): Promise<AchilleaClientResult<MaintenanceResponse>> {
		return this.http.post("/admin/ops/maintenance", maintenanceResponseSchema, {
			maintenance,
		});
	}

	/** `GET /admin/ops/audit` — dernières entrées du journal d'audit (Admin+). */
	audit(limit?: number): Promise<AchilleaClientResult<{ data: AdminAuditRow[] }>> {
		return this.http.get(
			"/admin/ops/audit",
			z.object({ data: z.array(adminAuditRowSchema) }),
			{ query: { limit } }
		);
	}

	/** `GET /admin/ops/metrics-summary` — compteurs Prometheus agrégés en JSON. */
	metricsSummary(): Promise<AchilleaClientResult<AdminMetricsSummary>> {
		return this.http.get("/admin/ops/metrics-summary", adminMetricsSummarySchema);
	}

	/** `GET /admin/ops/guilds` — serveurs Discord où le bot est présent. */
	guilds(): Promise<AchilleaClientResult<{ data: AdminGuildRow[] }>> {
		return this.http.get("/admin/ops/guilds", z.object({ data: z.array(adminGuildRowSchema) }));
	}

	/** `GET /admin/ops/guilds/:id/invite` — invitation ponctuelle (Admin+). */
	guildInvite(id: string): Promise<AchilleaClientResult<AdminInviteResponse>> {
		return this.http.get(
			`/admin/ops/guilds/${encodePathSegment(id)}/invite`,
			adminInviteResponseSchema
		);
	}

	/** `GET /admin/ops/commands` — commandes slash enregistrées (lecture seule). */
	commands(): Promise<AchilleaClientResult<{ data: unknown[] }>> {
		return this.http.get("/admin/ops/commands", z.object({ data: z.array(z.unknown()) }));
	}

	/** `GET /admin/ops/logs` — dernières lignes de log du process (SuperAdmin). */
	logs(): Promise<AchilleaClientResult<{ data: string[] }>> {
		return this.http.get("/admin/ops/logs", z.object({ data: z.array(z.string()) }));
	}

	// ── /admin/db ─────────────────────────────────────────────────────────────

	/** `GET /admin/db/tables` — tables publiques et volumétrie estimée. */
	dbTables(): Promise<AchilleaClientResult<{ data: DbTableRow[] }>> {
		return this.http.get("/admin/db/tables", z.object({ data: z.array(dbTableRowSchema) }));
	}

	/** `GET /admin/db/tables/:table/columns` — métadonnées de colonnes. */
	dbColumns(table: string): Promise<AchilleaClientResult<{ data: DbColumn[] }>> {
		return this.http.get(
			`/admin/db/tables/${encodePathSegment(table)}/columns`,
			z.object({ data: z.array(dbColumnSchema) })
		);
	}

	/** `GET /admin/db/tables/:table/rows` — lignes paginées et triables. */
	dbRows(table: string, query: DbRowsQuery = {}): Promise<AchilleaClientResult<DbRowsPage>> {
		return this.http.get(`/admin/db/tables/${encodePathSegment(table)}/rows`, dbRowsPageSchema, {
			query,
		});
	}

	/** `POST /admin/db/tables/:table/rows` — insertion (colonnes filtrées côté API). */
	dbInsertRow(
		table: string,
		values: Record<string, unknown>
	): Promise<AchilleaClientResult<DbMutationResult>> {
		return this.http.post(
			`/admin/db/tables/${encodePathSegment(table)}/rows`,
			dbMutationResultSchema,
			{ values }
		);
	}

	/** `PATCH /admin/db/tables/:table/rows` — mise à jour par clé primaire complète. */
	dbUpdateRow(
		table: string,
		pk: Record<string, unknown>,
		values: Record<string, unknown>
	): Promise<AchilleaClientResult<DbMutationResult>> {
		return this.http.patch(
			`/admin/db/tables/${encodePathSegment(table)}/rows`,
			dbMutationResultSchema,
			{ pk, values }
		);
	}

	/** `DELETE /admin/db/tables/:table/rows` — suppression par clé primaire complète. */
	dbDeleteRow(
		table: string,
		pk: Record<string, unknown>
	): Promise<AchilleaClientResult<DbMutationResult>> {
		return this.http.delete(
			`/admin/db/tables/${encodePathSegment(table)}/rows`,
			dbMutationResultSchema,
			{ pk }
		);
	}

	/** `POST /admin/db/query` — console SQL en lecture seule (désactivée en production). */
	dbQuery(sql: string): Promise<AchilleaClientResult<DbQueryResult>> {
		return this.http.post("/admin/db/query", dbQueryResultSchema, { sql });
	}

	// ── /bot (jeton de développement) ─────────────────────────────────────────

	/** `GET /bot/info` — identité du bot et de son propriétaire. */
	botInfo(): Promise<AchilleaClientResult<{ user: unknown; owner: unknown }>> {
		return this.http.get(
			"/bot/info",
			z.object({ user: z.unknown(), owner: z.unknown() })
		);
	}

	/** `GET /bot/commands` — définitions JSON des commandes d'application. */
	botCommands(): Promise<AchilleaClientResult<unknown[]>> {
		return this.http.get("/bot/commands", z.array(z.unknown()));
	}

	/** `GET /bot/guilds` — serveurs, côté Discord et côté base. */
	botGuilds(): Promise<AchilleaClientResult<DiscordAndDatabase[]>> {
		return this.http.get("/bot/guilds", z.array(discordAndDatabaseSchema));
	}

	/** `GET /bot/guilds/:id` — un serveur, côté Discord et côté base. */
	botGuild(id: string): Promise<AchilleaClientResult<DiscordAndDatabase>> {
		return this.http.get(`/bot/guilds/${encodePathSegment(id)}`, discordAndDatabaseSchema);
	}

	/** `DELETE /bot/guilds/:id` — fait quitter le serveur au bot. */
	botLeaveGuild(
		id: string
	): Promise<AchilleaClientResult<{ success: boolean; message: string }>> {
		return this.http.delete(
			`/bot/guilds/${encodePathSegment(id)}`,
			z.object({ success: z.boolean(), message: z.string() })
		);
	}

	/** `GET /bot/guilds/:id/invite` — invitation créée par le bot. */
	botGuildInvite(id: string): Promise<AchilleaClientResult<unknown>> {
		return this.http.get(`/bot/guilds/${encodePathSegment(id)}/invite`, z.unknown());
	}

	/** `GET /bot/users` — membres connus, côté Discord et côté base. */
	botUsers(): Promise<AchilleaClientResult<DiscordAndDatabase[]>> {
		return this.http.get("/bot/users", z.array(discordAndDatabaseSchema));
	}

	/** `GET /bot/users/:id` — un membre, côté Discord et côté base. */
	botUser(id: string): Promise<AchilleaClientResult<DiscordAndDatabase>> {
		return this.http.get(`/bot/users/${encodePathSegment(id)}`, discordAndDatabaseSchema);
	}

	/**
	 * `GET /bot/users/cached` — cache utilisateurs du client Discord.
	 *
	 * Longtemps inatteignable : le contrôleur la déclarait après `/users/:id`,
	 * qui capturait « cached » comme identifiant Discord. Corrigé côté API en
	 * remontant la route littérale avant le joker.
	 */
	botCachedUsers(): Promise<AchilleaClientResult<unknown[]>> {
		return this.http.get("/bot/users/cached", z.array(z.unknown()));
	}

	/** `GET /bot/maintenance` — état du mode maintenance. */
	botMaintenance(): Promise<AchilleaClientResult<MaintenanceResponse>> {
		return this.http.get("/bot/maintenance", maintenanceResponseSchema);
	}

	/** `POST /bot/maintenance` — bascule le mode maintenance. */
	setBotMaintenance(
		maintenance: boolean
	): Promise<AchilleaClientResult<MaintenanceResponse>> {
		return this.http.post("/bot/maintenance", maintenanceResponseSchema, { maintenance });
	}

	/** `GET /bot/devs` — identifiants des développeurs déclarés. */
	botDevs(): Promise<AchilleaClientResult<string[]>> {
		return this.http.get("/bot/devs", z.array(z.string()));
	}

	/** `GET /bot/devs/:id` — `true` si l'identifiant est un développeur. */
	botIsDev(id: string): Promise<AchilleaClientResult<boolean>> {
		return this.http.get(`/bot/devs/${encodePathSegment(id)}`, z.boolean());
	}

	// ── /health et /metrics ───────────────────────────────────────────────────

	/** `GET /health` — statut du serveur ranked (défis actifs compris). */
	apiHealth(): Promise<AchilleaClientResult<ApiHealth>> {
		return this.http.get("/health", apiHealthSchema);
	}

	/** `GET /health/check` — disponibilité du bot (route publique). */
	healthcheck(): Promise<AchilleaClientResult<HealthCheckResponse>> {
		return this.http.get("/health/check", healthCheckResponseSchema);
	}

	/** `GET /health/latency` — latence de la passerelle Discord. */
	healthLatency(): Promise<AchilleaClientResult<unknown>> {
		return this.http.get("/health/latency", z.unknown());
	}

	/** `GET /health/usage` — consommation du process. */
	healthUsage(): Promise<AchilleaClientResult<unknown>> {
		return this.http.get("/health/usage", z.unknown());
	}

	/** `GET /health/host` — consommation de la machine hôte. */
	healthHost(): Promise<AchilleaClientResult<unknown>> {
		return this.http.get("/health/host", z.unknown());
	}

	/** `GET /health/monitoring` — vue agrégée bot + hôte + latence. */
	healthMonitoring(): Promise<AchilleaClientResult<BotMonitoringResponse>> {
		return this.http.get("/health/monitoring", botMonitoringResponseSchema);
	}

	/** `GET /health/logs` — dernières lignes de log du bot. */
	healthLogs(): Promise<AchilleaClientResult<unknown>> {
		return this.http.get("/health/logs", z.unknown());
	}

	/** `GET /metrics` — exposition Prometheus, en texte brut. */
	metrics(): Promise<AchilleaClientResult<string>> {
		return this.http.requestText("/metrics");
	}

	/** `GET /` — message de statut de l'API, en texte brut. */
	status(): Promise<AchilleaClientResult<string>> {
		return this.http.requestText("/");
	}

	// ── /database ─────────────────────────────────────────────────────────────

	/** `POST /database/backup` — déclenche une sauvegarde nommée. */
	createBackup(): Promise<AchilleaClientResult<DatabaseBackupResult>> {
		return this.http.post("/database/backup", databaseBackupResultSchema);
	}

	/** `POST /database/restore` — restaure une sauvegarde existante. */
	restoreBackup(snapshotName: string): Promise<AchilleaClientResult<DatabaseBackupResult>> {
		return this.http.post("/database/restore", databaseBackupResultSchema, { snapshotName });
	}

	/** `GET /database/backups` — sauvegardes disponibles. */
	listBackups(): Promise<AchilleaClientResult<unknown>> {
		return this.http.get("/database/backups", z.unknown());
	}

	/** `GET /database/size` — taille de la base. */
	databaseSize(): Promise<AchilleaClientResult<unknown>> {
		return this.http.get("/database/size", z.unknown());
	}

	// ── /proxy et /moderation/sync ────────────────────────────────────────────

	/**
	 * `POST /proxy/upload` — dépôt d'image, dédupliqué par hash côté API.
	 * Le champ multipart attendu s'appelle `file`.
	 */
	uploadImage(file: Blob, fileName = "upload"): Promise<AchilleaClientResult<UploadedImage>> {
		const form = new FormData();
		form.append("file", file, fileName);
		return this.http.requestJson("/proxy/upload", uploadedImageSchema, {
			method: "POST",
			formData: form,
		});
	}

	/** `GET /proxy/delete/:id` — supprime une image déposée. */
	deleteImage(id: string): Promise<AchilleaClientResult<{ success: boolean }>> {
		return this.http.get(
			`/proxy/delete/${encodePathSegment(id)}`,
			z.object({ success: z.boolean() })
		);
	}

	/**
	 * `POST /moderation/sync` — webhook de modération cross-serveurs.
	 * La signature HMAC et son horodatage sont calculés par l'appelant.
	 */
	moderationSync(
		body: unknown,
		signature: string,
		timestamp: string
	): Promise<AchilleaClientResult<ModerationSyncResult>> {
		return this.http.post("/moderation/sync", moderationSyncResultSchema, body, {
			headers: {
				[MODERATION_SIGNATURE_HEADER]: signature,
				[MODERATION_TIMESTAMP_HEADER]: timestamp,
			},
		});
	}
}
