import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  botConfigOf,
  type BotConfig,
  type BotContext,
  handleInteraction,
  isOrganiser,
  runBot,
} from "../../src/creator/commands/challonge/bot.ts";
import { commandDefinitions } from "../../src/creator/commands/challonge/bot-commands.ts";
import { ChallongeClient } from "../../src/creator/commands/challonge/client.ts";
import type { ChallongeConfig } from "../../src/creator/commands/challonge/config.ts";
import {
  DiscordError,
  DiscordRest,
  type DiscordMember,
  type Interaction,
  assertWebhookUrl,
  redactWebhook,
} from "../../src/creator/commands/challonge/discord.ts";
import type { Fetch } from "../../src/creator/commands/challonge/http.ts";
import { StateStore } from "../../src/creator/commands/challonge/state.ts";
import { UsageError } from "../../src/shared/args.ts";

const GUILD = "G1";
const APP = "A1";
const ROLE = "R-ORGA";
const TOKEN = "discord-bot-token-SECRET.xyz";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ck-bot-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Call {
  method: string;
  host: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body?: any;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakes(overrides: { challonge?: (call: Call) => Response | undefined } = {}) {
  const calls: Call[] = [];
  let participantId = 7000;
  let tournamentSeq = 0;
  const fetchFn: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      host: url.hostname,
      path: url.pathname.replace(/^\/api\/v10/, "").replace(/^\/v2\.1/, ""),
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (call.host === "discord.com") {
      if (call.path.startsWith("/applications/") && call.method === "PUT")
        return json((call.body as object[]).map((c, i) => Object.assign({ id: String(i) }, c)));
      if (call.path === "/gateway/bot")
        return json({
          url: "wss://gateway.invalid",
          session_start_limit: { remaining: 999, total: 1000, reset_after: 1, max_concurrency: 1 },
        });
      return call.method === "POST" && !call.path.includes("/callback")
        ? json({ id: "m1" })
        : new Response(null, { status: 204 });
    }
    const forced = overrides.challonge?.(call);
    if (forced) return forced;
    if (call.path === "/tournaments" && call.method === "POST") {
      tournamentSeq += 1;
      const attributes = call.body.data.attributes;
      return json(
        {
          data: {
            id: `90${tournamentSeq}`,
            type: "tournament",
            attributes: {
              ...attributes,
              url: attributes.url ?? `gen${tournamentSeq}`,
              state: "pending",
            },
          },
        },
        201,
      );
    }
    if (call.path.endsWith("/participants/bulk_add")) {
      return json({
        data: call.body.data.attributes.participants.map((p: any) => ({
          id: String(participantId++),
          attributes: { name: p.name, misc: p.misc ?? null },
        })),
      });
    }
    if (call.path.endsWith("/participants") && call.method === "POST") {
      return json({
        data: {
          id: String(participantId++),
          type: "participant",
          attributes: { name: call.body.data.attributes.name },
        },
      });
    }
    if (call.path.endsWith("/randomize")) return json({ data: [] });
    if (call.path.endsWith("/change_state"))
      return json({ data: { id: "901", attributes: { state: "underway" } } });
    if (call.method === "PUT" && /\/matches\/\d+$/.test(call.path))
      return json({ data: { id: "8001", attributes: { state: "complete" } } });
    if (call.path.endsWith("/matches")) {
      return json({
        data: [
          {
            id: "8001",
            attributes: {
              identifier: "A",
              state: "open",
              relationships: {
                player1: { data: { id: "7000" } },
                player2: { data: { id: "7001" } },
              },
            },
          },
        ],
      });
    }
    return json({ errors: [{ status: 404, detail: "not found" }] }, 404);
  };
  return { calls, fetchFn };
}

