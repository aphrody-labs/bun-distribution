import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registry } from "../../src/creator/commands/index.ts";
import { runChallonge } from "../../src/creator/commands/challonge.ts";
import type { Fetch } from "../../src/creator/commands/challonge/http.ts";
import type { Io } from "../../src/creator/commands/challonge/io.ts";
import { StateStore } from "../../src/creator/commands/challonge/state.ts";
import { UsageError } from "../../src/shared/args.ts";

const KEY = "sk-live-0123456789abcdef";
const WEBHOOK = "https://discord.com/api/webhooks/123456789/WEBHOOK-TOKEN_abc123";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ck-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body?: any;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Faux Challonge v2.1 + faux webhook Discord ; `override` permet d'injecter des erreurs. */
function harness(
  options: {
    override?: (call: Call) => Response | undefined;
    env?: Record<string, string | undefined>;
    configDir?: string;
  } = {},
) {
  const calls: Call[] = [];
  let participantId = 5000;
  const fetchFn: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const forced = options.override?.(call);
    if (forced) return forced;
    if (url.hostname === "discord.com") return new Response(null, { status: 204 });
    const path = url.pathname.replace("/v2.1", "");
    if (path === "/tournaments" && call.method === "POST") {
      const attributes = call.body.data.attributes;
      return json(
        {
          data: {
            id: "9001",
            type: "tournament",
            attributes: {
              ...attributes,
              url: attributes.url ?? "gen4242",
              state: "pending",
            },
          },
        },
        201,
      );
    }
    if (path === "/tournaments" && call.method === "GET") {
      return json({
        data: [
          {
            id: "9001",
            attributes: {
              name: "Cup",
              url: "cup",
              state: "pending",
              tournament_type: "double elimination",
            },
          },
        ],
      });
    }
    if (path.endsWith("/participants/bulk_add")) {
      return json({
        data: call.body.data.attributes.participants.map((p: { name: string }) => ({
          id: String(participantId++),
          type: "participant",
          attributes: { name: p.name },
        })),
      });
    }
    if (path.endsWith("/participants")) {
      return json({
        data: [
          { id: "111", attributes: { name: "Alice" } },
          { id: "222", attributes: { name: "Bob" } },
        ],
      });
    }
    if (path.endsWith("/change_state"))
      return json({
        data: {
          id: "9001",
          attributes: {
            state: call.body.data.attributes.state === "start" ? "underway" : "complete",
          },
        },
      });
    if (path.endsWith("/randomize")) return json({ data: [] });
    if (/\/matches\/\d+$/.test(path) && call.method === "PUT")
      return json({ data: { id: "8001", attributes: { state: "complete" } } });
    if (path.endsWith("/matches")) {
      return json({
        data: [
          {
            id: "8001",
            attributes: {
              identifier: "A",
              round: 1,
              state: "open",
              scores: "",
              relationships: {
                player1: { data: { id: "111" } },
                player2: { data: { id: "222" } },
              },
            },
          },
        ],
      });
    }
    if (/\/tournaments\/\w+$/.test(path))
      return json({
        data: {
          id: "9001",
          attributes: { name: "Cup", url: "cup", state: "underway" },
        },
      });
    return json({ errors: [{ status: 404, detail: "not found" }] }, 404);
  };
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: {
      CREATOR_KIT_CONFIG_DIR: options.configDir ?? dir,
      CHALLONGE_API_KEY: KEY,
      ...options.env,
    },
    fetch: fetchFn,
    sleep: async () => undefined,
    random: () => 0,
    out: line => out.push(line),
    err: line => err.push(line),
  };
  return { io, calls, out, err, text: () => [...out, ...err].join("\n") };
}

const paths = (calls: Call[]) => calls.map(c => `${c.method} ${c.url.hostname}${c.url.pathname}`);

test("le registre expose la commande challonge", async () => {
  const { default: command } = await registry.challonge!();
  expect(command.name).toBe("challonge");
  expect(typeof command.run).toBe("function");
});

test("aide : sans argument et par sous-commande", async () => {
  const h = harness();
  expect(await runChallonge([], h.io)).toBe(0);
  expect(h.out.join("\n")).toContain("Sous-commandes");
  const create = harness();
  expect(await runChallonge(["create", "--help"], create.io)).toBe(0);
  expect(create.out.join("\n")).toContain("--participants");
  expect(create.calls).toHaveLength(0);
  await expect(runChallonge(["inconnue"], harness().io)).rejects.toThrow(UsageError);
});

