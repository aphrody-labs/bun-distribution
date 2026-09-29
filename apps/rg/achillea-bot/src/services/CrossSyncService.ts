/**
 * CrossSyncService — T-1.5
 *
 * Propagation cross-serveurs des sanctions via webhook signé HMAC SHA-256.
 *
 * Config (variables d'env) :
 *   ACHILLEA_CROSS_SYNC_TARGETS   JSON : [{ url, secret, policy }]
 *                                 policy : "ban-only" | "all"
 *   ACHILLEA_CROSS_SYNC_RECEIVE_SECRET  Secret pour vérifier les webhooks entrants
 *
 * Anti-boucle : les sanctions ayant evidence[0].from défini (reçues d'un autre bot)
 * ne sont PAS re-propagées.
 */

import { singleton } from "tsyringe";

import type { Sanction } from "@/entities";
import { SanctionType } from "@/utils/enums";
import { resolveDependency } from "@/utils/functions/dependency";

export type CrossSyncPolicy = "ban-only" | "all";

export interface CrossSyncTarget {
	url: string;
	secret: string;
	policy: CrossSyncPolicy;
}

export interface CrossSyncPayload {
	version: "1.0";
	source_guild_id: string;
	source_bot_id: "achillea-bot";
	sanction: {
		id: string;
		userId: string;
		type: SanctionType;
		reason: string | null;
		durationSec: number | null;
		expiresAt: string | null;
		issuedBy: string;
		issuedAt: string;
		evidence: Record<string, unknown>[] | null;
	};
	action: "create" | "revoke";
	propagation_policy: CrossSyncPolicy;
}

/** Ban-only policy accepts ban and unban only. All other types pass through "all". */
function policyAccepts(policy: CrossSyncPolicy, type: SanctionType): boolean {
	if (policy === "all") return true;
	return type === SanctionType.Ban || type === SanctionType.Unban;
}

/**
 * Computes HMAC-SHA256 of `${timestamp}.${body}` with the given secret.
 * Uses Bun.CryptoHasher (no node:crypto).
 */
async function computeHmac(timestamp: string, body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const data = new TextEncoder().encode(`${timestamp}.${body}`);
	const sig = await crypto.subtle.sign("HMAC", key, data);
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Constant-time hex comparison (prevents timing attacks).
 * Both strings must be the same length; if not, returns false immediately.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Minimal exponential-backoff retry helper.
 * Retries on network errors or HTTP 5xx. Does NOT retry on 4xx.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, delays: number[]): Promise<T> {
	let lastError: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (i < attempts - 1) {
				await new Promise((r) => setTimeout(r, delays[i] ?? 1000));
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

@singleton()
export class CrossSyncService {
	private readonly targets: CrossSyncTarget[];

	constructor() {
		const raw = process.env.ACHILLEA_CROSS_SYNC_TARGETS;
		if (!raw) {
			this.targets = [];
			return;
		}
		try {
			this.targets = JSON.parse(raw) as CrossSyncTarget[];
		} catch {
			console.warn(
				"[CrossSyncService] ACHILLEA_CROSS_SYNC_TARGETS malformed JSON — no targets loaded"
			);
			this.targets = [];
		}
	}

	/**
	 * Logs via Logger if available (resolved lazily via dynamic import to avoid
	 * circular imports with Logger → @/api/controllers → TSed at module load time).
	 * Falls back to console if Logger is not yet registered.
	 */
	private log(msg: string, level: "info" | "warn" | "error" = "info"): void {
		import("@/services/Logger")
			.then(({ Logger }) => resolveDependency(Logger))
			.then((logger) => logger.log(`[CrossSyncService] ${msg}`, level))
			.catch(() => console[level](`[CrossSyncService] ${msg}`));
	}

	/**
	 * Push a sanction to all configured targets whose policy accepts the sanction type.
	 *
	 * Anti-boucle: skips sanctions whose evidence[0].from is defined
	 * (they were received from a remote bot — do not re-propagate).
	 *
	 * Fire-and-forget safe: errors are caught and logged internally.
	 */
	async pushSanction(sanction: Sanction, action: "create" | "revoke"): Promise<void> {
		// Anti-loop guard: if evidence[0].from is set this sanction came from a remote bot
		const fromRemote = sanction.evidence?.[0]?.from != null;
		if (fromRemote) return;

		if (this.targets.length === 0) return;

		const timestamp = String(Date.now());

		for (const target of this.targets) {
			if (!policyAccepts(target.policy, sanction.type)) continue;

			const payload: CrossSyncPayload = {
				version: "1.0",
				source_guild_id: sanction.guildId,
				source_bot_id: "achillea-bot",
				sanction: {
					id: sanction.id,
					userId: sanction.userId,
					type: sanction.type,
					reason: sanction.reason,
					durationSec: sanction.durationSec,
					expiresAt: sanction.expiresAt?.toISOString() ?? null,
					issuedBy: sanction.issuedBy,
					issuedAt: sanction.createdAt.toISOString(),
					evidence: sanction.evidence,
				},
				action,
				propagation_policy: target.policy,
			};

			const body = JSON.stringify(payload);

			try {
				await withRetry(
					async () => {
						const sig = await computeHmac(timestamp, body, target.secret);
						const res = await fetch(target.url, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"x-achillea-signature": sig,
								"x-achillea-timestamp": timestamp,
							},
							body,
						});

						// Retry on 5xx
						if (res.status >= 500) {
							throw new Error(`HTTP ${res.status} from ${target.url}`);
						}

						this.log(
							`pushed sanction ${sanction.id} (${action}) to ${target.url} — HTTP ${res.status}`
						);
					},
					3,
					[1000, 2000, 4000]
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.log(`failed to push sanction ${sanction.id} to ${target.url}: ${msg}`, "warn");
			}
		}
	}

	/**
	 * Verify an incoming HMAC signature.
	 *
	 * @param timestamp  Value from x-achillea-timestamp header (unix ms string)
	 * @param body       Raw request body string
	 * @param signature  Hex string from x-achillea-signature header
	 * @param secret     Shared secret (ACHILLEA_CROSS_SYNC_RECEIVE_SECRET)
	 * @returns          true if signature matches and timestamp is within 5 minutes
	 */
	async verifySignature(
		timestamp: string,
		body: string,
		signature: string,
		secret: string
	): Promise<boolean> {
		// Timestamp drift check: reject if older than 5 minutes
		const ts = Number(timestamp);
		if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

		const expected = await computeHmac(timestamp, body, secret);
		return timingSafeEqual(expected, signature);
	}
}
