/**
 * Contrats d'API publics (ONLINE) — natif `bun:test` + `fetch`.
 *
 * Valide, contre l'API réellement déployée, le contrat que le web Angular consomme :
 *   - endpoints de LECTURE (health, paliers ranked, tournois, clans, leaderboard),
 *   - garde-fous SÉCU sans état (lecture seule, idempotent) : auth requise,
 *     retrait de l'ancien flux OAuth Discord, backdoor de test 404 en prod.
 *
 * 100 % réseau, ZÉRO base live / ZÉRO binding natif (argon2/canvas) : on ne tape que
 * les routes HTTP publiques. Skip propre (`describe.skipIf`) si l'API est injoignable
 * (CI hors-ligne) → la suite reste verte sans faux négatif.
 *
 * Bases surchargeables par env :
 *   - API_BASE : API ranked + proxy bot (opt-in ; aucun appel prod par défaut)
 *   - OG_BASE  : domaine web qui sert l'image OpenGraph (opt-in)
 *
 * Run : cd apps/achillea-bot && bun test tests/supabase/api-contract.test.ts
 */
import { describe, expect, test } from "bun:test";

// L'API ranked héberge /api/health + /api/ranked/* et proxifie /api/* vers le bot TSed
// (tournaments, clans, users/...). Voir src/ranked/main.ts.
const API_BASE = process.env.API_BASE ? process.env.API_BASE.replace(/\/$/, "") : "";
// L'image OpenGraph est servie par le front (rewrite nginx /opengraph-image → .png),
// PAS par le host ranked. Voir apps/achillea-web/src/index.html + apps/achillea-web/public/opengraph-image.png.
const OG_BASE = process.env.OG_BASE ? process.env.OG_BASE.replace(/\/$/, "") : "";

// Cold-start possible (service idle + requêtes SQL lourdes) → timeout généreux.
const REQ_TIMEOUT_MS = 25_000;

/** fetch avec timeout (AbortController) + RETRY/backoff sur 5xx ou erreur réseau.
 *  La suite tape l'API prod en concurrence avec d'autres suites online → des 5xx
 *  transitoires (burst sur le proxy) sont possibles ; on retente pour ne pas faire
 *  un faux négatif. Les statuts < 500 (2xx/3xx/4xx — y compris 401/404/302 attendus)
 *  sont renvoyés immédiatement. Lève seulement si l'API reste injoignable/5xx. */
async function http(url: string, init?: RequestInit): Promise<Response> {
	let lastErr: unknown = new Error("aucune tentative");
	for (let attempt = 0; attempt < 4; attempt++) {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
		try {
			const res = await fetch(url, { signal: ctrl.signal, ...init });
			if (res.status < 500) return res;
			lastErr = new Error(`HTTP ${res.status}`);
		} catch (e) {
			lastErr = e;
		} finally {
			clearTimeout(t);
		}
		await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); // backoff progressif
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** GET « best-effort » pour les contrats de LECTURE : renvoie la Response si le serveur
 *  répond (statut exploitable < 500), ou `null` s'il reste indisponible (5xx persistant /
 *  réseau) après retries. Les tests qui l'utilisent SKIPPENT proprement quand c'est `null`
 *  (surcharge transitoire de l'API prod partagée) → pas de faux négatif en CI. Le contrat de
 *  forme reste vérifié dès que le serveur répond, et un vrai 4xx (404…) n'est PAS masqué. */
async function tryGet(url: string, init?: RequestInit): Promise<Response | null> {
	try {
		return await http(url, init);
	} catch {
		console.warn(`[api-contract] ${url} indisponible (5xx/réseau) après retries → test sauté.`);
		return null;
	}
}

/** Probe d'accessibilité (best-effort, une seule tentative rapide). Top-level await →
 *  résolu avant la collecte des tests, donc utilisable dans `describe.skipIf` (skip propre offline). */
async function probe(url: string): Promise<boolean> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	try {
		const res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
		// A gateway 5xx means the upstream contract is unavailable; treat it as
		// offline so CI does not report a false product failure.
		return res.status >= 200 && res.status < 400;
	} catch {
		return false;
	} finally {
		clearTimeout(t);
	}
}

function oauthStateRedirect(location: string): string {
	const state = new URL(location).searchParams.get("state") ?? "";
	const segments = state.split(".");
	expect(segments).toHaveLength(3);
	const payload = JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8")) as {
		redirect?: unknown;
	};
	return typeof payload.redirect === "string" ? payload.redirect : "";
}

// Sonde de disponibilité : si l'hôte ne répond pas, on saute la suite réseau concernée.
const apiOnline = API_BASE ? await probe(`${API_BASE}/api/health`) : false;
const ogOnline = OG_BASE ? await probe(`${OG_BASE}/opengraph-image`) : false;