test("create : tournoi + participants (fichier) + démarrage + annonce Discord ; la clé n'est jamais affichée", async () => {
  const cfg = await mkdtemp(join(dir, "c1-"));
  const file = join(cfg, "players.txt");
  await writeFile(file, ["Alice", "Bob", "Carol", "Dan"].join("\n"));
  const h = harness({ configDir: cfg });
  const code = await runChallonge(
    [
      "create",
      "--name",
      "Coupe d'été",
      "--game",
      "Guilty Gear Strive",
      "--type",
      "double_elimination",
      "--participants",
      file,
      "--url",
      "coupe_ete",
      "--start",
      "--announce",
      WEBHOOK,
    ],
    h.io,
  );
  expect(code).toBe(0);

  expect(paths(h.calls)).toEqual([
    "POST api.challonge.com/v2.1/tournaments",
    "POST api.challonge.com/v2.1/tournaments/9001/participants/bulk_add",
    "PUT api.challonge.com/v2.1/tournaments/9001/change_state",
    "POST discord.com/api/webhooks/123456789/WEBHOOK-TOKEN_abc123",
  ]);
  expect(h.calls[0]!.body.data.attributes).toEqual({
    name: "Coupe d'été",
    tournament_type: "double elimination",
    game_name: "Guilty Gear Strive",
    url: "coupe_ete",
  });
  expect(h.calls[1]!.body.data.attributes.participants).toEqual([
    { name: "Alice" },
    { name: "Bob" },
    { name: "Carol" },
    { name: "Dan" },
  ]);
  expect(h.calls[2]!.body.data.attributes.state).toBe("start");
  const announce = h.calls[3]!.body;
  expect(announce.embeds[0]).toMatchObject({
    title: "Coupe d'été",
    url: "https://challonge.com/coupe_ete",
  });
  expect(announce.allowed_mentions).toEqual({ parse: [] });
  expect(h.calls[3]!.headers.get("authorization")).toBeNull();

  const text = h.text();
  expect(text).toContain("https://challonge.com/coupe_ete");
  expect(text).toContain("Requêtes API émises : 3.");
  expect(text).not.toContain(KEY);
  expect(text).not.toContain("WEBHOOK-TOKEN");

  // Le dernier tournoi est mémorisé : les commandes suivantes n'ont plus besoin de --tournament.
  const state = await new StateStore(join(cfg, "challonge-state.json")).read();
  expect(state.lastTournament).toMatchObject({ id: "9001", url: "coupe_ete" });
});

test("create --shuffle : têtes de série explicites envoyées dans la même requête bulk_add", async () => {
  const h = harness({ configDir: await mkdtemp(join(dir, "c2-")) });
  await runChallonge(["create", "--name", "Cup", "--participants", "a,b,c", "--shuffle"], h.io);
  const sent = h.calls[1]!.body.data.attributes.participants as {
    name: string;
    seed: number;
  }[];
  expect(sent.map(p => p.seed)).toEqual([1, 2, 3]);
  expect(sent.map(p => p.name).toSorted()).toEqual(["a", "b", "c"]);
  expect(h.calls).toHaveLength(2); // pas de requête randomize en plus
});

test("create --seed-by : seeding depuis un fichier de notes ; --shuffle et --seed-by incompatibles", async () => {
  const cfg = await mkdtemp(join(dir, "c3-"));
  const ranking = join(cfg, "ranking.csv");
  await writeFile(ranking, "Alice;1500\nBob;1800\nCarol;1650\n");
  const h = harness({ configDir: cfg });
  await runChallonge(["create", "--name", "Cup", "--seed-by", ranking], h.io);
  expect(h.calls[1]!.body.data.attributes.participants).toEqual([
    { name: "Bob", seed: 1 },
    { name: "Carol", seed: 2 },
    { name: "Alice", seed: 3 },
  ]);
  await expect(
    runChallonge(["create", "--name", "x", "--participants", "a,b", "--shuffle", "--seed-by", ranking], harness().io),
  ).rejects.toThrow("s'excluent");
});

