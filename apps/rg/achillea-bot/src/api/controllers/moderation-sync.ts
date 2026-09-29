/**
 * ModerationSyncController — T-1.5
 *
 * POST /moderation/sync — point d'entrée des webhooks cross-serveurs.
 *
 * Sécurité :
 *   - Vérifie la signature HMAC (x-achillea-signature, x-achillea-timestamp)
 *   - Refuse les replays > 5 min
 *   - Anti-boucle : si evidence[0].from est défini, la sanction reçue n'est
 *     PAS re-propagée (CrossSyncService.pushSanction le détecte déjà).
 */

import { BodyParams, Controller, HeaderParams, Post, Req } from "@tsed/common";
import { Forbidden, UnprocessableEntity } from "@tsed/exceptions";
import type { Request } from "express";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { sql } from "kysely";
import type { Generated, Selectable } from "kysely";

import { CrossSyncService } from "@/services";
import { BaseController } from "@/utils/classes";
import { resolveDependenciesSync } from "@/utils/functions";
import { SanctionIssuerType, SanctionType } from "@/utils/enums";

interface SanctionTable {
	id: Generated<string>;
	user_id: string;
	guild_id: string;
	type: string;
	reason: string | null;
	duration_sec: number | null;
	issued_by: string;
	issued_by_type: string;
	expires_at: Date | null;
	revoked_at: Date | null;
	revoked_by: string | null;
	revoke_reason: string | null;
	evidence: Record<string, unknown>[] | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

interface SanctionDatabase {
	sanction: SanctionTable;
}

const db = createAchilleaSql<SanctionDatabase>();
type SanctionRow = Selectable<SanctionTable>;

// =============================================================================
// DTO / payload shape (permissive — validated inline)
// =============================================================================

interface IncomingSanction {
	id?: string;
	userId?: string;
	type?: string;
	reason?: string | null;
	durationSec?: number | null;
	expiresAt?: string | null;
	issuedBy?: string;
	issuedAt?: string;
	evidence?: Record<string, unknown>[] | null;
}

interface CrossSyncBody {
	version?: string;
	source_guild_id?: string;
	source_bot_id?: string;
	sanction?: IncomingSanction;
	action?: string;
	propagation_policy?: string;
}

// =============================================================================
// Controller
// =============================================================================

@Controller("/moderation/sync")
export class ModerationSyncController extends BaseController {
	private crossSync: CrossSyncService;

	constructor() {
		super();
		[this.crossSync] = resolveDependenciesSync([CrossSyncService]);
	}

