/**
 * URSAF — Union de Recouvrement des Saiyens et Autres Fraudeurs.
 *
 * Transforme les signalements anti-triche (`economy_flags`) en avis
 * d'imposition, puis — selon le mode — les notifie ou les recouvre.
 *
 * Trois modes (`economy.ursaf.mode`) :
 *  - `off`     : rien ne se passe (défaut) ;
 *  - `notice`  : les avis sont calculés, enregistrés et publiés dans le salon
 *                économie, mais AUCUN zéni n'est prélevé ;
 *  - `collect` : les avis sont prélevés sur le solde. Les zénis recouvrés sont
 *                détruits, pas redistribués : c'est aussi le frein à l'inflation.
 *
 * Garde-fous : un signalement ne sert qu'à un seul avis ; les signalements
 * classés « faux positif » ou résolus ne sont jamais imposés ; un avis se
 * contrôle et s'annule depuis l'admin, avec remboursement s'il a été prélevé.
 */
import { container, singleton, inject } from "tsyringe";
import { Client, EmbedBuilder } from "discord.js";
import { DatabaseService } from "~/db/index";
import { SettingsService } from "~/services/SettingsService";
import { LogService } from "~/services/LogService";
import { assess, noticeReference, type FlagInput, type FlagSeverity } from "~/lib/ursaf-rules";
import { formatZeni } from "~/lib/zeni";
import { logger } from "~/lib/logger";

export type UrsafMode = "off" | "notice" | "collect";

export type UrsafNotice = {
	id: number;
	reference: string;
	userId: string;
	flagIds: number[];
	taxable: number;
	rate: number;
	amount: number;
	collected: number;
	severity: FlagSeverity;
	status: "pending" | "notified" | "collected" | "cancelled";
	createdAt: number;
	note: string | null;
};

type NoticeRow = {
	id: number;
	user_id: string;
	flag_ids: string;
	taxable: number;
	rate: number;
	amount: number;
	collected: number;
	severity: FlagSeverity;
	status: UrsafNotice["status"];
	created_at: number;
	note: string | null;
};

const toNotice = (r: NoticeRow): UrsafNotice => ({
	id: r.id,
	reference: noticeReference(r.id, new Date(r.created_at)),
	userId: r.user_id,
	flagIds: JSON.parse(r.flag_ids) as number[],
	taxable: r.taxable,
	rate: r.rate,
	amount: r.amount,
	collected: r.collected,
	severity: r.severity,
	status: r.status,
	createdAt: r.created_at,
	note: r.note,
});

