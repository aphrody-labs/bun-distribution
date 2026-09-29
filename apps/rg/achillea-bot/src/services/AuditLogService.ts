import { EmbedBuilder } from "discord.js";
import type { Generated, Kysely } from "kysely";
import { delay, inject } from "tsyringe";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { Service } from "@/decorators";

import { Logger } from "./Logger";

interface AuditDatabase {
	audit_log: {
		id: Generated<string>;
		actor_id: string | null;
		action: string;
		target_type: string;
		target_id: string | null;
		payload: Record<string, unknown> | null;
		reason: string | null;
		ip: string | null;
		ts: Date;
		prev_signature: string | null;
		signature: string;
	};
	guild: { id: string; audit_log_channel_id: string | null };
}

type AuditRecord = Omit<AuditDatabase["audit_log"], "id" | "ts"> & {
	id: string;
	ts: Date;
};

const sql = createAchilleaSql<AuditDatabase>() as Kysely<AuditDatabase>;

export interface AuditLogParams {
	actor_id?: string | null;
	action: string;
	target_type: string;
	target_id?: string | null;
	payload?: Record<string, unknown> | null;
	reason?: string | null;
	ip?: string | null;
	guild_id?: string | null;
}

export interface AuditVerifyResult {
	valid: boolean;
	broken_at: string | null;
}

export type AuditLogSummary = Pick<
	AuditRecord,
	"id" | "ts" | "actor_id" | "action" | "target_type" | "target_id" | "reason"
>;

@Service()
export class AuditLogService {
	constructor(
		@inject(delay(() => Logger)) private logger: any
	) {}

	/**
	 * Compute SHA256 signature for a log entry.
	 * Chain: sha256(prevSignature + JSON.stringify({actor_id,action,target_type,target_id,payload,ts}))
	 */
	private computeSignature(
		prevSignature: string | null,
		entry: {
			actor_id: string | null;
			action: string;
			target_type: string;
			target_id: string | null;
			payload: Record<string, unknown> | null;
			ts: Date;
		}
	): string {
		const hasher = new Bun.CryptoHasher("sha256");
		const content =
			(prevSignature ?? "") +
			JSON.stringify({
				actor_id: entry.actor_id,
				action: entry.action,
				target_type: entry.target_type,
				target_id: entry.target_id,
				payload: entry.payload,
				ts: entry.ts.toISOString(),
			});
		hasher.update(content);
		return hasher.digest("hex");
	}

	/**
	 * Insert a new audit log entry with chained SHA256 signature.
	 */
	async log(params: AuditLogParams): Promise<AuditRecord> {
		const ts = new Date();
		const actor_id = params.actor_id ?? null;
		const target_id = params.target_id ?? null;
		const payload = params.payload ?? null;

		const record = await sql.transaction().execute(async (trx) => {
			// Read and append in one transaction so concurrent writers cannot
			// accidentally compute a chain head from a stale connection.
			const last = await trx
				.selectFrom("audit_log")
				.select(["signature"])
				.orderBy("ts", "desc")
				.limit(1)
				.forUpdate()
				.executeTakeFirst();
			const signature = this.computeSignature(last?.signature ?? null, {
				actor_id,
				action: params.action,
				target_type: params.target_type,
				target_id,
				payload,
				ts,
			});
			return trx
				.insertInto("audit_log")
				.values({
					actor_id,
					action: params.action,
					target_type: params.target_type,
					target_id,
					payload,
					reason: params.reason ?? null,
					ip: params.ip ?? null,
					ts,
					prev_signature: last?.signature ?? null,
					signature,
				})
				.returningAll()
				.executeTakeFirstOrThrow();
		});

		// Mirror to Discord channel if configured
		if (params.guild_id) {
			await this.mirrorToDiscord(record, params.guild_id);
		}

		return record;
	}

	/**
	 * Verify the entire chain by recomputing each signature.
	 * Returns { valid: true } if chain is intact, or { valid: false, broken_at: id } at first break.
	 */
	async verify(): Promise<AuditVerifyResult> {
		const entries = await sql.selectFrom("audit_log").selectAll().orderBy("ts", "asc").execute();

		let prev: string | null = null;

		for (const entry of entries) {
			const expected = this.computeSignature(prev, {
				actor_id: entry.actor_id,
				action: entry.action,
				target_type: entry.target_type,
				target_id: entry.target_id,
				payload: entry.payload,
				ts: entry.ts,
			});

			if (expected !== entry.signature) {
				return { valid: false, broken_at: entry.id };
			}

			prev = entry.signature;
		}

		return { valid: true, broken_at: null };
	}

	/** Lit les dernières entrées pour les interfaces d'administration. */
	async listRecent(limit = 50): Promise<AuditLogSummary[]> {
		const boundedLimit = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
		return sql
			.selectFrom("audit_log")
			.select(["id", "ts", "actor_id", "action", "target_type", "target_id", "reason"])
			.orderBy("ts", "desc")
			.limit(boundedLimit)
			.execute();
	}

	/**
	 * Post a summary embed to a guild's audit log channel.
	 */
	private async mirrorToDiscord(record: AuditRecord, guildId: string): Promise<void> {
		try {
			const guild = await sql
				.selectFrom("guild")
				.select(["audit_log_channel_id"])
				.where("id", "=", guildId)
				.executeTakeFirst();
			if (!guild?.audit_log_channel_id) return;

			const embed = new EmbedBuilder()
				.setTitle("Audit Log")
				.setColor(0x5865f2)
				.addFields(
					{ name: "Action", value: record.action, inline: true },
					{
						name: "Target",
						value: `${record.target_type}${record.target_id ? ` (${record.target_id})` : ""}`,
						inline: true,
					},
					{ name: "Actor", value: record.actor_id ? `<@${record.actor_id}>` : "System", inline: true }
				)
				.setTimestamp(record.ts)
				.setFooter({ text: `sig: ${record.signature.slice(0, 12)}…` });

			if (record.reason) embed.addFields({ name: "Reason", value: record.reason });

			await this.logger.discordChannel(guild.audit_log_channel_id, { embeds: [embed] }, "info");
		} catch {
			// Mirror is best-effort — never block the main log
		}
	}
}