test("create --dry-run : plan complet, aucune requête, aucune clé nécessaire, jeton de webhook masqué", async () => {
  const h = harness({
    env: { CHALLONGE_API_KEY: undefined },
    configDir: await mkdtemp(join(dir, "c4-")),
  });
  const code = await runChallonge(
    ["create", "--name", "Cup", "--participants", "a,b,c", "--start", "--announce", WEBHOOK, "--dry-run"],
    h.io,
  );
  expect(code).toBe(0);
  expect(h.calls).toHaveLength(0);
  const text = h.text();
  expect(text).toContain("POST https://api.challonge.com/v2.1/tournaments");
  expect(text).toContain("POST https://api.challonge.com/v2.1/tournaments/TOURNAMENT_ID/participants/bulk_add");
  expect(text).toContain("PUT https://api.challonge.com/v2.1/tournaments/TOURNAMENT_ID/change_state");
  expect(text).toContain("/webhooks/123456789/***");
  expect(text).not.toContain("WEBHOOK-TOKEN");
  expect(text).toContain("Aucune requête envoyée.");
});

test("sans clé API : erreur d'usage explicite (hors dry-run)", async () => {
  const h = harness({
    env: { CHALLONGE_API_KEY: undefined },
    configDir: await mkdtemp(join(dir, "c5-")),
  });
  await expect(runChallonge(["create", "--name", "Cup"], h.io)).rejects.toThrow("CHALLONGE_API_KEY");
  expect(h.calls).toHaveLength(0);
});

test("401 : code 1, message français, la clé ne fuit ni sur stdout ni sur stderr", async () => {
  const h = harness({
    configDir: await mkdtemp(join(dir, "c6-")),
    override: () =>
      new Response(JSON.stringify({ errors: [{ status: 401, detail: `bad key ${KEY}` }] }), {
        status: 401,
      }),
  });
  expect(await runChallonge(["create", "--name", "Cup"], h.io)).toBe(1);
  expect(h.text()).toContain("Clé API refusée (401)");
  expect(h.text()).not.toContain(KEY);
});

test("422 et 429 : messages français ; 429 réessayé avec pause puis abandon", async () => {
  const invalid = harness({
    configDir: await mkdtemp(join(dir, "c7-")),
    override: () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              status: 422,
              detail: "Name can't be blank",
              source: { pointer: "/data/attributes/name" },
            },
          ],
        }),
        { status: 422 },
      ),
  });
  expect(await runChallonge(["create", "--name", "Cup"], invalid.io)).toBe(1);
  expect(invalid.err.join("\n")).toContain("Données refusées (422)");
  expect(invalid.err.join("\n")).toContain("name : Name can't be blank");

  const limited = harness({
    configDir: await mkdtemp(join(dir, "c8-")),
    override: () => new Response("{}", { status: 429 }),
  });
  expect(await runChallonge(["create", "--name", "Cup"], limited.io)).toBe(1);
  expect(limited.err.join("\n")).toContain("Limite de requêtes atteinte (429)");
  expect(limited.calls).toHaveLength(5); // 1 essai + 4 reprises
  expect(limited.err.join("\n")).toContain("nouvelle tentative");
});

test("annonce Discord en échec : le tournoi reste créé, simple avertissement", async () => {
  const h = harness({
    configDir: await mkdtemp(join(dir, "c9-")),
    override: call =>
      call.url.hostname === "discord.com"
        ? new Response(JSON.stringify({ message: "Unknown Webhook", code: 10015 }), { status: 404 })
        : undefined,
  });
  expect(await runChallonge(["create", "--name", "Cup", "--announce", WEBHOOK], h.io)).toBe(0);
  expect(h.err.join("\n")).toContain("annonce Discord non envoyée");
  expect(h.text()).not.toContain("WEBHOOK-TOKEN");
});

test("webhook invalide refusé avant tout appel", async () => {
  const h = harness({ configDir: await mkdtemp(join(dir, "c10-")) });
  await expect(
    runChallonge(["create", "--name", "Cup", "--announce", "https://evil.example/hook"], h.io),
  ).rejects.toThrow("URL de webhook invalide");
  expect(h.calls).toHaveLength(0);
});