	@Post("/")
	async receive(
		@Req() req: Request,
		@HeaderParams("x-achillea-signature") signature: string | undefined,
		@HeaderParams("x-achillea-timestamp") timestamp: string | undefined,
		@BodyParams() body: CrossSyncBody
	): Promise<{ ok: boolean; sanctionId: string }> {
		// -------------------------------------------------------------------------
		// 1. Header presence
		// -------------------------------------------------------------------------
		if (!signature || !timestamp) {
			throw new Forbidden("Missing x-achillea-signature or x-achillea-timestamp headers");
		}

		// -------------------------------------------------------------------------
		// 2. HMAC verification
		// -------------------------------------------------------------------------
		const secret = process.env.ACHILLEA_CROSS_SYNC_RECEIVE_SECRET;
		if (!secret) {
			throw new Forbidden("Cross-sync receive secret not configured");
		}

		const rawBody = JSON.stringify(body);
		const valid = await this.crossSync.verifySignature(timestamp, rawBody, signature, secret);
		if (!valid) {
			throw new Forbidden("Invalid signature or timestamp drift > 5 minutes");
		}

		// -------------------------------------------------------------------------
		// 3. Payload validation
		// -------------------------------------------------------------------------
		const { version, source_guild_id, source_bot_id, sanction: s, action } = body;

		if (version !== "1.0") {
			throw new UnprocessableEntity(`Unsupported version: ${version}`);
		}

		if (!source_guild_id || !source_bot_id || !s || !action) {
			throw new UnprocessableEntity(
				"Missing required fields: source_guild_id, source_bot_id, sanction, action"
			);
		}

		if (!s.userId || !s.type || !s.issuedBy) {
			throw new UnprocessableEntity("Sanction payload missing userId, type, or issuedBy");
		}

		const sanctionType = Object.values(SanctionType).includes(s.type as SanctionType)
			? (s.type as SanctionType)
			: null;

		if (!sanctionType) {
			throw new UnprocessableEntity(`Unknown sanction type: ${s.type}`);
		}

		if (action !== "create" && action !== "revoke") {
			throw new UnprocessableEntity(`Unknown action: ${action}`);
		}

		// -------------------------------------------------------------------------
		// 4. Persist locally
		//    evidence[0].from = source_bot_id to prevent re-propagation
		// -------------------------------------------------------------------------
		if (action === "create") {
			const evidence = [
				{
					from: source_bot_id,
					source_guild: source_guild_id,
					original_id: s.id ?? null,
					...s.evidence?.[0],
				},
			];
			const inserted = await db
				.insertInto("sanction")
				.values({
					user_id: s.userId,
					guild_id: source_guild_id,
					type: sanctionType,
					reason: s.reason ?? null,
					duration_sec: s.durationSec ?? null,
					issued_by: s.issuedBy,
					issued_by_type: SanctionIssuerType.System,
					expires_at: s.expiresAt ? new Date(s.expiresAt) : null,
					revoked_at: null,
					revoked_by: null,
					revoke_reason: null,
					evidence,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			return { ok: true, sanctionId: inserted.id };
		}

		// action === "revoke"
		// Try to find the original sanction by original_id stored in evidence
		const original_id = s.id;
		let resolved: Pick<SanctionRow, "id"> | null = null;

		if (original_id) {
			// Échappe les wildcards LIKE (% _ \) pour éviter de révoquer une mauvaise
			// sanction si l'id distant en contient.
			const escapedId = original_id.replace(/[\\%_]/g, "\\$&");
			resolved = await db
				.selectFrom("sanction")
				.select(["id", "user_id", "guild_id", "type", "reason", "duration_sec", "issued_by", "issued_by_type", "expires_at", "revoked_at", "revoked_by", "revoke_reason", "evidence", "created_at", "updated_at"])
				.where("user_id", "=", s.userId)
				.where("guild_id", "=", source_guild_id)
				.where("revoked_at", "is", null)
				.where(sql<boolean>`evidence::text LIKE ${`%\"original_id\":\"${escapedId}\"%`} ESCAPE '\\'`)
				.executeTakeFirst() ?? null;
		}

		if (resolved) {
			await db
				.updateTable("sanction")
				.set({
					revoked_at: new Date(),
					revoked_by: source_bot_id,
					revoke_reason: `Cross-sync revoke from ${source_bot_id}`,
				})
				.where("id", "=", resolved.id)
				.where("revoked_at", "is", null)
				.executeTakeFirst();
			return { ok: true, sanctionId: resolved.id };
		}

		// Fallback: create a revocation record (unban/unmute) when no mirrored entry
		const revokeType =
			sanctionType === SanctionType.Ban
				? SanctionType.Unban
				: sanctionType === SanctionType.Mute
					? SanctionType.Unmute
					: sanctionType;

		const evidence = [
			{
				from: source_bot_id,
				source_guild: source_guild_id,
				original_id: s.id ?? null,
			},
		];

		const inserted = await db
			.insertInto("sanction")
			.values({
				user_id: s.userId,
				guild_id: source_guild_id,
				type: revokeType,
				reason: `Cross-sync revoke from ${source_bot_id}`,
				duration_sec: null,
				issued_by: source_bot_id,
				issued_by_type: SanctionIssuerType.System,
				expires_at: null,
				revoked_at: null,
				revoked_by: null,
				revoke_reason: null,
				evidence,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		return { ok: true, sanctionId: inserted.id };
	}
}
