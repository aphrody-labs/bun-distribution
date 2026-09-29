// SPDX-License-Identifier: Apache-2.0

/**
 * contribution-rights — lecture/écriture **server-only** du droit de
 * contribution (qui peut proposer une correction, sur le wiki et sur les
 * databooks), piloté depuis /admin/wiki/contributions.
 *
 * Même mécanique que `wiki-launch-config` : singleton jsonb + cache mémoire à
 * TTL court, jamais de throw (repli sur les défauts). La route de dépôt
 * l'appelle sur chaque proposition, l'UI une fois à l'ouverture de la modale.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contributionRights } from "@/db/schema";
import {
	CONTRIBUTION_SCOPES,
	DEFAULT_CONTRIBUTION_RIGHTS,
	DEFAULT_SCOPE_RULE,
	decideContribution,
	scopeOf,
	type ContributionMode,
	type ContributionRights,
	type ContributionScope,
	type ScopeRule,
} from "@/lib/contribution-rights-shared";
import { getMemberRoleIds } from "@/lib/member-roles";

const SINGLETON_ID = "default";
const TTL_MS = 30_000;

let cache: { rights: ContributionRights; ts: number } | null = null;

const MODES: ReadonlySet<string> = new Set<ContributionMode>(["members", "restricted", "admin"]);

function sanitizeRule(raw: unknown): ScopeRule {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_SCOPE_RULE };
	const o = raw as Record<string, unknown>;
	const mode =
		typeof o.mode === "string" && MODES.has(o.mode) ? (o.mode as ContributionMode) : "members";
	const ids = (v: unknown, re: RegExp) =>
		Array.isArray(v)
			? Array.from(
					new Set(v.filter((x): x is string => typeof x === "string" && re.test(x)))
				).slice(0, 200)
			: [];
	return {
		mode,
		// Snowflakes Discord uniquement — une chaîne libre ici serait une porte
		// ouverte à un rôle « inexistant » qui n'autorise personne sans le dire.
		roleIds: ids(o.roleIds, /^\d{17,20}$/),
		// Identifiants Discord nommés (mêmes snowflakes que les rôles).
		discordIds: ids(o.discordIds, /^\d{17,20}$/),
	};
}

function sanitizeRights(raw: unknown): ContributionRights {
	const o = (raw ?? {}) as Record<string, unknown>;
	const out = {} as ContributionRights;
	for (const scope of CONTRIBUTION_SCOPES) out[scope] = sanitizeRule(o[scope]);
	return out;
}

/** Droit courant. Ne throw jamais : en cas de panne DB on garde le défaut. */
export async function getContributionRights(): Promise<ContributionRights> {
	const now = Date.now();
	if (cache && now - cache.ts < TTL_MS) return cache.rights;
	try {
		const [row] = await db
			.select({ data: contributionRights.data })
			.from(contributionRights)
			.where(eq(contributionRights.id, SINGLETON_ID))
			.limit(1);
		const rights = sanitizeRights(row?.data);
		cache = { rights, ts: now };
		return rights;
	} catch (e) {
		console.error("[contribution-rights] lecture impossible, repli sur les défauts", e);
		return DEFAULT_CONTRIBUTION_RIGHTS;
	}
}

export async function setContributionRights(
	raw: unknown,
	updatedBy: string | null
): Promise<ContributionRights> {
	const rights = sanitizeRights(raw);
	await db
		.insert(contributionRights)
		.values({ id: SINGLETON_ID, data: rights as unknown as Record<string, unknown>, updatedBy })
		.onConflictDoUpdate({
			target: contributionRights.id,
			set: {
				data: rights as unknown as Record<string, unknown>,
				updatedBy,
				updatedAt: new Date(),
			},
		});
	cache = { rights, ts: Date.now() };
	return rights;
}

/**
 * Ce visiteur peut-il proposer une correction sur ce périmètre ?
 *
 * Les rôles Discord ne sont interrogés QUE si la règle en dépend : chaque appel
 * à `getMemberRoleIds` est un aller-retour HTTP vers le bot (avec cache 60 s),
 * inutile quand le périmètre est ouvert à tous les membres.
 */
export async function canContribute(
	scope: ContributionScope,
	visitor: { isAdmin: boolean; authenticated: boolean; discordId?: string | null }
): Promise<boolean> {
	const rights = await getContributionRights();
	const rule = rights[scope];
	if (visitor.isAdmin) return true;
	if (!visitor.authenticated) return false;
	if (rule.mode !== "restricted") return decideContribution(rule, visitor);

	const parCompte = !!visitor.discordId && rule.discordIds.includes(visitor.discordId);
	if (parCompte) return true;
	if (rule.roleIds.length === 0 || !visitor.discordId) return false;
	const roleIds = await getMemberRoleIds(visitor.discordId);
	return decideContribution(rule, { ...visitor, roleIds });
}

/** Périmètre d'une table, ré-exporté pour les appelants server-only. */
export { scopeOf };