test("add, start, finalize, randomize, checkin : requêtes attendues sur le dernier tournoi", async () => {
  const cfg = await mkdtemp(join(dir, "c11-"));
  await new StateStore(join(cfg, "challonge-state.json")).update(s => {
    s.lastTournament = { id: "9001", url: "cup" };
  });
  const h = harness({ configDir: cfg });
  await runChallonge(["add", "Zoe", "Yan"], h.io);
  await runChallonge(["start", "--shuffle"], h.io);
  await runChallonge(["checkin"], h.io);
  await runChallonge(["checkin", "--abort"], h.io);
  await runChallonge(["finalize"], h.io);
  await runChallonge(["randomize"], h.io);
  expect(paths(h.calls).map(p => p.replace("api.challonge.com/v2.1/tournaments/9001", ""))).toEqual([
    "POST /participants/bulk_add",
    "PUT /participants/randomize",
    "PUT /change_state",
    "PUT /change_state",
    "PUT /change_state",
    "PUT /change_state",
    "PUT /participants/randomize",
  ]);
  expect(h.calls.filter(c => c.url.pathname.endsWith("change_state")).map(c => c.body.data.attributes.state)).toEqual([
    "start",
    "process_checkin",
    "abort_checkin",
    "finalize",
  ]);
  expect(h.calls[0]!.body.data.attributes.participants).toEqual([{ name: "Zoe" }, { name: "Yan" }]);
});

test("sans tournoi connu : erreur d'usage ; --tournament accepte une URL Challonge", async () => {
  const empty = harness({ configDir: await mkdtemp(join(dir, "c12-")) });
  await expect(runChallonge(["start"], empty.io)).rejects.toThrow("Aucun tournoi indiqué");
  const h = harness({ configDir: await mkdtemp(join(dir, "c13-")) });
  await runChallonge(["finalize", "-t", "https://challonge.com/coupe_ete"], h.io);
  expect(h.calls[0]!.url.pathname).toBe("/v2.1/tournaments/coupe_ete/change_state");
});

test("report : retrouve le match par sa lettre et saisit le score", async () => {
  const h = harness({ configDir: await mkdtemp(join(dir, "c14-")) });
  expect(await runChallonge(["report", "-t", "9001", "A", "2-1"], h.io)).toBe(0);
  expect(paths(h.calls)).toEqual([
    "GET api.challonge.com/v2.1/tournaments/9001/matches",
    "PUT api.challonge.com/v2.1/tournaments/9001/matches/8001",
  ]);
  expect(h.out.join("\n")).toContain("Score enregistré : match A 2-1");
  await expect(runChallonge(["report", "-t", "9001", "A"], harness().io)).rejects.toThrow("Usage : report");
});

test("matches, list et show : sorties lisibles et JSON", async () => {
  const cfg = await mkdtemp(join(dir, "c15-"));
  const h = harness({ configDir: cfg });
  await runChallonge(["matches", "-t", "9001", "--state", "open"], h.io);
  expect(h.out.join("\n")).toContain("A   tour 1");
  expect(h.out.join("\n")).toContain("Alice vs Bob");

  const l = harness({ configDir: cfg });
  await runChallonge(["list", "--state", "pending"], l.io);
  expect(l.calls[0]!.url.searchParams.get("state")).toBe("pending");
  expect(l.out.join("\n")).toContain("https://challonge.com/cup");

  const s = harness({ configDir: cfg });
  await runChallonge(["show", "-t", "9001", "--json"], s.io);
  expect(JSON.parse(s.out[0]!)).toEqual({
    id: "9001",
    name: "Cup",
    state: "underway",
    bracket: "https://challonge.com/cup",
  });

  await expect(runChallonge(["list", "--state", "bizarre"], harness().io)).rejects.toThrow("--state attend");
});

test("--dry-run sur report/start/list : plan seul", async () => {
  await Promise.all(
    [["report", "A", "2-0"], ["start"], ["list"], ["show"]].map(async argv => {
      const h = harness({
        env: { CHALLONGE_API_KEY: undefined },
        configDir: await mkdtemp(join(dir, "c16-")),
      });
      expect(await runChallonge([...argv, "--dry-run"], h.io)).toBe(0);
      expect(h.calls).toHaveLength(0);
      expect(h.out.join("\n")).toContain("Plan de requêtes");
    }),
  );
});

test("bot --dry-run : définition des commandes slash, sans réseau ni identifiants", async () => {
  const h = harness({
    env: { CHALLONGE_API_KEY: undefined },
    configDir: await mkdtemp(join(dir, "c17-")),
  });
  expect(await runChallonge(["bot", "--dry-run"], h.io)).toBe(0);
  expect(h.calls).toHaveLength(0);
  const printed = h.out.join("\n");
  for (const name of ["creer", "inscrire", "demarrer", "score", "bracket"])
    expect(printed).toContain(`"name": "${name}"`);
});

test("bot sans variables Discord : erreur d'usage listant les variables manquantes", async () => {
  const h = harness({ configDir: await mkdtemp(join(dir, "c18-")) });
  await expect(runChallonge(["bot"], h.io)).rejects.toThrow("DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID");
});