async function context(
  options: {
    batch?: boolean;
    role?: string | null;
    challonge?: (call: Call) => Response | undefined;
  } = {},
) {
  const f = fakes({ challonge: options.challonge });
  const config: BotConfig = {
    guildId: GUILD,
    organiserRoleId: options.role === null ? undefined : (options.role ?? ROLE),
    batchRegistrations: options.batch ?? false,
    defaultGame: "Guilty Gear Strive",
  };
  const logs: string[] = [];
  const store = new StateStore(join(await mkdtemp(join(dir, "s-")), "state.json"));
  const ctx: BotContext = {
    config,
    challonge: new ChallongeClient({
      auth: { kind: "key", key: "ck-key-123456" },
      fetch: f.fetchFn,
      sleep: async () => undefined,
      random: () => 0,
    }),
    discord: new DiscordRest({
      token: TOKEN,
      appId: APP,
      fetch: f.fetchFn,
      sleep: async () => undefined,
      random: () => 0,
    }),
    state: store,
    log: (m) => logs.push(m),
    random: () => 0,
    inflight: new Set(),
  };
  return { ctx, calls: f.calls, logs, store };
}

let counter = 0;
const organiser: DiscordMember = {
  user: { id: "U-ORGA", username: "orga" },
  roles: [ROLE],
  permissions: "0",
};
const member = (id: string, username: string, nick?: string): DiscordMember => ({
  user: { id, username, global_name: username },
  nick,
  roles: [],
  permissions: "0",
});

function command(
  sub: string,
  options: unknown[] = [],
  who: DiscordMember = organiser,
  guild = GUILD,
): Interaction {
  counter += 1;
  return {
    id: `int-${counter}`,
    application_id: APP,
    type: 2,
    token: `itok-${counter}`,
    guild_id: guild,
    channel_id: "C1",
    member: who,
    data: { name: "tournoi", options: [{ type: 1, name: sub, options: options as never }] },
  };
}

function button(tournamentId: string, who: DiscordMember): Interaction {
  counter += 1;
  return {
    id: `int-${counter}`,
    application_id: APP,
    type: 3,
    token: `itok-${counter}`,
    guild_id: GUILD,
    member: who,
    data: { custom_id: `tournoi:register:${tournamentId}`, component_type: 2 },
  };
}

const discordCalls = (calls: Call[]) => calls.filter((c) => c.host === "discord.com");
const challongeCalls = (calls: Call[]) => calls.filter((c) => c.host !== "discord.com");
const kind = (c: Call) =>
  c.path.endsWith("/callback")
    ? `callback:${c.body.type}`
    : c.path.endsWith("@original")
      ? "edit"
      : c.path.startsWith("/webhooks/")
        ? "followup"
        : c.path;

async function createTournament(c: Awaited<ReturnType<typeof context>>, name = "Coupe") {
  await handleInteraction(
    c.ctx,
    command("creer", [
      { type: 3, name: "nom", value: name },
      { type: 3, name: "url", value: "coupe" },
    ]),
  );
  c.calls.length = 0;
}

// --- Droits et définition des commandes ----------------------------------------------------------------------------

test("isOrganiser : rôle configuré, administrateur toujours, « Gérer le serveur » à défaut de rôle", () => {
  const withRole: BotConfig = { guildId: GUILD, organiserRoleId: ROLE, batchRegistrations: false };
  const noRole: BotConfig = { guildId: GUILD, batchRegistrations: false };
  expect(isOrganiser(withRole, organiser)).toBe(true);
  expect(isOrganiser(withRole, member("u", "x"))).toBe(false);
  expect(isOrganiser(withRole, { ...member("u", "x"), permissions: "8" })).toBe(true); // ADMINISTRATOR
  expect(isOrganiser(withRole, { ...member("u", "x"), permissions: "32" })).toBe(false); // MANAGE_GUILD ne suffit pas si un rôle est exigé
  expect(isOrganiser(noRole, { ...member("u", "x"), permissions: "32" })).toBe(true);
  expect(isOrganiser(noRole, member("u", "x"))).toBe(false);
  expect(isOrganiser(withRole, undefined)).toBe(false);
  expect(isOrganiser(withRole, { ...member("u", "x"), permissions: "n'importe quoi" })).toBe(false);
});

