import { singleton, inject } from "tsyringe";
import { eq } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { commandPermissions, type CommandPermission } from "~/db/schema";
import { EventBusService } from "./EventBusService";

export interface PermissionRule {
	name: string;
	enabled: boolean;
	allowedRoles: string[];
	deniedRoles: string[];
	deniedUsers: string[];
}

export type CheckResult =
	| { allowed: true }
	| {
			allowed: false;
			reason: "disabled" | "not_in_allowed_roles" | "in_denied_role" | "in_denied_users";
			rule: string;
	  };

function parseList(raw: string): string[] {
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function rowToRule(row: CommandPermission): PermissionRule {
	return {
		name: row.name,
		enabled: row.enabled,
		allowedRoles: parseList(row.allowedRoles),
		deniedRoles: parseList(row.deniedRoles),
		deniedUsers: parseList(row.deniedUsers),
	};
}

/**
 * Permissions runtime des slash commands. Source : table `command_permissions`.
 *
 * Lookup hiérarchique : `admin reload` → `admin *` → `*` (joker global).
 * La règle exacte gagne ; sinon fallback sur le joker du groupe ; sinon
 * autorisé par défaut.
 */
@singleton()
export class CommandPermissionsService {
	private cache = new Map<string, PermissionRule>();
	private cacheTs = 0;
	private TTL = 30_000;

	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(EventBusService) private bus: EventBusService
	) {}

	private async refresh(): Promise<void> {
		const rows = await this.dbs.db.select().from(commandPermissions);
		this.cache.clear();
		for (const r of rows) this.cache.set(r.name, rowToRule(r));
		this.cacheTs = Date.now();
	}

	private async ensureFresh(): Promise<void> {
		if (Date.now() - this.cacheTs > this.TTL) await this.refresh();
	}

	invalidate(): void {
		this.cacheTs = 0;
	}

	/**
	 * Cherche la règle applicable à `name` selon la hiérarchie :
	 *   "admin reload" → "admin *" → "*"
	 */
	private async resolve(name: string): Promise<PermissionRule | undefined> {
		await this.ensureFresh();
		const exact = this.cache.get(name);
		if (exact) return exact;
		const sep = name.indexOf(" ");
		if (sep > 0) {
			const groupWildcard = this.cache.get(`${name.slice(0, sep)} *`);
			if (groupWildcard) return groupWildcard;
		}
		return this.cache.get("*");
	}

	/**
	 * Vérifie qu'un membre peut exécuter une commande.
	 *
	 * @param name nom canonique (ex: `"admin reload"`, `"daily"`).
	 * @param userId ID du membre.
	 * @param userRoleIds liste des rôles du membre dans la guild.
	 */
	async check(name: string, userId: string, userRoleIds: readonly string[]): Promise<CheckResult> {
		const rule = await this.resolve(name);
		if (!rule) return { allowed: true };

		if (rule.deniedUsers.includes(userId)) {
			return { allowed: false, reason: "in_denied_users", rule: rule.name };
		}

		if (!rule.enabled) {
			return { allowed: false, reason: "disabled", rule: rule.name };
		}

		if (rule.deniedRoles.length > 0) {
			for (const r of userRoleIds) {
				if (rule.deniedRoles.includes(r)) {
					return { allowed: false, reason: "in_denied_role", rule: rule.name };
				}
			}
		}

		if (rule.allowedRoles.length > 0) {
			const hasAllowed = userRoleIds.some((r) => rule.allowedRoles.includes(r));
			if (!hasAllowed) {
				return {
					allowed: false,
					reason: "not_in_allowed_roles",
					rule: rule.name,
				};
			}
		}

		return { allowed: true };
	}

	async list(): Promise<PermissionRule[]> {
		await this.refresh();
		return [...this.cache.values()].toSorted((a, b) => a.name.localeCompare(b.name));
	}

	async get(name: string): Promise<PermissionRule | undefined> {
		await this.ensureFresh();
		return this.cache.get(name);
	}

	async upsert(rule: Partial<PermissionRule> & { name: string }): Promise<PermissionRule> {
		const next: PermissionRule = {
			name: rule.name,
			enabled: rule.enabled ?? true,
			allowedRoles: rule.allowedRoles ?? [],
			deniedRoles: rule.deniedRoles ?? [],
			deniedUsers: rule.deniedUsers ?? [],
		};
		await this.dbs.db
			.insert(commandPermissions)
			.values({
				name: next.name,
				enabled: next.enabled,
				allowedRoles: JSON.stringify(next.allowedRoles),
				deniedRoles: JSON.stringify(next.deniedRoles),
				deniedUsers: JSON.stringify(next.deniedUsers),
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: commandPermissions.name,
				set: {
					enabled: next.enabled,
					allowedRoles: JSON.stringify(next.allowedRoles),
					deniedRoles: JSON.stringify(next.deniedRoles),
					deniedUsers: JSON.stringify(next.deniedUsers),
					updatedAt: new Date(),
				},
			});
		this.cache.set(next.name, next);
		this.cacheTs = Date.now();
		this.bus.emit("command:permissions:changed", { name: next.name, action: "upsert" });
		return next;
	}

	async remove(name: string): Promise<void> {
		await this.dbs.db.delete(commandPermissions).where(eq(commandPermissions.name, name));
		this.cache.delete(name);
		this.bus.emit("command:permissions:changed", { name, action: "delete" });
	}
}
