/**
 * Tests d'intégration Supabase (lecture directe + RLS) — natif `bun:test` + `fetch`.
 *
 * Valide la couche que le web Angular consomme en direct via la clé publishable :
 *   - lecture ouverte (anon) sur les tables/vues d'affichage,
 *   - secrets verrouillés (tokens OAuth, csrf),
 *   - écritures anon refusées par la RLS.
 *
 * Intégration RÉSEAU : tape uniquement l'API PostgREST d'une instance de test fournie
 * explicitement via `TEST_SUPABASE_URL` et `TEST_SUPABASE_KEY`. Sans les deux variables,
 * toute la suite est skippée ; aucun fallback de production n'est autorisé.
 *
 * Run : bun test tests/supabase/supabase-rls.test.ts
 */
import { describe, expect, test } from "bun:test";

const SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.TEST_SUPABASE_KEY ?? "";
const hasTestSupabase = SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;
const describeSupabase: typeof describe = hasTestSupabase ? describe : describe.skip;

function rest(path: string, init?: RequestInit): Promise<Response> {
	if (!hasTestSupabase) {
		throw new Error("Supabase test credentials are required before any network request");
	}

	return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		...init,
		headers: {
			apikey: SUPABASE_KEY,
			Authorization: `Bearer ${SUPABASE_KEY}`,
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
}

describeSupabase("Supabase — lecture dashboard ouverte (clé publishable)", () => {
	test("rank : paliers lisibles par anon", async () => {
		const res = await rest("rank?select=key,min_elo&order=min_elo");
		expect(res.status).toBe(200);
		const rows = (await res.json()) as Array<{ key: string; min_elo: number }>;
		expect(rows.length).toBeGreaterThanOrEqual(8);
		expect(rows[0]).toHaveProperty("key");
		expect(rows[0]).toHaveProperty("min_elo");
	});

	test("user_view : projection curatée lisible (pas de PII brute)", async () => {
		const res = await rest("user_view?select=id,displayName,solo_elo&limit=2");
		expect(res.status).toBe(200);
		const rows = (await res.json()) as unknown[];
		expect(Array.isArray(rows)).toBe(true);
	});

	test("clan / user_elo / event : lisibles", async () => {
		for (const rel of [
			"clan?select=id&limit=1",
			"user_elo?select=user_id&limit=1",
			"event?select=id&limit=1",
		]) {
			const res = await rest(rel);
			expect(res.status).toBe(200);
		}
	});
});

describeSupabase("Supabase — tokens OAuth protégés (masque de colonnes user_connection)", () => {
	test("colonnes sûres de user_connection lisibles (provider, etc.)", async () => {
		const res = await rest("user_connection?select=provider,external_username&limit=1");
		expect(res.status).toBe(200);
	});

	test("access_token / refresh_token : permission denied (colonnes masquées = anti vol de compte)", async () => {
		for (const col of ["access_token", "refresh_token"]) {
			const res = await rest(`user_connection?select=${col}&limit=1`);
			expect(res.status).toBe(401);
			const body = (await res.json()) as { code?: string };
			expect(body.code).toBe("42501");
		}
	});
});

describeSupabase("Supabase — écritures anon interdites", () => {
	test("INSERT rank rejeté par la RLS (aucune policy write anon)", async () => {
		const res = await rest("rank", {
			method: "POST",
			body: JSON.stringify({ key: "hack", min_elo: 0, max_elo: 1 }),
		});
		expect(res.status).toBe(401);
	});
});