test("définition de /tournoi : noms, longueurs et ordre des options conformes aux règles Discord", () => {
  const [root] = commandDefinitions() as { name: string; description: string; options: any[] }[];
  expect(root!.name).toBe("tournoi");
  expect(root!.options.map((o) => o.name)).toEqual([
    "creer",
    "inscrire",
    "demarrer",
    "score",
    "terminer",
    "bracket",
  ]);
  const nameRule = /^[-_\p{L}\p{N}]{1,32}$/u;
  for (const sub of root!.options) {
    expect(sub.name).toMatch(nameRule);
    expect(sub.description.length).toBeGreaterThan(0);
    expect(sub.description.length).toBeLessThanOrEqual(100);
    expect((sub.options ?? []).length).toBeLessThanOrEqual(25);
    let optionalSeen = false;
    for (const option of sub.options ?? []) {
      expect(option.name).toMatch(nameRule);
      expect(option.name).toBe(option.name.toLowerCase());
      expect(option.description.length).toBeLessThanOrEqual(100);
      if (!option.required) optionalSeen = true;
      else expect(optionalSeen).toBe(false);
    }
  }
});

test("botConfigOf : variables manquantes listées, valeurs reprises", () => {
  const base = {
    discord: { batchRegistrations: false },
    dir: "x",
    warnings: [],
  } as ChallongeConfig;
  expect(() => botConfigOf(base)).toThrow(
    "DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID, CHALLONGE_API_KEY",
  );
  const ok = botConfigOf({
    ...base,
    apiKey: "k",
    game: "SF6",
    discord: {
      token: "t",
      appId: "a",
      guildId: "g",
      organiserRoleId: "r",
      batchRegistrations: true,
    },
  });
  expect(ok).toMatchObject({
    token: "t",
    appId: "a",
    bot: { guildId: "g", organiserRoleId: "r", batchRegistrations: true, defaultGame: "SF6" },
  });
});

// --- Commandes ---------------------------------------------------------------------------------------------------------

test("/tournoi creer : accusé éphémère AVANT l'appel Challonge, confirmation éphémère puis annonce publique avec bouton", async () => {
  const c = await context();
  await handleInteraction(
    c.ctx,
    command("creer", [
      { type: 3, name: "nom", value: "Coupe d'été" },
      { type: 3, name: "format", value: "double_elimination" },
      { type: 3, name: "url", value: "coupe_ete" },
    ]),
  );

  const order = c.calls.map((call) =>
    call.host === "discord.com" ? kind(call) : `challonge:${call.method} ${call.path}`,
  );
  expect(order).toEqual(["callback:5", "challonge:POST /tournaments", "edit", "followup"]);

  const [defer, , edit, followup] = c.calls;
  expect(defer!.body.data.flags).toBe(64);
  expect(defer!.headers.get("authorization")).toBeNull(); // le jeton d'interaction suffit : pas d'en-tête Bot
  expect(c.calls[1]!.body.data.attributes).toMatchObject({
    name: "Coupe d'été",
    tournament_type: "double elimination",
    game_name: "Guilty Gear Strive",
    url: "coupe_ete",
  });
  expect(edit!.method).toBe("PATCH");
  expect(edit!.path).toBe(`/webhooks/${APP}/itok-${counter}/messages/@original`);
  expect(edit!.body.content).toContain("https://challonge.com/coupe_ete");
  expect(edit!.body.flags).toBeUndefined(); // le caractère éphémère est fixé au defer
  expect(followup!.body.flags).toBeUndefined(); // annonce publique
  expect(followup!.body.embeds[0]).toMatchObject({
    title: "Coupe d'été",
    url: "https://challonge.com/coupe_ete",
  });
  expect(followup!.body.components[0].components[0]).toMatchObject({
    type: 2,
    style: 3,
    custom_id: "tournoi:register:901",
  });
  expect(followup!.body.allowed_mentions).toEqual({ parse: [] });

  const state = await c.store.read();
  expect(state.guilds[GUILD]!.tournament).toMatchObject({ id: "901", url: "coupe_ete" });
  expect(state.lastTournament?.id).toBe("901");
});

