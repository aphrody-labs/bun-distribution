import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageError } from "../../src/shared/args.ts";
import { ChallongeClient } from "../../src/creator/commands/challonge/client.ts";
import {
  authOf,
  loadConfig,
  secretsOf,
} from "../../src/creator/commands/challonge/config.ts";
import type { Fetch } from "../../src/creator/commands/challonge/http.ts";
import {
  assertUnique,
  chunk,
  namesFromInline,
  namesFromLines,
  readParticipants,
  readSeedFile,
  seedBy,
  shuffleSeeds,
} from "../../src/creator/commands/challonge/participants.ts";
import { StateStore } from "../../src/creator/commands/challonge/state.ts";
import {
  addParticipants,
  buildTournamentAttributes,
  createTournamentFlow,
  findMatch,
  normalizeType,
  parseScore,
  reportMatch,
  stateFor,
} from "../../src/creator/commands/challonge/tournaments.ts";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ck-challonge-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: any;
}

function api(handler: (call: Call, index: number) => unknown) {
  const calls: Call[] = [];
  const fetchFn: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/v2.1", ""),
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const out = handler(call, calls.length - 1);
    return new Response(JSON.stringify(out), {
      status: call.method === "POST" ? 201 : 200,
    });
  };
  const client = new ChallongeClient({
    auth: { kind: "key", key: "k-1234567" },
    fetch: fetchFn,
    sleep: async () => undefined,
    random: () => 0,
  });
  return { calls, client };
}

// --- Types et attributs -----------------------------------------------------------------------------------------

test("normalizeType accepte les variantes usuelles et refuse le reste", () => {
  expect(normalizeType("double_elimination")).toBe("double_elimination");
  expect(normalizeType("Double-Elimination")).toBe("double_elimination");
  expect(normalizeType("double elimination")).toBe("double_elimination");
  expect(normalizeType("de")).toBe("double_elimination");
  expect(normalizeType("RR")).toBe("round_robin");
  expect(normalizeType("swiss")).toBe("swiss");
  expect(() => normalizeType("ladder")).toThrow(UsageError);
});

test("attributs de création : mots séparés par des espaces et options imbriquées de l'API v2.1", () => {
  const attributes = buildTournamentAttributes({
    name: " Cup ",
    type: "double_elimination",
    game: "Street Fighter 6",
    url: "cup_2026",
    private: true,
    startsAt: "2026-11-07T18:00:00+01:00",
    openSignup: true,
    signupCap: 32,
    checkInMinutes: 15,
    thirdPlace: true,
    grandFinals: "single match",
  });
  expect(attributes).toEqual({
    name: "Cup",
    tournament_type: "double elimination",
    game_name: "Street Fighter 6",
    url: "cup_2026",
    private: true,
    starts_at: "2026-11-07T17:00:00.000Z",
    registration_options: {
      open_signup: true,
      signup_cap: 32,
      check_in_duration: 15,
    },
    match_options: { consolation_matches_target_rank: 3 },
    double_elimination_options: { grand_finals_modifier: "single match" },
  });
  expect(
    buildTournamentAttributes({ name: "S", type: "swiss", swissRounds: 5 })
      .swiss_options,
  ).toEqual({ rounds: 5 });
  expect(
    buildTournamentAttributes({
      name: "G",
      type: "single_elimination",
      groupStage: { size: 4, advance: 2 },
    }),
  ).toMatchObject({
    group_stage_enabled: true,
    group_stage_options: {
      stage_type: "round robin",
      group_size: 4,
      participant_count_to_advance_per_group: 2,
    },
  });
});

test("validation : check-in multiple de 5, slug, options hors format, date", () => {
  expect(() =>
    buildTournamentAttributes({ name: "a", type: "swiss", checkInMinutes: 7 }),
  ).toThrow("multiple de 5");
  expect(() =>
    buildTournamentAttributes({
      name: "a",
      type: "swiss",
      url: "pas d'espace",
    }),
  ).toThrow("URL invalide");
  expect(() =>
    buildTournamentAttributes({
      name: "a",
      type: "single_elimination",
      grandFinals: "skip",
    }),
  ).toThrow("double élimination");
  expect(() =>
    buildTournamentAttributes({
      name: "a",
      type: "single_elimination",
      swissRounds: 3,
    }),
  ).toThrow("swiss");
  expect(() =>
    buildTournamentAttributes({
      name: "a",
      type: "swiss",
      startsAt: "demain-ish",
    }),
  ).toThrow("Date invalide");
  expect(() =>
    buildTournamentAttributes({ name: "  ", type: "swiss" }),
  ).toThrow(UsageError);
});

test("stateFor : transitions de poules uniquement pour start et finalize", () => {
  expect(stateFor("start", false)).toBe("start");
  expect(stateFor("start", true)).toBe("start_group_stage");
  expect(stateFor("finalize", true)).toBe("finalize_group_stage");
  expect(() => stateFor("process_checkin", true)).toThrow(UsageError);
});