@singleton()
export class UrsafService {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(SettingsService) private settings: SettingsService
	) {
		this.ensureSchema();
	}

	private get sqlite() {
		return this.dbs.sqlite;
	}

	ensureSchema() {
		try {
			this.sqlite.exec(`
				CREATE TABLE IF NOT EXISTS ursaf_notices (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					user_id TEXT NOT NULL,
					flag_ids TEXT NOT NULL,
					taxable INTEGER NOT NULL,
					rate REAL NOT NULL,
					amount INTEGER NOT NULL,
					collected INTEGER NOT NULL DEFAULT 0,
					severity TEXT NOT NULL,
					status TEXT NOT NULL DEFAULT 'pending',
					created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch() * 1000 AS INTEGER)),
					updated_at INTEGER,
					updated_by TEXT,
					note TEXT
				);
				CREATE INDEX IF NOT EXISTS idx_ursaf_user ON ursaf_notices(user_id);
				CREATE INDEX IF NOT EXISTS idx_ursaf_status ON ursaf_notices(status);
			`);
		} catch (e) {
			logger.warn({ err: e }, "[ursaf] ensureSchema failed");
		}
	}

	async mode(): Promise<UrsafMode> {
		const m = (await this.settings.getString("economy.ursaf.mode", "off")).toLowerCase();
		return m === "notice" || m === "collect" ? m : "off";
	}

	private async rates() {
		return {
			medium: await this.settings.getFloat("economy.ursaf.rate_medium", 0.25),
			high: await this.settings.getFloat("economy.ursaf.rate_high", 0.5),
			critical: await this.settings.getFloat("economy.ursaf.rate_critical", 0.9),
		};
	}

	/** Signalements ouverts, pas encore rattachés à un avis non annulé. */
	private untaxedFlags(): Map<string, FlagInput[]> {
		const taken = new Set<number>();
		const notices = this.sqlite
			.query(`SELECT flag_ids FROM ursaf_notices WHERE status <> 'cancelled'`)
			.all() as Array<{ flag_ids: string }>;
		for (const n of notices) for (const id of JSON.parse(n.flag_ids) as number[]) taken.add(id);

		const rows = this.sqlite
			.query(
				`SELECT id, user_id, code, severity, meta FROM economy_flags
				 WHERE status IN ('open', 'reviewing') ORDER BY created_at`
			)
			.all() as Array<{ id: number; user_id: string; code: string; severity: FlagSeverity; meta: string | null }>;

		const byUser = new Map<string, FlagInput[]>();
		for (const r of rows) {
			if (taken.has(r.id)) continue;
			let meta: Record<string, unknown> = {};
			try {
				meta = r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : {};
			} catch {
				meta = {};
			}
			const list = byUser.get(r.user_id) ?? [];
			list.push({ id: r.id, code: r.code, severity: r.severity, meta });
			byUser.set(r.user_id, list);
		}
		return byUser;
	}

	/**
	 * Calcule les avis. `dryRun` = rien n'est écrit : c'est ce que l'admin
	 * consulte avant d'activer le recouvrement.
	 */
	async assessAll(opts: { dryRun: boolean }) {
		const rates = await this.rates();
		const out: Array<Omit<UrsafNotice, "id" | "reference" | "createdAt" | "status" | "collected" | "note">> = [];
		for (const [userId, flags] of this.untaxedFlags()) {
			const user = this.sqlite.query(`SELECT zeni FROM users WHERE id = ?`).get(userId) as {
				zeni: number;
			} | null;
			const previous = this.sqlite
				.query(`SELECT COUNT(*) AS n FROM ursaf_notices WHERE user_id = ? AND status = 'collected'`)
				.get(userId) as { n: number };
			const a = assess({
				flags,
				balance: Number(user?.zeni ?? 0),
				previousNotices: Number(previous?.n ?? 0),
				rates,
			});
			if (!a) continue;
			out.push({ userId, ...a });
			if (!opts.dryRun) {
				this.sqlite
					.query(
						`INSERT INTO ursaf_notices (user_id, flag_ids, taxable, rate, amount, severity, status)
						 VALUES (?, ?, ?, ?, ?, ?, 'pending')`
					)
					.run(userId, JSON.stringify(a.flagIds), a.taxable, a.rate, a.amount, a.severity);
			}
		}
		return out;
	}

	list(opts: { status?: string; userId?: string; limit?: number } = {}): UrsafNotice[] {
		const where: string[] = [];
		const params: Array<string | number> = [];
		if (opts.status && opts.status !== "all") {
			where.push("status = ?");
			params.push(opts.status);
		}
		if (opts.userId) {
			where.push("user_id = ?");
			params.push(opts.userId);
		}
		params.push(Math.min(500, opts.limit ?? 100));
		const rows = this.sqlite
			.query(
				`SELECT * FROM ursaf_notices ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
				 ORDER BY created_at DESC LIMIT ?`
			)
			.all(...params) as NoticeRow[];
		return rows.map(toNotice);
	}

	/** Cycle quotidien : calcule, puis notifie ou recouvre selon le mode. */
	async run(): Promise<{ mode: UrsafMode; created: number; collected: number }> {
		const mode = await this.mode();
		if (mode === "off") return { mode, created: 0, collected: 0 };
		const created = (await this.assessAll({ dryRun: false })).length;
		let collected = 0;
		for (const n of this.list({ status: "pending", limit: 500 })) {
			if (mode === "collect") {
				if (await this.collect(n)) collected++;
			} else {
				this.setStatus(n.id, "notified", null, null);
				await this.publish(n, "notified");
			}
		}
		return { mode, created, collected };
	}

	private setStatus(id: number, status: UrsafNotice["status"], by: string | null, note: string | null, collected?: number) {
		this.sqlite
			.query(
				`UPDATE ursaf_notices SET status = ?, updated_at = ?, updated_by = ?, note = COALESCE(?, note)
				 ${collected !== undefined ? ", collected = ?" : ""} WHERE id = ?`
			)
			.run(...([status, Date.now(), by, note, ...(collected !== undefined ? [collected] : []), id] as Array<string | number | null>));
	}

	/** Prélève un avis (plafonné au solde du moment) et résout ses signalements. */
	private async collect(n: UrsafNotice): Promise<boolean> {
		const user = this.sqlite.query(`SELECT zeni FROM users WHERE id = ?`).get(n.userId) as {
			zeni: number;
		} | null;
		const amount = Math.min(n.amount, Math.max(0, Number(user?.zeni ?? 0)));
		const reference = n.reference;
		const tx = this.sqlite.transaction(() => {
			this.sqlite.query(`UPDATE users SET zeni = zeni - ? WHERE id = ?`).run(amount, n.userId);
			this.sqlite
				.query(`INSERT INTO action_logs (user_id, action, reason, meta) VALUES (?, 'ZENI_TAX', ?, ?)`)
				.run(n.userId, `Avis ${reference}`, JSON.stringify({ amount, notice: n.id, rate: n.rate }));
			const placeholders = n.flagIds.map(() => "?").join(",") || "NULL";
			this.sqlite
				.query(
					`UPDATE economy_flags SET status = 'resolved', resolved_at = ?, resolved_by = 'ursaf', resolve_note = ?
					 WHERE id IN (${placeholders}) AND status IN ('open', 'reviewing')`
				)
				.run(Date.now(), `Recouvré par l'avis ${reference}`, ...n.flagIds);
		});
		tx();
		this.setStatus(n.id, "collected", "ursaf", null, amount);
		await this.publish({ ...n, collected: amount }, "collected");
		return amount > 0;
	}

	/** Annule un avis ; s'il a été prélevé, rembourse le montant exact. */
	async cancel(id: number, by: string, note: string | null): Promise<UrsafNotice | null> {
		const row = this.sqlite.query(`SELECT * FROM ursaf_notices WHERE id = ?`).get(id) as NoticeRow | null;
		if (!row || row.status === "cancelled") return row ? toNotice(row) : null;
		const n = toNotice(row);
		if (n.status === "collected" && n.collected > 0) {
			this.sqlite.query(`UPDATE users SET zeni = zeni + ? WHERE id = ?`).run(n.collected, n.userId);
			this.sqlite
				.query(`INSERT INTO action_logs (user_id, moderator_id, action, reason, meta) VALUES (?, ?, 'ZENI_TAX_REFUND', ?, ?)`)
				.run(n.userId, by, `Annulation ${n.reference}`, JSON.stringify({ amount: n.collected, notice: n.id }));
		}
		this.setStatus(id, "cancelled", by, note);
		return { ...n, status: "cancelled", note };
	}

	private async publish(n: UrsafNotice, kind: "notified" | "collected") {
		try {
			const client = container.resolve(Client);
			const logs = container.resolve(LogService);
			const embed = new EmbedBuilder()
				.setColor(kind === "collected" ? 0xef4444 : 0xf59e0b)
				.setAuthor({ name: "URSAF · Union de Recouvrement des Saiyens et Autres Fraudeurs" })
				.setTitle(`Avis d'imposition ${n.reference}`)
				.setDescription(
					kind === "collected"
						? `Recouvrement effectué sur le solde de <@${n.userId}>.`
						: `Avis émis pour <@${n.userId}> — aucun prélèvement (mode notification).`
				)
				.addFields(
					{ name: "Base imposable", value: formatZeni(n.taxable), inline: true },
					{ name: "Taux", value: `${Math.round(n.rate * 100)} %`, inline: true },
					{
						name: kind === "collected" ? "Recouvré" : "Montant de l'avis",
						value: formatZeni(kind === "collected" ? n.collected : n.amount),
						inline: true,
					},
					{ name: "Sévérité", value: n.severity, inline: true },
					{ name: "Signalements", value: n.flagIds.map((i) => `#${i}`).join(", ").slice(0, 1000) }
				)
				.setFooter({ text: "Les zénis recouvrés sont détruits. Contestation : ticket au staff." })
				.setTimestamp(new Date());
			await logs.send(client, "economy", embed);
		} catch {
			/* pas de client ou de salon configuré */
		}
	}
}