test("commandes d'organisateur : refusées immédiatement (éphémère) sans toucher Challonge", async () => {
  const c = await context();
  for (const sub of ["creer", "demarrer", "score", "terminer"]) {
    // oxlint-disable-next-line no-await-in-loop -- commandes d'organisateur séquentielles : chaque sous-commande suit la précédente
    await handleInteraction(
      c.ctx,
      command(sub, [{ type: 3, name: "nom", value: "x" }], member("U2", "joueur")),
    );
  }
  expect(challongeCalls(c.calls)).toHaveLength(0);
  expect(discordCalls(c.calls)).toHaveLength(4);
  for (const call of discordCalls(c.calls)) {
    expect(call.path.endsWith("/callback")).toBe(true);
    expect(call.body.type).toBe(4);
    expect(call.body.data.flags).toBe(64);
    expect(call.body.data.content).toContain("réservée aux organisateurs");
    expect(call.body.data.content).toContain(`<@&${ROLE}>`);
    expect(call.body.data.allowed_mentions).toEqual({ parse: [] });
  }
});

test("erreur Challonge 422 : message français éphémère, aucune annonce publique, rien d'enregistré", async () => {
  const c = await context({
    challonge: (call) =>
      call.path === "/tournaments"
        ? new Response(
            JSON.stringify({
              errors: [
                {
                  status: 422,
                  detail: "URL has already been taken",
                  source: { pointer: "/data/attributes/url" },
                },
              ],
            }),
            { status: 422 },
          )
        : undefined,
  });
  await handleInteraction(
    c.ctx,
    command("creer", [
      { type: 3, name: "nom", value: "Coupe" },
      { type: 3, name: "url", value: "pris" },
    ]),
  );
  expect(discordCalls(c.calls).map(kind)).toEqual(["callback:5", "edit"]);
  const edit = discordCalls(c.calls)[1]!;
  expect(edit.body.content).toContain("Données refusées (422)");
  expect(edit.body.content).toContain("déjà prise");
  expect((await c.store.read()).guilds).toEqual({});
});

test("saisies invalides : URL non conforme et format inconnu signalés en éphémère", async () => {
  const c = await context();
  await handleInteraction(
    c.ctx,
    command("creer", [
      { type: 3, name: "nom", value: "C" },
      { type: 3, name: "url", value: "pas valide!" },
    ]),
  );
  expect(discordCalls(c.calls).at(-1)!.body.content).toContain("URL invalide");
  expect(challongeCalls(c.calls)).toHaveLength(0);
});

test("/tournoi inscrire : participant créé avec misc discord:<id>, correspondance enregistrée, doublon refusé", async () => {
  const c = await context();
  await createTournament(c);
  await handleInteraction(c.ctx, command("inscrire", [], member("U1", "alice", "Alice la Rapide")));

  const create = challongeCalls(c.calls)[0]!;
  expect(create.path).toBe("/tournaments/901/participants");
  expect(create.body.data.attributes).toEqual({ name: "Alice la Rapide", misc: "discord:U1" });
  const edit = discordCalls(c.calls).find((x) => kind(x) === "edit")!;
  expect(edit.body.content).toContain("Inscrit·e sous « Alice la Rapide »");
  expect((await c.store.read()).players["901"]!["U1"]).toEqual({
    participantId: "7000",
    name: "Alice la Rapide",
  });

  c.calls.length = 0;
  await handleInteraction(c.ctx, command("inscrire", [], member("U1", "alice", "Alice la Rapide")));
  expect(challongeCalls(c.calls)).toHaveLength(0);
  expect(discordCalls(c.calls).find((x) => kind(x) === "edit")!.body.content).toContain(
    "déjà inscrit",
  );
});

