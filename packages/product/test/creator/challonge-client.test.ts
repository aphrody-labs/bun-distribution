import { expect, test } from "bun:test";

import {
  ChallongeClient,
  ChallongeError,
  type PlanEntry,
} from "../../src/creator/commands/challonge/client.ts";
import type { Fetch } from "../../src/creator/commands/challonge/http.ts";

const KEY = "sk-test-key-0123456789";

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body?: any;
}

function mock(
  handler: (call: Call, index: number) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const fetchFn: Fetch = async (input, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetchFn };
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function client(
  fetchFn: Fetch,
  extra: ConstructorParameters<typeof ChallongeClient>[0] = {},
) {
  const sleeps: number[] = [];
  const c = new ChallongeClient({
    auth: { kind: "key", key: KEY },
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    ...extra,
  });
  return { c, sleeps };
}

test("clé API v1 : en-têtes de l'API v2.1 (Authorization-Type v1, JSON:API) et URL de base", async () => {
  const { calls, fetchFn } = mock(() =>
    json(
      {
        data: {
          id: "42",
          type: "tournament",
          attributes: { name: "Cup", url: "cup" },
        },
      },
      201,
    ),
  );
  const { c } = client(fetchFn);
  const tournament = await c.createTournament({
    name: "Cup",
    tournament_type: "double elimination",
  });

  expect(tournament.id).toBe("42");
  const call = calls[0]!;
  expect(call.method).toBe("POST");
  expect(call.url.origin + call.url.pathname).toBe(
    "https://api.challonge.com/v2.1/tournaments",
  );
  expect(call.headers.get("authorization-type")).toBe("v1");
  expect(call.headers.get("authorization")).toBe(KEY);
  expect(call.headers.get("content-type")).toBe("application/vnd.api+json");
  expect(call.headers.get("accept")).toBe("application/json");
  expect(call.body).toEqual({
    data: {
      type: "tournament",
      attributes: { name: "Cup", tournament_type: "double elimination" },
    },
  });
});

test("jeton OAuth : Authorization-Type v2 et schéma Bearer", async () => {
  const { calls, fetchFn } = mock(() => json({ data: [] }));
  const c = new ChallongeClient({
    auth: { kind: "oauth", token: "tok-abcdef" },
    fetch: fetchFn,
  });
  await c.listTournaments({ state: "pending" });
  expect(calls[0]!.headers.get("authorization-type")).toBe("v2");
  expect(calls[0]!.headers.get("authorization")).toBe("Bearer tok-abcdef");
  expect(calls[0]!.url.searchParams.get("state")).toBe("pending");
});

test("community_id est ajouté à toutes les requêtes quand une communauté est configurée", async () => {
  const { calls, fetchFn } = mock(() =>
    json({ data: { id: "1", attributes: {} } }),
  );
  const { c } = client(fetchFn, { community: "fauxthrone" });
  await c.getTournament("abc");
  expect(calls[0]!.url.searchParams.get("community_id")).toBe("fauxthrone");
  expect(calls[0]!.url.pathname).toBe("/v2.1/tournaments/abc");
});

test("change_state envoie TournamentState/state ; bulk_add refuse plus de 20 participants", async () => {
  const { calls, fetchFn } = mock(() =>
    json({ data: { id: "1", attributes: { state: "underway" } } }),
  );
  const { c } = client(fetchFn);
  await c.changeState("1", "start");
  expect(calls[0]!.method).toBe("PUT");
  expect(calls[0]!.url.pathname).toBe("/v2.1/tournaments/1/change_state");
  expect(calls[0]!.body).toEqual({
    data: { type: "TournamentState", attributes: { state: "start" } },
  });
  await expect(
    c.bulkAddParticipants(
      "1",
      Array.from({ length: 21 }, (_, i) => ({ name: `p${i}` })),
    ),
  ).rejects.toThrow(RangeError);
});

test("429 avec Retry-After : on attend la durée demandée puis on rejoue", async () => {
  const { fetchFn } = mock((_, i) =>
    i === 0
      ? json({ errors: [] }, 429, { "Retry-After": "2" })
      : json({ data: { id: "1", attributes: {} } }),
  );
  const { c, sleeps } = client(fetchFn);
  await c.getTournament("1");
  expect(sleeps).toEqual([2000]);
  expect(c.requestCount).toBe(2);
});

test("429 persistant : backoff exponentiel puis erreur en français citant le quota mensuel", async () => {
  const { calls, fetchFn } = mock(() => json({ errors: [] }, 429));
  const { c, sleeps } = client(fetchFn, { maxRetries: 2 });
  const error = await c.getTournament("1").catch((e: ChallongeError) => e);
  expect(error).toBeInstanceOf(ChallongeError);
  expect((error as ChallongeError).status).toBe(429);
  expect((error as Error).message).toContain(
    "Limite de requêtes atteinte (429)",
  );
  expect((error as Error).message).toContain("500 requêtes par mois");
  expect(calls).toHaveLength(3);
  expect(sleeps).toEqual([500, 1000]);
});

test("429 avec Retry-After très long (quota épuisé) : pas d'attente inutile", async () => {
  const { calls, fetchFn } = mock(() =>
    json({ errors: [] }, 429, { "Retry-After": "86400" }),
  );
  const { c, sleeps } = client(fetchFn);
  await expect(c.getTournament("1")).rejects.toThrow("Limite de requêtes");
  expect(calls).toHaveLength(1);
  expect(sleeps).toEqual([]);
});

test("5xx : rejoué pour GET/PUT et 502-504 ; un POST en 500 n'est pas rejoué (risque de doublon)", async () => {
  const get = mock((_, i) =>
    i < 2
      ? new Response("boom", { status: 503 })
      : json({ data: { id: "1", attributes: {} } }),
  );
  await client(get.fetchFn).c.getTournament("1");
  expect(get.calls).toHaveLength(3);

  const put = mock((_, i) =>
    i === 0
      ? new Response("x", { status: 500 })
      : json({ data: { id: "1", attributes: {} } }),
  );
  await client(put.fetchFn).c.changeState("1", "start");
  expect(put.calls).toHaveLength(2);

  const post500 = mock(() => new Response("x", { status: 500 }));
  const error = await client(post500.fetchFn)
    .c.createTournament({ name: "n" })
    .catch((e: Error) => e);
  expect(post500.calls).toHaveLength(1);
  expect((error as Error).message).toContain("Erreur côté Challonge (500)");

  const post503 = mock((_, i) =>
    i === 0
      ? new Response("x", { status: 503 })
      : json({ data: { id: "9", attributes: {} } }, 201),
  );
  expect(
    (await client(post503.fetchFn).c.createTournament({ name: "n" })).id,
  ).toBe("9");
});

test("401, 404 et 422 : messages français, détail API conservé, la clé n'apparaît jamais", async () => {
  const unauthorized = mock(() =>
    json({ errors: [{ status: 401, detail: `invalid key ${KEY}` }] }, 401),
  );
  const e401 = (await client(unauthorized.fetchFn)
    .c.getTournament("1")
    .catch((e: Error) => e)) as ChallongeError;
  expect(e401.message).toContain("Clé API refusée (401)");
  expect(e401.message).toContain("CHALLONGE_API_KEY");
  expect(e401.message).not.toContain(KEY);

  const notFound = mock(() =>
    json({ errors: [{ status: 404, detail: "not found" }] }, 404),
  );
  expect(
    (
      (await client(notFound.fetchFn)
        .c.getTournament("zz")
        .catch((e: Error) => e)) as Error
    ).message,
  ).toContain("Introuvable (404)");

  const invalid = mock(() =>
    json(
      {
        errors: [
          {
            status: 422,
            detail: "Tournament Format is invalid",
            source: { pointer: "/data/attributes/tournament_format" },
          },
        ],
      },
      422,
    ),
  );
  const e422 = (await client(invalid.fetchFn)
    .c.createTournament({ name: "n" })
    .catch((e: Error) => e)) as ChallongeError;
  expect(e422.status).toBe(422);
  expect(e422.message).toContain("Données refusées (422)");
  expect(e422.message).toContain(
    "tournament_format : Tournament Format is invalid",
  );
  expect(e422.details[0]?.pointer).toBe("/data/attributes/tournament_format");
  expect(invalid.calls).toHaveLength(1);

  const taken = mock(() =>
    json(
      {
        errors: [
          {
            status: 422,
            detail: "URL has already been taken",
            source: { pointer: "/data/attributes/url" },
          },
        ],
      },
      422,
    ),
  );
  expect(
    (
      (await client(taken.fetchFn)
        .c.createTournament({ name: "n" })
        .catch((e: Error) => e)) as Error
    ).message,
  ).toContain("déjà prise");
});

test("erreur réseau : GET rejoué, POST non ; le message ne contient pas la clé", async () => {
  const flaky = mock((_, i) => {
    if (i === 0) throw new TypeError(`connect ECONNREFUSED (clé ${KEY})`);
    return json({ data: { id: "1", attributes: {} } });
  });
  await client(flaky.fetchFn).c.getTournament("1");
  expect(flaky.calls).toHaveLength(2);

  const down = mock(() => {
    throw new TypeError(`connect ECONNREFUSED (clé ${KEY})`);
  });
  const error = (await client(down.fetchFn)
    .c.createTournament({ name: "n" })
    .catch((e: Error) => e)) as Error;
  expect(down.calls).toHaveLength(1);
  expect(error.message).toContain("Réseau injoignable");
  expect(error.message).not.toContain(KEY);
});

test("--dry-run : aucun appel réseau, plan enregistré, réponses factices cohérentes", async () => {
  const { calls, fetchFn } = mock(() => json({}));
  const plan: PlanEntry[] = [];
  const c = new ChallongeClient({
    fetch: fetchFn,
    dryRun: true,
    onPlan: (entry) => plan.push(entry),
    community: "asso",
  });
  const tournament = await c.createTournament({ name: "Cup", url: "cup_1" });
  await c.bulkAddParticipants(tournament.id, [{ name: "a" }]);
  await c.changeState(tournament.id, "start");

  expect(calls).toHaveLength(0);
  expect(c.requestCount).toBe(0);
  expect(tournament.id).toBe("TOURNAMENT_ID");
  expect(tournament.attributes.url).toBe("cup_1");
  expect(plan.map((p) => `${p.method} ${new URL(p.url).pathname}`)).toEqual([
    "POST /v2.1/tournaments",
    "POST /v2.1/tournaments/TOURNAMENT_ID/participants/bulk_add",
    "PUT /v2.1/tournaments/TOURNAMENT_ID/change_state",
  ]);
  expect(plan[0]!.url).toContain("community_id=asso");
});

const items = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: String(from + i),
    attributes: { name: `p${from + i}` },
  }));

