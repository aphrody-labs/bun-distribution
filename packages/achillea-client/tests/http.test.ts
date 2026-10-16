import { describe, expect, test } from "bun:test";

import {
	AchilleaHttp,
	encodePathSegment,
	encodeQuery,
	joinPath,
	type AchilleaFetch,
} from "../src/v1";
import { z } from "zod";

function jsonResponse(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

/** Fetch factice : mémorise le dernier appel et rend la réponse programmée. */
function recordingFetch(response: () => Response): {
	fetch: AchilleaFetch;
	calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
	const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
	const fetch: AchilleaFetch = async (input, init) => {
		calls.push({ url: String(input), init });
		return response();
	};
	return { fetch, calls };
}

const probeSchema = z.object({ value: z.number() });

/** Fetch qui ne répond jamais et ne rejette que sur abandon du signal. */
const hangingFetch: AchilleaFetch = (_input, init) =>
	new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(new Error("The operation timed out.")));
	});

/** Lit un en-tête émis, sans supposer qu'un appel a bien été enregistré. */
function headerOf(call: { init: RequestInit | undefined } | undefined, name: string): string | undefined {
	const headers = call?.init?.headers as Record<string, string> | undefined;
	return headers?.[name];
}

describe("query-string", () => {
	test("préfixe par `?`, omet les valeurs absentes et répète les tableaux", () => {
		expect(
			encodeQuery({
				page: 2,
				pagination: 25,
				organization: undefined,
				season: null,
				states: ["Ongoing", "Finished"],
				active: true,
			})
		).toBe("?page=2&pagination=25&states=Ongoing&states=Finished&active=true");
	});

	test("rend une chaîne vide quand il ne reste rien à encoder", () => {
		expect(encodeQuery()).toBe("");
		expect(encodeQuery({})).toBe("");
		expect(encodeQuery({ a: undefined, b: null })).toBe("");
	});

	test("sérialise les dates en ISO et échappe les valeurs", () => {
		expect(encodeQuery({ from: new Date("2026-01-02T03:04:05.000Z") })).toBe(
			"?from=2026-01-02T03%3A04%3A05.000Z"
		);
		expect(encodeQuery({ q: "rose griffon & co" })).toBe("?q=rose+griffon+%26+co");
	});

	test("assemble chemin et query-string", () => {
		expect(joinPath("/guilds", { page: 1 })).toBe("/guilds?page=1");
		expect(joinPath("/guilds")).toBe("/guilds");
	});

	test("encode un segment de chemin sans laisser fuir de slash", () => {
		expect(encodePathSegment("123/456")).toBe("123%2F456");
		expect(encodePathSegment(42)).toBe("42");
	});
});

describe("construction d'URL", () => {
	test("ignore les slashs finaux de la base", () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ baseUrl: "https://example.test/api///", fetch });

		void http.get("/ranked/me", probeSchema, { query: { mode: 2 } });

		expect(http.baseUrl).toBe("https://example.test/api");
		expect(calls[0]?.url).toBe("https://example.test/api/ranked/me?mode=2");
	});

	test("expose une URL absolue pour les ressources non JSON", () => {
		const http = new AchilleaHttp({ baseUrl: "https://example.test/api" });

		expect(http.url("/users/1/card.png")).toBe("https://example.test/api/users/1/card.png");
		expect(http.url("/guilds", { page: 2 })).toBe(
			"https://example.test/api/guilds?page=2"
		);
	});
});