test("inscription : pseudo choisi, nom déjà pris distingué par le nom d'utilisateur, double clic simultané ignoré", async () => {
  const c = await context();
  await createTournament(c);
  await handleInteraction(
    c.ctx,
    command("inscrire", [{ type: 3, name: "pseudo", value: "Ryu" }], member("U1", "alice")),
  );
  await handleInteraction(
    c.ctx,
    command("inscrire", [{ type: 3, name: "pseudo", value: "ryu" }], member("U2", "bob")),
  );
  const sent = challongeCalls(c.calls).map((x) => x.body.data.attributes.name);
  expect(sent).toEqual(["Ryu", "ryu (bob)"]);

  const race = await context();
  await createTournament(race);
  const user = member("U9", "zed");
  await Promise.all([
    handleInteraction(race.ctx, command("inscrire", [], user)),
    handleInteraction(race.ctx, command("inscrire", [], user)),
  ]);
  expect(challongeCalls(race.calls).filter((x) => x.method === "POST")).toHaveLength(1);
});

test("inscription sans tournoi : message clair ; bouton d'un ancien tournoi refusé ; bouton valide inscrit", async () => {
  const empty = await context();
  await handleInteraction(empty.ctx, command("inscrire", [], member("U1", "alice")));
  expect(discordCalls(empty.calls).find((x) => kind(x) === "edit")!.body.content).toContain(
    "Aucun tournoi en cours",
  );

  const c = await context();
  await createTournament(c);
  await handleInteraction(c.ctx, button("123", member("U1", "alice")));
  expect(discordCalls(c.calls).find((x) => kind(x) === "edit")!.body.content).toContain(
    "ancien tournoi",
  );
  expect(challongeCalls(c.calls)).toHaveLength(0);

  c.calls.length = 0;
  await handleInteraction(c.ctx, button("901", member("U1", "alice")));
  expect(discordCalls(c.calls)[0]!.body).toMatchObject({ type: 5, data: { flags: 64 } });
  expect(challongeCalls(c.calls)[0]!.body.data.attributes.misc).toBe("discord:U1");
});

test("/tournoi score : le joueur Discord désigné est converti en participant Challonge (advancing sur lui)", async () => {
  const c = await context();
  await createTournament(c);
  // Participants 7000 (Alice) et 7001 (Bob), correspondant aux joueurs du match A du faux serveur.
  await handleInteraction(c.ctx, command("inscrire", [], member("U1", "alice")));
  await handleInteraction(c.ctx, command("inscrire", [], member("U2", "bob")));
  c.calls.length = 0;

  await handleInteraction(
    c.ctx,
    command("score", [
      { type: 3, name: "match", value: "A" },
      { type: 3, name: "score", value: "1-1" },
      { type: 6, name: "gagnant", value: "U2" },
    ]),
  );
  const put = challongeCalls(c.calls).find((x) => x.method === "PUT")!;
  expect(put.path).toBe("/tournaments/901/matches/8001");
  expect(put.body.data.attributes.match).toEqual([
    { participant_id: "7000", score_set: "1" },
    { participant_id: "7001", score_set: "1", advancing: true },
  ]);
  const followup = discordCalls(c.calls).find((x) => kind(x) === "followup")!;
  expect(followup.body.content).toBe("Match A : alice 1-1 bob (gagnant : bob)");
  expect(followup.body.flags).toBeUndefined();

  // Égalité sans gagnant : erreur éphémère, aucun PUT.
  c.calls.length = 0;
  await handleInteraction(
    c.ctx,
    command("score", [
      { type: 3, name: "match", value: "A" },
      { type: 3, name: "score", value: "2-2" },
    ]),
  );
  expect(challongeCalls(c.calls).some((x) => x.method === "PUT")).toBe(false);
  expect(discordCalls(c.calls).find((x) => kind(x) === "edit")!.body.content).toContain(
    "Score à égalité",
  );

  // Joueur non inscrit via le bot.
  c.calls.length = 0;
  await handleInteraction(
    c.ctx,
    command("score", [
      { type: 3, name: "match", value: "A" },
      { type: 3, name: "score", value: "2-1" },
      { type: 6, name: "gagnant", value: "U-INCONNU" },
    ]),
  );
  expect(discordCalls(c.calls).find((x) => kind(x) === "edit")!.body.content).toContain(
    "pas inscrit via le bot",
  );
});

