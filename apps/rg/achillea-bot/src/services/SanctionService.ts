import { ESCALATION_WINDOW_SEC, evaluateEscalation } from "@rosegriffon/achillea-core";
import type { Job } from "bullmq";
import { Client } from "@aphrody/discordx";
import { singleton } from "tsyringe";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Generated, Selectable } from "kysely";

import { Sanction } from "@/entities";
import { sanctionsQueue } from "../queues/sanctions.queues";
import { CrossSyncService } from "@/services/CrossSyncService";
import { MetricsService } from "@/services/MetricsService";
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

type SanctionRow = Selectable<SanctionTable>;

const sql = createAchilleaSql<SanctionDatabase>();

function toEntity(row: SanctionRow): Sanction {
	const sanction = new Sanction();
	sanction.id = row.id;
	sanction.userId = row.user_id;
	sanction.guildId = row.guild_id;
	sanction.type = row.type as SanctionType;
	sanction.reason = row.reason;
	sanction.durationSec = row.duration_sec;
	sanction.issuedBy = row.issued_by;
	sanction.issuedByType = row.issued_by_type as SanctionIssuerType;
	sanction.expiresAt = row.expires_at;
	sanction.revokedAt = row.revoked_at;
	sanction.revokedBy = row.revoked_by;
	sanction.revokeReason = row.revoke_reason;
	sanction.evidence = row.evidence;
	sanction.createdAt = row.created_at;
	return sanction;
}

export interface IssueOpts {
	userId: string;
	guildId: string;
	type: SanctionType;
	reason?: string | null;
	durationSec?: number | null;
	issuedBy: string;
	issuerType?: SanctionIssuerType;
	evidence?: Record<string, unknown>[] | null;
}

@singleton()
export class SanctionService {
	constructor(
		private client: Client,
		private crossSync: CrossSyncService,
		private metrics: MetricsService
	) {}

	/**
	 * Creates a sanction, persists it, and schedules TTL revocation via BullMQ
	 * if durationSec is provided.
	 */
	async issue(opts: IssueOpts): Promise<Sanction> {
		const expiresAt = opts.durationSec
			? new Date(Date.now() + opts.durationSec * 1000)
			: null;
		const row = await sql
			.insertInto("sanction")
			.values({
				user_id: opts.userId,
				guild_id: opts.guildId,
				type: opts.type,
				reason: opts.reason ?? null,
				duration_sec: opts.durationSec ?? null,
				issued_by: opts.issuedBy,
				issued_by_type: opts.issuerType ?? SanctionIssuerType.Staff,
				expires_at: expiresAt,
				revoked_at: null,
				revoked_by: null,
				revoke_reason: null,
				evidence: opts.evidence ?? null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
		const sanction = toEntity(row);

		if (opts.durationSec && sanction.id) {
			await sanctionsQueue.add(
				"revoke",
				{ sanctionId: sanction.id },
				{
					delay: opts.durationSec * 1000,
					jobId: `revoke_${sanction.id}`,
					removeOnComplete: true,
					removeOnFail: false,
				}
			);
		}

		// Cross-sync: fire-and-forget, never throw
		this.crossSync.pushSanction(sanction, "create").catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[SanctionService] cross-sync issue failed: ${msg}`);
		});

		this.metrics.increment("achillea_sanctions_issued_total", { type: opts.type });

		return sanction;
	}

	/**
	 * Revokes a sanction, sets revokedAt/revokedBy, and applies inverse Discord
	 * effect for mute (untimeout) and ban (unban). Tolerates DiscordAPIError if
	 * the member has already left or the ban was already removed.
	 */
	async revoke(sanctionId: string, revokedBy: string, revokeReason?: string): Promise<Sanction> {
		const row = await sql
			.updateTable("sanction")
			.set({
				revoked_at: new Date(),
				revoked_by: revokedBy,
				...(revokeReason ? { revoke_reason: revokeReason } : {}),
			})
			.where("id", "=", sanctionId)
			.where("revoked_at", "is", null)
			.returningAll()
			.executeTakeFirst();
		if (!row) throw new Error(`Sanction ${sanctionId} not found or already revoked`);
		const sanction = toEntity(row);

		// Apply inverse Discord effect for active mute / ban
		if (sanction.type === SanctionType.Mute || sanction.type === SanctionType.Ban) {
			try {
				const guild = await this.client.guilds.fetch(sanction.guildId);

				if (sanction.type === SanctionType.Mute) {
					const member = await guild.members.fetch(sanction.userId);
					await member.timeout(null, `Sanction ${sanctionId} expirée / révoquée`);
				} else {
					// Ban
					await guild.bans.remove(sanction.userId, `Sanction ${sanctionId} expirée / révoquée`);
				}
			} catch (err: unknown) {
				// Tolerate DiscordAPIError (member left, ban already removed, etc.)
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[SanctionService] revoke Discord effect skipped (${msg})`);
			}
		}

