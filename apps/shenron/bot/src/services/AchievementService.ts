import { singleton, inject } from "tsyringe";
import { eq } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { achievementTriggers, type AchievementTrigger } from "~/db/schema";
import { EconomyService } from "./EconomyService";
import { logger } from "~/lib/logger";

@singleton()
export class AchievementService {
	private cache: { triggers: AchievementTrigger[]; compiled: Map<string, RegExp>; ts: number } = {
		triggers: [],
		compiled: new Map(),
		ts: 0,
	};
	private TTL = 5 * 60_000;

	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(EconomyService) private eco: EconomyService
	) {}

	async refresh() {
		const triggers = await this.dbs.db
			.select()
			.from(achievementTriggers)
			.where(eq(achievementTriggers.enabled, true));
		const compiled = new Map<string, RegExp>();
		for (const t of triggers) {
			try {
				compiled.set(t.code, new RegExp(t.pattern, t.flags ?? "i"));
			} catch (err) {
				logger.warn({ err, code: t.code }, "invalid achievement trigger regex");
			}
		}
		this.cache = { triggers, compiled, ts: Date.now() };
	}

	async checkMessage(userId: string, content: string): Promise<string[]> {
		if (Date.now() - this.cache.ts > this.TTL) await this.refresh();
		const granted: string[] = [];
		for (const t of this.cache.triggers) {
			const re = this.cache.compiled.get(t.code);
			if (!re || !re.test(content)) continue;
			const ok = await this.eco.grantAchievement(userId, t.code);
			if (ok) granted.push(t.code);
		}
		return granted;
	}

	async list() {
		return this.dbs.db.select().from(achievementTriggers);
	}

	async upsert(trigger: {
		code: string;
		description?: string;
		pattern: string;
		flags?: string;
		enabled?: boolean;
	}) {
		await this.dbs.db
			.insert(achievementTriggers)
			.values({
				code: trigger.code,
				description: trigger.description ?? null,
				pattern: trigger.pattern,
				flags: trigger.flags ?? "i",
				enabled: trigger.enabled ?? true,
			})
			.onConflictDoUpdate({
				target: achievementTriggers.code,
				set: {
					description: trigger.description ?? null,
					pattern: trigger.pattern,
					flags: trigger.flags ?? "i",
					enabled: trigger.enabled ?? true,
				},
			});
		await this.refresh();
	}

	async remove(code: string) {
		await this.dbs.db.delete(achievementTriggers).where(eq(achievementTriggers.code, code));
		await this.refresh();
	}

	/** Active ou désactive un trigger sans le supprimer. */
	async setEnabled(code: string, enabled: boolean): Promise<boolean> {
		const existing = await this.dbs.db
			.select()
			.from(achievementTriggers)
			.where(eq(achievementTriggers.code, code))
			.limit(1);
		if (existing.length === 0) return false;
		await this.dbs.db
			.update(achievementTriggers)
			.set({ enabled })
			.where(eq(achievementTriggers.code, code));
		await this.refresh();
		return true;
	}

	/** Teste un pattern contre une chaîne — utile pour debug avant /succes set. */
	async test(
		code: string,
		sample: string
	): Promise<{ match: boolean; pattern: string; flags: string } | null> {
		const existing = await this.dbs.db
			.select()
			.from(achievementTriggers)
			.where(eq(achievementTriggers.code, code))
			.limit(1);
		const t = existing[0];
		if (!t) return null;
		try {
			const re = new RegExp(t.pattern, t.flags ?? "i");
			return { match: re.test(sample), pattern: t.pattern, flags: t.flags ?? "i" };
		} catch {
			return { match: false, pattern: t.pattern, flags: t.flags ?? "i" };
		}
	}
}