test("/tournoi demarrer : démarrage direct, ou randomize d'abord avec melanger ; annonce publique", async () => {
  const c = await context();
  await createTournament(c);
  await handleInteraction(c.ctx, command("demarrer", [{ type: 5, name: "melanger", value: true }]));
  expect(challongeCalls(c.calls).map((x) => `${x.method} ${x.path}`)).toEqual([
    "PUT /tournaments/901/participants/randomize",
    "PUT /tournaments/901/change_state",
  ]);
  expect(challongeCalls(c.calls)[1]!.body.data.attributes.state).toBe("start");
  expect(discordCalls(c.calls).map(kind)).toEqual(["callback:5", "edit", "followup"]);
  expect(discordCalls(c.calls)[2]!.body.content).toContain("est lancé");
});

test("inscriptions groupées : mises en attente, envoyées par lots de 20 (bulk_add) au démarrage, correspondances conservées", async () => {
  const c = await context({ batch: true });
  await createTournament(c);
  for (let i = 1; i <= 25; i += 1)
    // oxlint-disable-next-line no-await-in-loop -- inscriptions séquentielles : chaque écriture du magasin doit précéder la suivante (ordre des correspondances)
    await handleInteraction(c.ctx, command("inscrire", [], member(`U${i}`, `joueur${i}`)));
  expect(challongeCalls(c.calls)).toHaveLength(0);
  expect(Object.keys((await c.store.read()).pending["901"]!)).toHaveLength(25);
  expect(discordCalls(c.calls).find((x) => kind(x) === "edit")!.body.content).toContain(
    "enregistrée",
  );

  c.calls.length = 0;
  await handleInteraction(c.ctx, command("demarrer"));
  const challonge = challongeCalls(c.calls);
  expect(challonge.map((x) => `${x.method} ${x.path}`)).toEqual([
    "POST /tournaments/901/participants/bulk_add",
    "POST /tournaments/901/participants/bulk_add",
    "PUT /tournaments/901/change_state",
  ]);
  expect(challonge[0]!.body.data.attributes.participants).toHaveLength(20);
  expect(challonge[1]!.body.data.attributes.participants).toHaveLength(5);
  expect(challonge[0]!.body.data.attributes.participants[0]).toEqual({
    name: "joueur1",
    misc: "discord:U1",
  });
  const state = await c.store.read();
  expect(state.pending["901"]).toEqual({});
  expect(Object.keys(state.players["901"]!)).toHaveLength(25);
  expect(state.players["901"]!["U1"]!.participantId).toBe("7000");
  expect(state.players["901"]!["U25"]!.participantId).toBe("7024");
});

test("/tournoi terminer clôture et oublie le tournoi actif ; /tournoi bracket public ou message d'absence", async () => {
  const c = await context();
  await handleInteraction(c.ctx, command("bracket"));
  expect(discordCalls(c.calls)[0]!.body.data.flags).toBe(64);
  expect(discordCalls(c.calls)[0]!.body.data.content).toContain("Aucun tournoi en cours");

  await createTournament(c);
  await handleInteraction(c.ctx, command("bracket", [], member("U5", "curieux")));
  const shown = discordCalls(c.calls)[0]!;
  expect(shown.body.type).toBe(4);
  expect(shown.body.data.flags).toBeUndefined();
  expect(shown.body.data.content).toContain("https://challonge.com/coupe");

  c.calls.length = 0;
  await handleInteraction(c.ctx, command("terminer"));
  expect(challongeCalls(c.calls)[0]!.body.data.attributes.state).toBe("finalize");
  expect((await c.store.read()).guilds[GUILD]).toBeUndefined();
});

test("interaction d'un autre serveur : refusée sans travail", async () => {
  const c = await context();
  await handleInteraction(c.ctx, command("bracket", [], organiser, "AUTRE"));
  expect(challongeCalls(c.calls)).toHaveLength(0);
  expect(discordCalls(c.calls)[0]!.body.data.content).toContain("pas configuré pour ce serveur");
});