// --- Participants -------------------------------------------------------------------------------------------------

test("lecture des participants : fichier, liste en ligne, commentaires, BOM, doublons", async () => {
  expect(namesFromInline("Alice, Bob ,, Carol")).toEqual([
    "Alice",
    "Bob",
    "Carol",
  ]);
  expect(
    namesFromLines("﻿Alice\r\n# commentaire\n\n Bob, le Brave \n"),
  ).toEqual(["Alice", "Bob, le Brave"]);

  const file = join(dir, "players.txt");
  await writeFile(file, "Alice\nBob\n# absent\nCarol\n");
  expect(await readParticipants(file)).toEqual(["Alice", "Bob", "Carol"]);
  expect(await readParticipants("x,y,z")).toEqual(["x", "y", "z"]);
  expect(() => assertUnique(["Alice", "alice"])).toThrow("en double");
  await expect(readParticipants(dir)).rejects.toThrow("dossier");
});

test("--seed-by : ordre du fichier ou notes décroissantes, noms inconnus signalés, non listés à la fin", () => {
  expect(readSeedFile("Carol\nAlice\nBob\n")).toEqual([
    "Carol",
    "Alice",
    "Bob",
  ]);
  expect(readSeedFile("Alice;1500\nBob;1800\nCarol,1650\nDan\t1200\n")).toEqual(
    ["Bob", "Carol", "Alice", "Dan"],
  );
  expect(() => readSeedFile("Alice;1500\nBob\n")).toThrow("mélange");

  const { entries, unknown } = seedBy(
    ["Alice", "Bob", "Carol", "Dan"],
    ["carol", "Zoe", "Bob"],
  );
  expect(entries).toEqual([
    { name: "Carol", seed: 1 },
    { name: "Bob", seed: 2 },
    { name: "Alice", seed: 3 },
    { name: "Dan", seed: 4 },
  ]);
  expect(unknown).toEqual(["Zoe"]);
});

test("shuffleSeeds : permutation complète, graines 1..n, déterministe avec un générateur fixe", () => {
  const names = ["a", "b", "c", "d", "e"];
  const once = shuffleSeeds(names, () => 0);
  expect(once.map((e) => e.seed)).toEqual([1, 2, 3, 4, 5]);
  expect(once.map((e) => e.name).toSorted()).toEqual(names);
  expect(shuffleSeeds(names, () => 0)).toEqual(once);
  let n = 0;
  const pseudo = () => ((n = (n * 7 + 3) % 11), n / 11);
  expect(new Set(shuffleSeeds(names, pseudo).map((e) => e.name)).size).toBe(5);
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});

test("addParticipants découpe par lots de 20 et transmet seed et misc", async () => {
  let id = 100;
  const { calls, client } = api((call) => ({
    data: (call.body.data.attributes.participants as { name: string }[]).map(
      (p) => ({
        id: String(id++),
        attributes: { name: p.name },
      }),
    ),
  }));
  const entries = Array.from({ length: 45 }, (_, i) => ({
    name: `p${i}`,
    seed: i + 1,
    ...(i === 0 ? { misc: "discord:1" } : {}),
  }));
  const created = await addParticipants(client, "7", entries);

  expect(created).toHaveLength(45);
  expect(calls.map((c) => c.body.data.attributes.participants.length)).toEqual([
    20, 20, 5,
  ]);
  expect(
    calls.every(
      (c) =>
        c.method === "POST" &&
        c.path === "/tournaments/7/participants/bulk_add",
    ),
  ).toBe(true);
  expect(calls[0]!.body.data.type).toBe("Participants");
  expect(calls[0]!.body.data.attributes.participants[0]).toEqual({
    name: "p0",
    seed: 1,
    misc: "discord:1",
  });
});

test("createTournamentFlow : création, participants par lots puis démarrage ; poules = start_group_stage", async () => {
  const { calls, client } = api((call) => {
    if (call.path === "/tournaments")
      return {
        data: {
          id: "55",
          type: "tournament",
          attributes: { ...call.body.data.attributes, state: "pending" },
        },
      };
    if (call.path.endsWith("/change_state"))
      return { data: { id: "55", attributes: { state: "underway" } } };
    return { data: [] };
  });
  const result = await createTournamentFlow(
    client,
    { name: "Cup", type: "single_elimination", url: "cup" },
    [{ name: "a" }, { name: "b" }],
    { start: true },
  );
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    "POST /tournaments",
    "POST /tournaments/55/participants/bulk_add",
    "PUT /tournaments/55/change_state",
  ]);
  expect(calls[2]!.body.data.attributes.state).toBe("start");
  expect(result.tournament).toMatchObject({
    id: "55",
    url: "cup",
    bracketUrl: "https://challonge.com/cup",
  });
  expect(result.state).toBe("underway");

  const groups = api(() => ({
    data: { id: "56", attributes: { url: "g", state: "pending" } },
  }));
  await createTournamentFlow(
    groups.client,
    { name: "G", type: "single_elimination", groupStage: {} },
    [],
    { start: true },
  );
  expect(groups.calls.at(-1)!.body.data.attributes.state).toBe(
    "start_group_stage",
  );
});

