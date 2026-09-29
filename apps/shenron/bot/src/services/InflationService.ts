/**
 * Inflation du serveur : indice des prix indexé sur la masse monétaire.
 *
 * Chaque jour, un instantané note les zénis en circulation et calcule l'indice
 * (`lib/inflation-rules`). Tant que `economy.inflation.enabled` vaut `false`,
 * l'historique se remplit quand même — on veut une courbe à montrer le jour où
 * on active — mais la boutique garde ses prix de base.
 *
 * La masse de référence est figée au premier instantané pris APRÈS activation :
 * l'indice mesure la dérive depuis ce jour-là, pas depuis la création du bot.
 */
import { singleton, inject } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { SettingsService } from "~/services/SettingsService";
import { CANON_INFLATION_FACTOR } from "~/lib/economy-canon";
import { changePercent, computeIndex, indexedPrice } from "~/lib/inflation-rules";
import { logger } from "~/lib/logger";

export type IndexPoint = {
	day: string;
	supply: number;
	index: number;
};

export type InflationStatus = {
	enabled: boolean;
	index: number;
	referenceSupply: number;
	supply: number;
	change7d: number;
	ceiling: number;
	history: IndexPoint[];
};

const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);

@singleton()
export class InflationService {
	private cache: { at: number; index: number } | null = null;

	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(SettingsService) private settings: SettingsService
	) {
		this.ensureSchema();
	}

	ensureSchema() {
		try {
			this.dbs.sqlite.exec(`
				CREATE TABLE IF NOT EXISTS economy_index (
					day TEXT PRIMARY KEY,
					supply INTEGER NOT NULL,
					index_value REAL NOT NULL,
					enabled INTEGER NOT NULL DEFAULT 0,
					created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch() * 1000 AS INTEGER))
				);
			`);
		} catch (e) {
			logger.warn({ err: e }, "[inflation] ensureSchema failed");
		}
	}

	private moneySupply(): number {
		const row = this.dbs.sqlite.query(`SELECT COALESCE(SUM(zeni), 0) AS s FROM users`).get() as {
			s: number;
		} | null;
		return Number(row?.s ?? 0);
	}

	private history(limit = 60): IndexPoint[] {
		const rows = this.dbs.sqlite
			.query(`SELECT day, supply, index_value FROM economy_index ORDER BY day DESC LIMIT ?`)
			.all(limit) as Array<{ day: string; supply: number; index_value: number }>;
		return rows.toReversed().map((r) => ({ day: r.day, supply: Number(r.supply), index: r.index_value }));
	}

	/** Instantané du jour (idempotent : un jour = une ligne, recalculée si relancée). */
	async snapshot(): Promise<IndexPoint> {
		const enabled = await this.settings.getBool("economy.inflation.enabled", false);
		const supply = this.moneySupply();
		const last = this.history(2).findLast((p) => p.day !== dayOf());

		let reference = await this.settings.getInt("economy.inflation.reference_supply", 0);
		if (enabled && reference <= 0 && supply > 0) {
			reference = supply;
			await this.settings.set("economy.inflation.reference_supply", String(supply));
		}

		const index = enabled
			? computeIndex({
					supply,
					referenceSupply: reference,
					previousIndex: last?.index ?? 1,
					elasticity: await this.settings.getFloat("economy.inflation.elasticity", 0.5),
					maxDailyChange: await this.settings.getFloat("economy.inflation.max_daily_change", 0.02),
					ceiling: await this.settings.getFloat("economy.inflation.ceiling", CANON_INFLATION_FACTOR),
				})
			: 1;

		this.dbs.sqlite
			.query(
				`INSERT INTO economy_index (day, supply, index_value, enabled) VALUES (?, ?, ?, ?)
				 ON CONFLICT(day) DO UPDATE SET supply = excluded.supply, index_value = excluded.index_value, enabled = excluded.enabled`
			)
			.run(dayOf(), supply, index, enabled ? 1 : 0);
		this.cache = null;
		logger.info({ supply, index, enabled }, "[inflation] snapshot");
		return { day: dayOf(), supply, index };
	}

	/** Indice appliqué aux prix (1 tant que l'inflation est désactivée). */
	async currentIndex(): Promise<number> {
		if (!(await this.settings.getBool("economy.inflation.enabled", false))) return 1;
		if (this.cache && Date.now() - this.cache.at < 5 * 60_000) return this.cache.index;
		const last = this.history(1).at(-1);
		const index = last?.index && last.index > 0 ? last.index : 1;
		this.cache = { at: Date.now(), index };
		return index;
	}

	/** Prix effectif d'un article de boutique. */
	async priceOf(basePrice: number): Promise<number> {
		const index = await this.currentIndex();
		return index === 1 ? basePrice : indexedPrice(basePrice, index);
	}

	async status(): Promise<InflationStatus> {
		const history = this.history(60);
		const index = await this.currentIndex();
		const weekAgo = history.at(-8)?.index ?? history[0]?.index ?? 1;
		return {
			enabled: await this.settings.getBool("economy.inflation.enabled", false),
			index,
			referenceSupply: await this.settings.getInt("economy.inflation.reference_supply", 0),
			supply: this.moneySupply(),
			change7d: changePercent(weekAgo, history.at(-1)?.index ?? index),
			ceiling: await this.settings.getFloat("economy.inflation.ceiling", CANON_INFLATION_FACTOR),
			history,
		};
	}
}