test("Discord expiré (404) à l'accusé : journalisé, aucun travail Challonge lancé", async () => {
  const c = await context();
  const original = c.ctx.discord.defer.bind(c.ctx.discord);
  c.ctx.discord.defer = async () => {
    throw new DiscordError("Ressource Discord introuvable (404)", 404, 10062);
  };
  await handleInteraction(c.ctx, command("creer", [{ type: 3, name: "nom", value: "X" }]));
  c.ctx.discord.defer = original;
  expect(challongeCalls(c.calls)).toHaveLength(0);
  expect(c.logs.join("\n")).toContain("Impossible d'accuser réception");
});

// --- REST Discord ------------------------------------------------------------------------------------------------------

test("REST Discord : 429 avec retry_after, jeton jamais divulgué dans les erreurs, en-tête Bot seulement hors interactions", async () => {
  const seen: { path: string; auth: string | null }[] = [];
  const sleeps: number[] = [];
  let n = 0;
  const fetchFn: Fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push({ path: url.pathname, auth: new Headers(init?.headers).get("authorization") });
    n += 1;
    if (n === 1)
      return new Response(
        JSON.stringify({ message: "You are being rate limited.", retry_after: 1.5, global: false }),
        { status: 429 },
      );
    if (url.pathname.endsWith("/gateway/bot"))
      return new Response(JSON.stringify({ url: "wss://x" }));
    if (url.pathname.endsWith("/callback")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ message: `Invalid token ${TOKEN}`, code: 0 }), {
      status: 401,
    });
  };
  const rest = new DiscordRest({
    token: TOKEN,
    appId: APP,
    fetch: fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
  });
  expect((await rest.getGatewayBot()).url).toBe("wss://x");
  expect(sleeps).toEqual([1500]);
  expect(seen[0]!.auth).toBe(`Bot ${TOKEN}`);

  const error = (await rest.putGuildCommands("G", []).catch((e: Error) => e)) as DiscordError;
  expect(error).toBeInstanceOf(DiscordError);
  expect(error.status).toBe(401);
  expect(error.message).toContain("Token Discord refusé (401)");
  expect(error.message).not.toContain(TOKEN);

  await rest.respond({ id: "i", token: "t", application_id: APP, type: 2 }, { content: "x" });
  expect(seen.at(-1)).toEqual({ path: "/api/v10/interactions/i/t/callback", auth: null });
});

test("webhooks : seules les URL discord.com/api/webhooks/<id>/<jeton> sont acceptées ; jeton masqué à l'affichage", () => {
  expect(assertWebhookUrl("https://discord.com/api/webhooks/123/abc-DEF_9")).toBe(
    "https://discord.com/api/webhooks/123/abc-DEF_9",
  );
  expect(assertWebhookUrl("https://discord.com/api/v10/webhooks/123/abc")).toContain(
    "/webhooks/123/abc",
  );
  for (const bad of [
    "http://discord.com/api/webhooks/1/a",
    "https://evil.example/api/webhooks/1/a",
    "https://discord.com/api/webhooks/x/a",
    "pas une url",
    "https://discord.com/other",
  ]) {
    expect(() => assertWebhookUrl(bad)).toThrow(UsageError);
  }
  expect(redactWebhook("https://discord.com/api/webhooks/123/SECRETTOKEN")).toBe(
    "https://discord.com/api/webhooks/123/***",
  );
});

// --- Bout en bout : Gateway locale + REST simulée -------------------------------------------------------------------

let gatewayServer: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  gatewayServer?.stop(true);
  gatewayServer = undefined;
});