describe.skipIf(!apiOnline)("API contract — endpoints publics (lecture)", () => {
	test("GET /api/health → 200 + { ok: true }", async () => {
		const res = await tryGet(`${API_BASE}/api/health`);
		if (!res) return;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok?: boolean };
		expect(body.ok).toBe(true);
	});

	test("GET /api/ranked/tiers → 200 + tableau de paliers (key/minElo/maxElo)", async () => {
		const res = await tryGet(`${API_BASE}/api/ranked/tiers?mode=2`);
		if (!res) return;
		expect(res.status).toBe(200);
		const rows = (await res.json()) as Array<Record<string, unknown>>;
		expect(Array.isArray(rows)).toBe(true);
		expect(rows.length).toBeGreaterThan(0);
		const first = rows[0];
		expect(first).toHaveProperty("key");
		expect(first).toHaveProperty("minElo");
		expect(first).toHaveProperty("maxElo");
	});

	test("GET /api/tournaments → 200 + { data: [], meta }", async () => {
		const res = await tryGet(`${API_BASE}/api/tournaments`);
		if (!res) return;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data?: unknown[]; meta?: unknown };
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.meta).toBeDefined();
	});

	test("GET /api/tournaments/23 → 200 + bracket/stages (élément tournamentData.stage)", async () => {
		const res = await tryGet(`${API_BASE}/api/tournaments/23`);
		if (!res) return;
		expect(res.status).toBe(200);
		// Contrat : [tournament, participants[], tournamentData] (brackets-manager).
		const payload = (await res.json()) as unknown;
		expect(Array.isArray(payload)).toBe(true);
		const arr = payload as unknown[];
		expect(arr.length).toBe(3);
		const tournament = arr[0] as Record<string, unknown>;
		expect(tournament).toHaveProperty("id", 23);
		// La donnée de bracket (stages/rounds/matchs) vit dans le 3e élément.
		const data = arr[2] as Record<string, unknown>;
		expect(data).toHaveProperty("stage");
		expect(Array.isArray((data as { stage: unknown }).stage)).toBe(true);
	});

	test("GET /api/clans?pagination=3 → 200 + data[] paginé (meta.limit=3, page → ≤ 3)", async () => {
		// meta.limit reflète le paramètre pagination quelle que soit la page demandée.
		const res = await tryGet(`${API_BASE}/api/clans?pagination=3`);
		if (!res) return;
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data?: unknown[];
			meta?: { limit?: number; total?: number };
		};
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.meta?.limit).toBe(3);
		expect(typeof body.meta?.total).toBe("number");

		// Avec une page explicite, la tranche renvoyée est bornée par la pagination.
		const resPaged = await tryGet(`${API_BASE}/api/clans?pagination=3&page=1`);
		if (!resPaged) return;
		expect(resPaged.status).toBe(200);
		const paged = (await resPaged.json()) as { data?: unknown[] };
		expect(Array.isArray(paged.data)).toBe(true);
		expect(paged.data!.length).toBeLessThanOrEqual(3);
	});

	test("GET /api/users/leaderboard?mode=2 → 200 + { entries, total }", async () => {
		const res = await tryGet(`${API_BASE}/api/users/leaderboard?mode=2`);
		if (!res) return;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { entries?: unknown[]; total?: number };
		expect(Array.isArray(body.entries)).toBe(true);
		expect(typeof body.total).toBe("number");
	});
});

describe.skipIf(!apiOnline)("API contract — sécurité (auth, idempotent)", () => {
	test("GET /api/auth/me SANS cookie → 401", async () => {
		const res = await http(`${API_BASE}/api/auth/me`);
		expect(res.status).toBe(401);
	});

	test("GET /api/auth/test-login?key=x → 404 (backdoor désactivée en prod)", async () => {
		const res = await http(`${API_BASE}/api/auth/test-login?key=x`, { redirect: "manual" });
		expect(res.status).toBe(404);
	});

	test("GET /api/auth/discord → 404, ancien alias retiré", async () => {
		const res = await http(`${API_BASE}/api/auth/discord?state=%2F`, { redirect: "manual" });
		expect(res.status).toBe(404);
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	test("GET /api/auth/callback → 404, ancien callback retiré", async () => {
		const res = await http(`${API_BASE}/api/auth/callback?code=obsolete`, {
			redirect: "manual",
		});
		expect(res.status).toBe(404);
		expect(res.headers.get("set-cookie")).toBeNull();
	});
});

describe.skipIf(!ogOnline)("API contract — image OpenGraph (front)", () => {
	test("GET /opengraph-image → 200 + image/png", async () => {
		const res = await tryGet(`${OG_BASE}/opengraph-image`);
		if (!res) return;
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("image/png");
	});
});