test("pagination : continue sur page pleine, s'arrête sur page courte, vide ou déjà vue", async () => {
  const pages = mock((call) =>
    json({
      data:
        call.url.searchParams.get("page") === "1"
          ? items(1, 30)
          : items(31, 35),
    }),
  );
  expect(await client(pages.fetchFn).c.listParticipants("t")).toHaveLength(35);
  expect(pages.calls.map((c) => c.url.searchParams.get("page"))).toEqual([
    "1",
    "2",
  ]);
  expect(pages.calls[0]!.url.searchParams.get("per_page")).toBe("100");

  // Pointeur qui « continue à l'infini » (bug corrigé côté Challonge le 2026-09-14) : la page répétée arrête la boucle.
  const loop = mock(() => json({ data: items(1, 30) }));
  expect(await client(loop.fetchFn).c.listMatches("t", "open")).toHaveLength(
    30,
  );
  expect(loop.calls).toHaveLength(2);
  expect(loop.calls[0]!.url.searchParams.get("state")).toBe("open");

  // Taille de page refusée (borne non documentée) : repli sur le défaut de l'API, sans per_page.
  const refused = mock((call) =>
    call.url.searchParams.has("per_page")
      ? json(
          { errors: [{ status: 422, detail: "per_page is too large" }] },
          422,
        )
      : json({ data: items(1, 3) }),
  );
  const strict = client(refused.fetchFn);
  expect(await strict.c.listParticipants("t")).toHaveLength(3);
  expect(refused.calls.map((c) => c.url.searchParams.get("per_page"))).toEqual([
    "100",
    null,
  ]);
  await strict.c.listParticipants("t");
  expect(refused.calls.at(-1)!.url.searchParams.has("per_page")).toBe(false);

  const empty = mock(() => json({ data: [] }));
  expect(await client(empty.fetchFn).c.listParticipants("t")).toEqual([]);
  expect(empty.calls).toHaveLength(1);
});