test("runBot : enregistre /tournoi, se connecte à la Gateway locale et répond à INTERACTION_CREATE", async () => {
  const f = fakes();
  const gatewayFrames: any[] = [];
  const interaction = command("bracket");
  gatewayServer = Bun.serve<undefined>({
    port: 0,
    fetch: (req, srv) =>
      srv.upgrade(req, { data: undefined }) ? undefined : new Response("x", { status: 426 }),
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30 } }));
      },
      message(ws, raw) {
        const frame = JSON.parse(String(raw));
        gatewayFrames.push(frame);
        if (frame.op === 1) ws.send(JSON.stringify({ op: 11 }));
        if (frame.op === 2) {
          ws.send(
            JSON.stringify({
              op: 0,
              s: 1,
              t: "READY",
              d: {
                session_id: "s",
                resume_gateway_url: `ws://127.0.0.1:${gatewayServer!.port}`,
                user: { id: "bot" },
              },
            }),
          );
          ws.send(JSON.stringify({ op: 0, s: 2, t: "INTERACTION_CREATE", d: interaction }));
        }
      },
    },
  });
  const gatewayUrl = `ws://127.0.0.1:${gatewayServer.port}`;
  const fetchFn: Fetch = async (input, init) => {
    const res = await f.fetchFn(input, init);
    if (String(input).endsWith("/gateway/bot"))
      return new Response(JSON.stringify({ url: gatewayUrl }));
    return res;
  };
  const controller = new AbortController();
  const out: string[] = [];
  const stateDir = await mkdtemp(join(dir, "run-"));
  const running = runBot(
    {
      env: {},
      fetch: fetchFn,
      sleep: async () => undefined,
      random: () => 0,
      out: () => undefined,
      err: (l) => out.push(l),
      signal: controller.signal,
    },
    {
      apiKey: "ck-key-123456",
      discord: {
        token: TOKEN,
        appId: APP,
        guildId: GUILD,
        organiserRoleId: ROLE,
        batchRegistrations: false,
      },
      dir: stateDir,
      warnings: [],
    },
  );
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !f.calls.some((c) => c.path.endsWith("/callback")))
    // oxlint-disable-next-line no-await-in-loop -- sondage du rappel : délai entre deux vérifications séquentielles
    await Bun.sleep(10);
  controller.abort();
  expect(await running).toBe(0);

  const put = f.calls.find(
    (c) => c.method === "PUT" && c.path === `/applications/${APP}/guilds/${GUILD}/commands`,
  )!;
  expect(put.body[0].name).toBe("tournoi");
  expect(put.headers.get("authorization")).toBe(`Bot ${TOKEN}`);
  const identify = gatewayFrames.find((fr) => fr.op === 2);
  expect(identify.d.token).toBe(TOKEN);
  const reply = f.calls.find((c) => c.path.endsWith("/callback"))!;
  expect(reply.path).toBe(`/interactions/${interaction.id}/${interaction.token}/callback`);
  expect(reply.body.data.content).toContain("Aucun tournoi en cours");
  expect(out.join("\n")).not.toContain(TOKEN);
});

test("runBot : token refusé par la Gateway (4004) -> code de sortie 1 et message français", async () => {
  const f = fakes();
  gatewayServer = Bun.serve<undefined>({
    port: 0,
    fetch: (req, srv) =>
      srv.upgrade(req, { data: undefined }) ? undefined : new Response("x", { status: 426 }),
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 10_000 } }));
      },
      message(ws, raw) {
        if (JSON.parse(String(raw)).op === 2) ws.close(4004, "Authentication failed");
      },
    },
  });
  const url = `ws://127.0.0.1:${gatewayServer.port}`;
  const errors: string[] = [];
  const code = await runBot(
    {
      env: {},
      fetch: async (input, init) =>
        String(input).endsWith("/gateway/bot")
          ? new Response(JSON.stringify({ url }))
          : f.fetchFn(input, init),
      sleep: async () => undefined,
      random: () => 0,
      out: () => undefined,
      err: (l) => errors.push(l),
    },
    {
      apiKey: "ck-key-123456",
      discord: { token: TOKEN, appId: APP, guildId: GUILD, batchRegistrations: false },
      dir: await mkdtemp(join(dir, "run-")),
      warnings: [],
    },
    { register: false },
  );
  expect(code).toBe(1);
  expect(errors.join("\n")).toContain("token refusé (4004)");
  expect(errors.join("\n")).not.toContain(TOKEN);
});