// --- Scores -------------------------------------------------------------------------------------------------------

test("parseScore : une manche, plusieurs manches, séparateurs variés, égalités", () => {
  expect(parseScore("2-1")).toMatchObject({ set1: "2", set2: "1", leader: 0 });
  expect(parseScore("2 : 3")).toMatchObject({
    set1: "2",
    set2: "3",
    leader: 1,
  });
  const bo3 = parseScore("3-1,2-4,5-0");
  expect(bo3).toMatchObject({ set1: "3,2,5", set2: "1,4,0", leader: 0 });
  // Une manche chacun et 5 points partout : aucun joueur en tête, le gagnant doit être désigné.
  expect(parseScore("3-1 2-4").leader).toBeUndefined();
  expect(parseScore("3-1 2-5").leader).toBe(1);
  expect(parseScore("1-1").leader).toBeUndefined();
  expect(() => parseScore("deux-un")).toThrow(UsageError);
  expect(() => parseScore("")).toThrow("Score vide");
});

function matchesApi(extra: Record<string, unknown> = {}) {
  const open = {
    id: "8001",
    attributes: {
      identifier: "A",
      state: "open",
      relationships: {
        player1: { data: { id: "111" } },
        player2: { data: { id: "222" } },
      },
      ...extra,
    },
  };
  return api((call) => {
    if (call.method === "PUT")
      return { data: { id: "8001", attributes: { state: "complete" } } };
    if (call.path === "/tournaments/9/matches")
      return { data: call.query.get("state") === "open" ? [open] : [open] };
    if (call.path === "/tournaments/9/matches/12345678")
      return { data: { ...open, id: "12345678" } };
    if (call.path === "/tournaments/9/participants") {
      return {
        data: [
          { id: "111", attributes: { name: "Alice" } },
          { id: "222", attributes: { name: "Bob" } },
        ],
      };
    }
    return { data: [] };
  });
}

test("reportMatch : identifiant de bracket -> recherche parmi les matchs ouverts puis PUT avec advancing sur le gagnant", async () => {
  const { calls, client } = matchesApi();
  const result = await reportMatch(client, "9", "a", "2-1");
  expect(
    calls.map(
      (c) =>
        `${c.method} ${c.path}${c.query.get("state") ? `?state=${c.query.get("state")}` : ""}`,
    ),
  ).toEqual([
    "GET /tournaments/9/matches?state=open",
    "PUT /tournaments/9/matches/8001",
  ]);
  expect(calls[1]!.body).toEqual({
    data: {
      type: "match",
      attributes: {
        match: [
          { participant_id: "111", score_set: "2", advancing: true },
          { participant_id: "222", score_set: "1" },
        ],
      },
    },
  });
  expect(result).toMatchObject({
    matchId: "8001",
    identifier: "A",
    winnerId: "111",
    tie: false,
  });
});

test("reportMatch : ID numérique -> GET direct, victoire du joueur 2 par nom (une lecture des participants)", async () => {
  const { calls, client } = matchesApi();
  const result = await reportMatch(client, "9", "12345678", "1-1", {
    winner: "bob",
  });
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    "GET /tournaments/9/matches/12345678",
    "GET /tournaments/9/participants",
    "PUT /tournaments/9/matches/12345678",
  ]);
  expect(result.winnerId).toBe("222");
  const entries = calls[2]!.body.data.attributes.match;
  expect(entries[1]).toEqual({
    participant_id: "222",
    score_set: "1",
    advancing: true,
  });
});

test("reportMatch : égalité sans gagnant refusée ; --tie envoie tie sans advancing ; gagnant contradictoire refusé sauf --force", async () => {
  const noWinner = matchesApi();
  await expect(reportMatch(noWinner.client, "9", "A", "1-1")).rejects.toThrow(
    "Score à égalité",
  );
  expect(noWinner.calls.some((c) => c.method === "PUT")).toBe(false);

  const tie = matchesApi();
  await reportMatch(tie.client, "9", "A", "2-2", { tie: true });
  const put = tie.calls.find((c) => c.method === "PUT")!;
  expect(put.body.data.attributes.tie).toBe(true);
  expect(JSON.stringify(put.body)).not.toContain("advancing");

  await expect(
    reportMatch(matchesApi().client, "9", "A", "2-1", { tie: true }),
  ).rejects.toThrow("pas égaux");
  await expect(
    reportMatch(matchesApi().client, "9", "A", "2-1", { winner: "2" }),
  ).rejects.toThrow("score le plus bas");
  const forced = matchesApi();
  expect(
    (
      await reportMatch(forced.client, "9", "A", "2-1", {
        winner: "2",
        force: true,
      })
    ).winnerId,
  ).toBe("222");
  await expect(
    reportMatch(matchesApi().client, "9", "A", "2-1", {
      winner: "1",
      tie: true,
    }),
  ).rejects.toThrow("s'excluent");
});