		// Cross-sync: fire-and-forget, never throw
		this.crossSync.pushSanction(sanction, "revoke").catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[SanctionService] cross-sync revoke failed: ${msg}`);
		});

		return sanction;
	}

	/**
	 * Returns active sanctions for a user in a guild:
	 * not revoked AND (no expiry OR expiry in the future).
	 */
	async listActive(userId: string, guildId: string): Promise<Sanction[]> {
		const now = new Date();
		const rows = await sql
			.selectFrom("sanction")
			.selectAll()
			.where("user_id", "=", userId)
			.where("guild_id", "=", guildId)
			.where("revoked_at", "is", null)
			.where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", now)]))
			.orderBy("created_at", "desc")
			.execute();
		return rows.map(toEntity);
	}

	/**
	 * Applies the Discord effect matching the sanction type.
	 * warn / note / unmute / unban are no-ops here (handled elsewhere).
	 */
	async applyDiscordEffect(sanction: Sanction): Promise<void> {
		if (
			sanction.type === SanctionType.Warn ||
			sanction.type === SanctionType.Note ||
			sanction.type === SanctionType.Unmute ||
			sanction.type === SanctionType.Unban
		) {
			return;
		}

		const guild = await this.client.guilds.fetch(sanction.guildId);

		switch (sanction.type) {
			case SanctionType.Mute: {
				const member = await guild.members.fetch(sanction.userId);
				const timeoutMs = sanction.durationSec ? sanction.durationSec * 1000 : 10 * 60 * 1000;
				await member.timeout(timeoutMs, sanction.reason ?? undefined);
				break;
			}

			case SanctionType.Kick: {
				const member = await guild.members.fetch(sanction.userId);
				await member.kick(sanction.reason ?? undefined);
				break;
			}

			case SanctionType.Ban: {
				await guild.bans.create(sanction.userId, {
					reason: sanction.reason ?? undefined,
				});
				break;
			}
		}
	}

	/**
	 * Auto-escalation rule evaluated after issuing a warn:
	 *   3 active warns in 30 days → mute 1h
	 *   5 active warns in 30 days → mute 24h
	 *   8 active warns in 30 days → ban 7 days
	 *
	 * Returns the escalation Sanction created, or null if no threshold reached.
	 */
	async escalate(userId: string, guildId: string, issuedBy: string): Promise<Sanction | null> {
		const since = new Date(Date.now() - ESCALATION_WINDOW_SEC * 1000);
		const now = new Date();
		const result = await sql
			.selectFrom("sanction")
			.select(({ fn }) => fn.countAll<number>().as("count"))
			.where("user_id", "=", userId)
			.where("guild_id", "=", guildId)
			.where("type", "=", SanctionType.Warn)
			.where("revoked_at", "is", null)
			.where("created_at", ">=", since)
			.where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", now)]))
			.executeTakeFirstOrThrow();
		const activeWarns = Number(result.count);

		// Décision d'escalade : règle pure déléguée à @rosegriffon/achillea-core.
		const decision = evaluateEscalation(activeWarns);
		if (!decision) return null;

		const escalation = await this.issue({
			userId,
			guildId,
			type: decision.type,
			reason: `Escalade automatique après ${activeWarns} avertissements actifs`,
			durationSec: decision.durationSec,
			issuedBy,
			issuerType: SanctionIssuerType.Bot,
		});

		return escalation;
	}
}
