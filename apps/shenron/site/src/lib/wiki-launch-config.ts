/**
 * wiki-launch-config — lecture/écriture **server-only** du contrôle d'accès et du
 * classement des rubriques (catégories wiki + sections du site), piloté depuis
 * /admin/lancement.
 *
 * Le proxy (`proxy.ts`) lit ceci sur CHAQUE requête → cache module-level à TTL
 * court (30 s) IMPÉRATIF : jamais de round-trip PG par requête anonyme (cf. piège
 * event-loop/CONNECT_TIMEOUT). Ne throw jamais → repli sur les défauts (bêta).
 * Écriture via /api/wiki-launch (gate admin) qui revalide le layout.
 *
 * Tout tient dans la colonne **jsonb** `WikiLaunch.data` (`openKeys` + `order` +
 * `access`) : ajouter une rubrique ou un mode d'accès ne demande donc **aucune
 * migration SQL**.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { wikiLaunch } from "@/db/schema";
import { decideAccess, type AccessVerdict } from "@shenron/auth/policy";
import {
	ALL_ENTRIES,
	ALWAYS_OPEN_KEYS,
	DEFAULT_OPEN_KEYS,
	GATEABLE_CATEGORIES,
	type AccessMode,
	type AccessRule,
} from "@/lib/wiki-launch";

const SINGLETON_ID = "default";
const TTL_MS = 30_000;

export interface LaunchConfig {
	/** Catégories wiki publiques (héritage bêta — sert encore la nav et le teaser). */
	openKeys: string[];
	/** Ordre d'affichage des rubriques (nav + admin). */
	order: string[];
	/** Règle d'accès par clé ; absent = comportement dérivé (cf. `resolveAccess`). */
	access: Record<string, AccessRule>;
}

let cache: { cfg: LaunchConfig; ts: number } | null = null;

/** Clés valides ouvrables (garde-fou contre des clés obsolètes en base). */
const GATEABLE_KEYS = new Set(GATEABLE_CATEGORIES.map((c) => c.key));
const KNOWN_KEYS = new Set(ALL_ENTRIES.map((e) => e.key));
const ALWAYS_OPEN = new Set(ALWAYS_OPEN_KEYS);
const MODES: ReadonlySet<string> = new Set<AccessMode>(["public", "members", "roles", "admin"]);

function sanitizeOpenKeys(stored: unknown): string[] {
	const arr = Array.isArray((stored as { openKeys?: unknown })?.openKeys)
		? ((stored as { openKeys: unknown[] }).openKeys as unknown[])
		: [];
	const extra = arr.filter((k): k is string => typeof k === "string" && GATEABLE_KEYS.has(k));
	// alwaysOpen toujours inclus ; dédoublonné.
	return Array.from(new Set([...ALWAYS_OPEN_KEYS, ...extra]));
}

function sanitizeOrder(stored: unknown): string[] {
	const arr = Array.isArray((stored as { order?: unknown })?.order)
		? ((stored as { order: unknown[] }).order as unknown[])
		: [];
	return Array.from(
		new Set(arr.filter((k): k is string => typeof k === "string" && KNOWN_KEYS.has(k)))
	);
}

function sanitizeAccess(stored: unknown): Record<string, AccessRule> {
	const raw = (stored as { access?: unknown })?.access;
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, AccessRule> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		// Clé obsolète, ou rubrique verrouillée publique (bêta) → on ignore la règle
		// plutôt que de la persister : elle ne serait jamais appliquée.
		if (!KNOWN_KEYS.has(key) || ALWAYS_OPEN.has(key)) continue;
		const mode = (value as { mode?: unknown })?.mode;
		if (typeof mode !== "string" || !MODES.has(mode)) continue;
		const ids = Array.isArray((value as { roleIds?: unknown })?.roleIds)
			? ((value as { roleIds: unknown[] }).roleIds as unknown[])
			: [];
		const roleIds = Array.from(
			new Set(ids.filter((r): r is string => typeof r === "string" && /^\d{17,20}$/.test(r)))
		);
		// Mode « rôles » sans aucun rôle = piège à trou de sécurité inverse (personne
		// ne passe, y compris le staff qui croyait avoir ouvert) → on retombe sur
		// « connectés », intention la plus proche.
		out[key] = {
			mode: mode === "roles" && roleIds.length === 0 ? "members" : (mode as AccessMode),
			roleIds,
		};
	}
	return out;
}

function parse(stored: unknown): LaunchConfig {
	return {
		openKeys: sanitizeOpenKeys(stored),
		order: sanitizeOrder(stored),
		access: sanitizeAccess(stored),
	};
}

const DEFAULT_CONFIG: LaunchConfig = { openKeys: DEFAULT_OPEN_KEYS, order: [], access: {} };

/** Configuration complète (cache TTL 30 s). Utilisée par le proxy (hot-path) + la nav. */
export async function getLaunchConfig(): Promise<LaunchConfig> {
	const now = Date.now();
	if (cache && now - cache.ts < TTL_MS) return cache.cfg;
	try {
		const [row] = await db
			.select()
			.from(wikiLaunch)
			.where(eq(wikiLaunch.id, SINGLETON_ID))
			.limit(1);
		const cfg = row ? parse(row.data) : DEFAULT_CONFIG;
		cache = { cfg, ts: now };
		return cfg;
	} catch (e) {
		console.error("[wiki-launch] lecture échouée, repli défauts :", e);
		return cache?.cfg ?? DEFAULT_CONFIG;
	}
}

/**
 * Clés de catégories ouvertes (cache TTL 30 s). Inclut toujours les alwaysOpen.
 * Conservé pour la nav et le teaser, qui raisonnent encore en « ouvert/fermé ».
 */
export async function getOpenCategoryKeys(): Promise<string[]> {
	return (await getLaunchConfig()).openKeys;
}

/** Persiste une modification partielle (les alwaysOpen sont réinjectées). */
export async function saveLaunchConfig(
	patch: Partial<LaunchConfig>,
	by?: string | null
): Promise<LaunchConfig> {
	const current = await getLaunchConfig();
	const merged = {
		openKeys: patch.openKeys ?? current.openKeys,
		order: patch.order ?? current.order,
		access: patch.access ?? current.access,
	};
	const data = parse(merged);
	await db
		.insert(wikiLaunch)
		.values({ id: SINGLETON_ID, data, updatedBy: by ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: wikiLaunch.id,
			set: { data, updatedBy: by ?? null, updatedAt: new Date() },
		});
	cache = { cfg: data, ts: Date.now() }; // invalide + réchauffe le cache local
	return data;
}

/** Persiste l'ensemble des clés ouvertes (compat : /api/wiki-launch historique). */
async function saveOpenCategoryKeys(keys: string[], by?: string | null): Promise<string[]> {
	const saved = await saveLaunchConfig({ openKeys: keys }, by);
	return saved.openKeys;
}

/** Visiteur tel que le proxy le résout (`resolveVisitor`) plus ses rôles Discord. */
interface LaunchVisitor {
	isAdmin: boolean;
	authenticated: boolean;
	discordId?: string | null;
	roleIds?: readonly string[];
}

/**
 * Décision d'accès à une rubrique (`decideAccess`, `@shenron/auth/policy`).
 * Mode « rôles » sans aucun rôle → retombe sur « connectés » (`emptyRoles:
 * "members"`), comme `sanitizeAccess`. `deny-anonymous` permet au proxy de
 * proposer la connexion plutôt qu'un refus sec.
 */
function decideLaunchAccess(rule: AccessRule, visitor: LaunchVisitor): AccessVerdict {
	return decideAccess(rule, visitor, { emptyRoles: "members" });
}