test("reportMatch : match en attente refusé ; match introuvable explicite", async () => {
  await expect(
    reportMatch(matchesApi({ state: "pending" }).client, "9", "A", "2-1"),
  ).rejects.toThrow("pas encore jouable");
  await expect(findMatch(matchesApi().client, "9", "Z")).rejects.toThrow(
    "introuvable",
  );
});

test("reportMatch en dry-run : plan avec recherche puis envoi, sans appel réseau", async () => {
  const plan: string[] = [];
  const client = new ChallongeClient({
    dryRun: true,
    onPlan: (p) => plan.push(`${p.method} ${new URL(p.url).pathname}`),
  });
  const result = await reportMatch(client, "TOURNAMENT_ID", "A", "3-1", {});
  expect(plan).toEqual([
    "GET /v2.1/tournaments/TOURNAMENT_ID/matches",
    "PUT /v2.1/tournaments/TOURNAMENT_ID/matches/MATCH_ID",
  ]);
  expect(result.winnerId).toBe("PLAYER1_ID");
});

// --- Configuration et état -------------------------------------------------------------------------------------

test("configuration : les variables d'environnement l'emportent sur challonge.json", async () => {
  const cfgDir = join(dir, "cfg");
  await Bun.write(
    join(cfgDir, "challonge.json"),
    JSON.stringify({
      apiKey: "file-key-1234",
      communityId: "asso",
      game: "SF6",
      discord: { appId: "42", organiserRoleId: "7", batchRegistrations: true },
    }),
  );
  const fromFile = await loadConfig({}, cfgDir);
  expect(fromFile).toMatchObject({
    apiKey: "file-key-1234",
    communityId: "asso",
    game: "SF6",
  });
  expect(fromFile.discord).toMatchObject({
    appId: "42",
    organiserRoleId: "7",
    batchRegistrations: true,
  });

  const merged = await loadConfig(
    {
      CHALLONGE_API_KEY: "env-key-9999",
      DISCORD_TOKEN: "dtok-1234",
      ORGANISER_ROLE_ID: "99",
    },
    cfgDir,
  );
  expect(merged.apiKey).toBe("env-key-9999");
  expect(merged.discord).toMatchObject({
    token: "dtok-1234",
    organiserRoleId: "99",
    appId: "42",
  });
  expect(secretsOf(merged)).toEqual(["env-key-9999", "dtok-1234"]);
});

test("configuration : fichier absent toléré, JSON invalide et clé manquante signalés sans fuite", async () => {
  const empty = await loadConfig({}, join(dir, "nulle-part"));
  expect(empty.apiKey).toBeUndefined();
  expect(() => authOf(empty)).toThrow("CHALLONGE_API_KEY");
  expect(authOf({ ...empty, apiKey: "k-abcdefg" })).toEqual({
    kind: "key",
    key: "k-abcdefg",
  });
  expect(
    authOf({ ...empty, apiKey: "k-abcdefg", oauthToken: "tok-xyz" }),
  ).toEqual({
    kind: "oauth",
    token: "tok-xyz",
  });

  const bad = join(dir, "bad");
  await Bun.write(join(bad, "challonge.json"), "{ pas du json");
  await expect(loadConfig({}, bad)).rejects.toThrow("pas du JSON valide");
  const wrong = join(dir, "wrong");
  await Bun.write(
    join(wrong, "challonge.json"),
    JSON.stringify({ apiKey: 12 }),
  );
  await expect(loadConfig({}, wrong)).rejects.toThrow("apiKey");
});

test("StateStore : mises à jour concurrentes sérialisées, écriture atomique, fichier corrompu signalé", async () => {
  const path = join(dir, "state", "challonge-state.json");
  const store = new StateStore(path);
  expect((await store.read()).guilds).toEqual({});

  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      store.update((state) => {
        (state.players["t1"] ??= {})[`u${i}`] = {
          participantId: String(i),
          name: `n${i}`,
        };
      }),
    ),
  );
  const state = await store.read();
  expect(Object.keys(state.players["t1"]!)).toHaveLength(25);
  expect(await readdir(join(dir, "state"))).toEqual(["challonge-state.json"]);

  await writeFile(path, "{ corrompu");
  await expect(store.read()).rejects.toThrow("Fichier d'état illisible");
});