describe("issues de requête", () => {
	test("lie le fetch natif à globalThis avant un appel depuis le navigateur", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (function (this: unknown) {
			if (this !== globalThis) throw new TypeError("Illegal invocation");
			return Promise.resolve(jsonResponse({ value: 7 }));
		}) as unknown as typeof fetch;
		try {
			const http = new AchilleaHttp({ baseUrl: "https://example.test/api" });
			expect(await http.get("/probe", probeSchema)).toEqual({
				ok: true,
				value: { value: 7 },
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("succès : la valeur validée est rendue", async () => {
		const http = new AchilleaHttp({ fetch: async () => jsonResponse({ value: 7 }) });

		const result = await http.get("/probe", probeSchema);

		expect(result).toEqual({ ok: true, value: { value: 7 } });
	});

	test("404 : échec HTTP, sans tentative de validation", async () => {
		const http = new AchilleaHttp({
			baseUrl: "https://example.test/api",
			fetch: async () => jsonResponse({ error: "not found" }, 404),
		});

		const result = await http.get("/users/inconnu", probeSchema);

		expect(result).toEqual({
			ok: false,
			kind: "http",
			detail: "HTTP 404 for /users/inconnu",
			path: "/users/inconnu",
			status: 404,
		});
	});

	test("JSON illisible : échec `invalid_json`", async () => {
		const http = new AchilleaHttp({ fetch: async () => new Response("pas du JSON") });

		const result = await http.get("/probe", probeSchema);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("invalid_json");
		expect(result.path).toBe("/probe");
	});

	test("réponse hors-schéma : échec `invalid_response` avec le chemin fautif", async () => {
		const http = new AchilleaHttp({ fetch: async () => jsonResponse({ value: "sept" }) });

		const result = await http.get("/probe", probeSchema, { query: { mode: 4 } });

		expect(result).toMatchObject({
			ok: false,
			kind: "invalid_response",
			path: "/probe?mode=4",
		});
		if (!result.ok) expect(result.detail).toStartWith("value :");
	});

	test("délai dépassé : échec `unreachable`, jamais d'exception", async () => {
		const http = new AchilleaHttp({ fetch: hangingFetch, timeoutMs: 5 });

		const result = await http.get("/probe", probeSchema);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("unreachable");
		expect(result.detail).toBe("The operation timed out.");
	});

	test("réseau injoignable : échec `unreachable`", async () => {
		const http = new AchilleaHttp({
			fetch: async () => {
				throw new Error("connection refused");
			},
		});

		const result = await http.get("/probe", probeSchema);

		expect(result).toEqual({
			ok: false,
			kind: "unreachable",
			detail: "connection refused",
			path: "/probe",
		});
	});
});

describe("verbes et corps de requête", () => {
	test("POST / PUT / PATCH sérialisent un corps JSON", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ baseUrl: "https://example.test/api", fetch });

		await http.post("/a", probeSchema, { n: 1 });
		await http.put("/b", probeSchema, { n: 2 });
		await http.patch("/c", probeSchema, { n: 3 });

		expect(calls.map((call) => call.init?.method)).toEqual(["POST", "PUT", "PATCH"]);
		expect(calls.map((call) => call.init?.body)).toEqual([
			JSON.stringify({ n: 1 }),
			JSON.stringify({ n: 2 }),
			JSON.stringify({ n: 3 }),
		]);
		expect(headerOf(calls[0], "Content-Type")).toBe("application/json");
	});

	test("POST sans argument envoie `{}` — un corps vide casse le proxy Bun/Express", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ fetch });

		await http.post("/a", probeSchema);

		expect(calls[0]?.init?.body).toBe("{}");
	});

	test("DELETE n'envoie un corps que s'il en reçoit un", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ fetch });

		await http.delete("/a", probeSchema);
		await http.delete("/b", probeSchema, { pk: { id: 1 } });

		expect(calls[0]?.init?.method).toBe("DELETE");
		expect(calls[0]?.init?.body).toBeUndefined();
		expect(calls[1]?.init?.body).toBe(JSON.stringify({ pk: { id: 1 } }));
	});

	test("un corps brut part en `text/plain` sans passer par JSON", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ fetch });

		await http.requestJson("/ranked/12/dispute", probeSchema, {
			method: "POST",
			rawBody: "data:image/png;base64,AAAA",
			contentType: "text/plain",
		});

		expect(calls[0]?.init?.body).toBe("data:image/png;base64,AAAA");
		expect(headerOf(calls[0], "Content-Type")).toBe("text/plain");
	});

	test("une réponse texte est rendue telle quelle", async () => {
		const http = new AchilleaHttp({
			fetch: async () => new Response("# HELP achillea_up\nachillea_up 1\n"),
		});

		const result = await http.requestText("/metrics");

		expect(result).toEqual({ ok: true, value: "# HELP achillea_up\nachillea_up 1\n" });
	});
});

describe("authentification", () => {
	test("`getAuthToken` pose un en-tête Bearer", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ fetch, getAuthToken: () => "jeton-dev" });

		await http.get("/probe", probeSchema);

		expect(headerOf(calls[0], "Authorization")).toBe("Bearer jeton-dev");
	});

	test("un `tokenStore` injecté est lu de façon asynchrone", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({
			fetch,
			tokenStore: { getToken: async () => "jeton-store" },
		});

		await http.get("/probe", probeSchema);

		expect(headerOf(calls[0], "Authorization")).toBe("Bearer jeton-store");
	});

	test("un jeton absent ne pose aucun en-tête", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ fetch, getAuthToken: () => null });

		await http.get("/probe", probeSchema);

		expect(headerOf(calls[0], "Authorization")).toBeUndefined();
	});

	test("`credentials` n'est transmis que s'il est configuré", async () => {
		const withCookies = recordingFetch(() => jsonResponse({ value: 1 }));
		const withoutCookies = recordingFetch(() => jsonResponse({ value: 1 }));

		await new AchilleaHttp({ fetch: withCookies.fetch, credentials: "include" }).get(
			"/probe",
			probeSchema
		);
		await new AchilleaHttp({ fetch: withoutCookies.fetch }).get("/probe", probeSchema);

		expect(withCookies.calls[0]?.init?.credentials).toBe("include");
		expect(withoutCookies.calls[0]?.init?.credentials).toBeUndefined();
	});

	test("les en-têtes par défaut et ceux de l'appel se cumulent", async () => {
		const { fetch, calls } = recordingFetch(() => jsonResponse({ value: 1 }));
		const http = new AchilleaHttp({ fetch, headers: { "Accept-Language": "fr" } });

		await http.get("/probe", probeSchema, { headers: { "x-internal-secret": "chut" } });

		expect(headerOf(calls[0], "Accept-Language")).toBe("fr");
		expect(headerOf(calls[0], "x-internal-secret")).toBe("chut");
		expect(headerOf(calls[0], "Accept")).toBe("application/json");
	});
});
