import { readFile } from "node:fs/promises";

import { type OptionSpec, parse, UsageError } from "../../shared/args.ts";
import { runBot } from "./challonge/bot.ts";
import { commandDefinitions } from "./challonge/bot-commands.ts";
import { ChallongeClient, ChallongeError, type PlanEntry } from "./challonge/client.ts";
import { authOf, type ChallongeConfig, loadConfig } from "./challonge/config.ts";
import { assertWebhookUrl, DiscordError, DiscordRest, redactWebhook } from "./challonge/discord.ts";
import { redact } from "./challonge/http.ts";
import { defaultIo, type Io } from "./challonge/io.ts";
import { readParticipants, readSeedFile, type SeedEntry, seedBy, shuffleSeeds } from "./challonge/participants.ts";
import { defaultStatePath, StateStore } from "./challonge/state.ts";
import {
  bracketUrl,
  createTournamentFlow,
  matchPlayers,
  normalizeType,
  reportMatch,
  stateFor,
  TYPE_LABEL,
  type CreateResult,
  addParticipants,
} from "./challonge/tournaments.ts";
import type { Command } from "./types.ts";

const HELP = `creator-kit challonge <sous-commande> [options]

Automatise les tournois Challonge (API v2.1) : CLI ici, bot Discord via « challonge bot ».

Sous-commandes :
  create     Crée un tournoi, ajoute les participants, le lance (--start) et l'annonce (--announce)
  add        Ajoute des participants à un tournoi (lots de 20)
  start      Lance le tournoi (--shuffle : tirage au sort des têtes de série juste avant)
  randomize  Tire les têtes de série au sort
  report     Saisit un score : report <match> <score> [--winner 1|2|nom|id] [--tie]
  matches    Liste les matchs (--state open|pending|complete)
  list       Liste vos tournois (--state pending|in_progress|ended)
  show       Affiche l'état et l'URL du bracket
  checkin    Clôture le check-in (--abort pour l'annuler)
  finalize   Clôture le tournoi et fige le classement
  bot        Lance le bot Discord (/tournoi creer|inscrire|demarrer|score|terminer|bracket)

Options communes :
  -t, --tournament <id|url>  tournoi visé (défaut : le dernier créé avec cet outil)
      --community <id>       communauté Challonge propriétaire (sous-domaine ou permalink)
      --dry-run              affiche le plan de requêtes sans appeler l'API
      --json                 sortie JSON
  -h, --help

Configuration : CHALLONGE_API_KEY (jamais affichée) ou ~/.config/creator-kit/challonge.json.
« creator-kit challonge <sous-commande> --help » détaille chaque commande.`;

const HELPS: Record<string, string> = {
  create: `creator-kit challonge create --name <nom> [options]

  -n, --name <nom>            nom du tournoi (obligatoire)
  -g, --game <jeu>            jeu (game_name)
      --type <type>           single_elimination (défaut), double_elimination, round_robin, swiss, free_for_all
  -p, --participants <src>    fichier (un nom par ligne) ou liste "a,b,c"
      --shuffle               tirage au sort des têtes de série (côté client, aucune requête en plus)
      --seed-by <fichier>     seeding : un nom par ligne (meilleur d'abord) ou « nom;note » (note la plus haute = seed 1)
      --url <slug>            URL du bracket (lettres, chiffres, _)
      --start                 lance le tournoi après l'ajout des participants
      --announce <webhook>    poste l'annonce sur un webhook Discord (sinon announceWebhook du fichier de config)
      --description <texte>   --private   --starts-at <date ISO>   --open-signup   --signup-cap <n>
      --checkin <minutes>     check-in (multiple de 5)   --third-place   --grand-finals skip|single
      --swiss-rounds <n>      --group-stage [--group-size <n>] [--advance <n>]  (deux phases : poules puis bracket)
      --dry-run  --json  --community <id>`,
  add: `creator-kit challonge add [-t <id>] <nom...> | --participants <fichier|"a,b,c">

Ajoute des participants à un tournoi en préparation (bulk_add, 20 par requête).`,
  start: `creator-kit challonge start [-t <id>] [--shuffle] [--group-stage]

--shuffle : tire les têtes de série au sort juste avant (une requête randomize).
--group-stage : tournoi à deux phases, lance la phase de poules (start_group_stage).`,
  randomize:
    "creator-kit challonge randomize [-t <id>]\n\nTire les têtes de série au sort (PUT participants/randomize).",
  report: `creator-kit challonge report [-t <id>] <match> <score> [--winner 1|2|nom|id] [--tie] [--force]

<match>   lettre du bracket (A, B…) ou ID numérique ; voir « challonge matches »
<score>   « 2-1 » (joueur 1 - joueur 2) ou, par manche, « 3-1,2-4,3-0 »
--winner  gagnant si les scores ne le désignent pas (ou pour le forcer avec --force)
--tie     match nul (round robin / suisse)`,
  matches:
    "creator-kit challonge matches [-t <id>] [--state open|pending|complete]\n\nListe les matchs avec leur lettre de bracket et les noms des joueurs.",
  list: "creator-kit challonge list [--state pending|in_progress|ended] [--type <type>] [--page <n>]\n\nListe les tournois du compte (25 par page).",
  show: "creator-kit challonge show [-t <id>]\n\nAffiche nom, état et URL du bracket.",
  checkin:
    "creator-kit challonge checkin [-t <id>] [--abort]\n\nTraite les résultats du check-in (process_checkin) ou l'annule (abort_checkin).",
  finalize:
    "creator-kit challonge finalize [-t <id>] [--group-stage]\n\nClôture le tournoi (finalize) ; --group-stage clôture la phase de poules.",
  bot: `creator-kit challonge bot [--dry-run] [--no-register]

Bot Discord (Gateway + commandes slash /tournoi). Variables : DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID,
ORGANISER_ROLE_ID, CHALLONGE_API_KEY. --dry-run affiche les commandes qui seraient enregistrées, sans réseau.
--no-register ne ré-enregistre pas les commandes au démarrage. Inscriptions groupées : CHALLONGE_BATCH_REGISTRATIONS=1.`,
};

const COMMON = {
  tournament: { type: "string", short: "t" },
  community: { type: "string" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} satisfies OptionSpec;

function withCommon<T extends OptionSpec>(extra: T): T & typeof COMMON {
  return { ...COMMON, ...extra };
}

interface Run {
  io: Io;
  config: ChallongeConfig;
  store: StateStore;
  client: ChallongeClient;
  dryRun: boolean;
  json: boolean;
  /** Communauté Challonge utilisée pour le scoping (option, dernier tournoi ou configuration). */
  community?: string;
  /** Tournoi visé (identifiant ou slug) quand la commande en a besoin. */
  tournamentId: string;
  plan: PlanEntry[];
}

/** Accepte un ID, un slug ou une URL Challonge ; renvoie l'identifiant à envoyer à l'API. */
export function tournamentFromInput(input: string): string {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return last;
  } catch {
    // retombe sur l'erreur d'usage
  }
  throw new UsageError(`URL de tournoi illisible : ${input}`);
}

async function prepare<S extends OptionSpec>(
  io: Io,
  argv: string[],
  spec: S,
  options: { tournament: boolean },
): Promise<{
  run?: Run;
  values: ReturnType<typeof parse<S>>["values"];
  positionals: string[];
}> {
  const { values, positionals } = parse(argv, spec);
  const common = values as {
    help?: boolean;
    tournament?: string;
    community?: string;
    "dry-run"?: boolean;
    json?: boolean;
  };
  if (common.help) return { values, positionals };
  const config = await loadConfig(io.env);
  for (const warning of config.warnings) io.err(`Attention : ${warning}`);
  const dryRun = !!common["dry-run"];
  const store = new StateStore(defaultStatePath(config.dir));

  let tournamentId = "";
  let community = common.community ?? config.communityId;
  if (options.tournament) {
    if (common.tournament) tournamentId = tournamentFromInput(common.tournament);
    else {
      const last = (await store.read()).lastTournament;
      if (last) {
        tournamentId = last.id;
        community ??= last.community;
      } else if (dryRun) tournamentId = "TOURNAMENT_ID";
      else
        throw new UsageError(
          "Aucun tournoi indiqué : utilisez --tournament <id|url> (ou créez-en un avec « challonge create »).",
        );
    }
  }

  const plan: PlanEntry[] = [];
  const client = new ChallongeClient({
    auth: dryRun ? undefined : authOf(config),
    fetch: io.fetch,
    sleep: io.sleep,
    random: io.random,
    community,
    dryRun,
    onPlan: entry => plan.push(entry),
    onRetry: ({ status, attempt, waitMs }) =>
      io.err(`Challonge ${status} : nouvelle tentative ${attempt} dans ${Math.round(waitMs / 100) / 10} s…`),
  });
  return {
    values,
    positionals,
    run: {
      io,
      config,
      store,
      client,
      dryRun,
      json: !!common.json,
      community,
      tournamentId,
      plan,
    },
  };
}

function printPlan(run: Run): void {
  if (!run.dryRun) return;
  run.io.out(
    "Plan de requêtes (--dry-run : rien n'est envoyé). En-têtes : Authorization-Type: v1|v2, Authorization: ***",
  );
  for (const entry of run.plan) {
    run.io.out(`  ${entry.method} ${entry.url}`);
    if (entry.body !== undefined) {
      for (const line of JSON.stringify(entry.body, null, 2).split("\n")) run.io.out(`    ${line}`);
    }
  }
}

function summary(run: Run): string {
  return `Requêtes API émises : ${run.client.requestCount}.`;
}

function num(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new UsageError(`${flag} attend un entier (reçu « ${value} »).`);
  return n;
}

// --- create -----------------------------------------------------------------------------------------------------

const CREATE_SPEC = withCommon({
  name: { type: "string", short: "n" },
  game: { type: "string", short: "g" },
  type: { type: "string" },
  participants: { type: "string", short: "p" },
  shuffle: { type: "boolean" },
  "seed-by": { type: "string" },
  url: { type: "string" },
  start: { type: "boolean" },
  announce: { type: "string" },
  description: { type: "string" },
  private: { type: "boolean" },
  "starts-at": { type: "string" },
  "open-signup": { type: "boolean" },
  "signup-cap": { type: "string" },
  checkin: { type: "string" },
  "third-place": { type: "boolean" },
  "grand-finals": { type: "string" },
  "swiss-rounds": { type: "string" },
  "group-stage": { type: "boolean" },
  "group-size": { type: "string" },
  advance: { type: "string" },
});

async function seedEntries(
  values: { participants?: string; shuffle?: boolean; "seed-by"?: string },
  io: Io,
): Promise<SeedEntry[]> {
  if (values.shuffle && values["seed-by"]) throw new UsageError("--shuffle et --seed-by s'excluent mutuellement.");
  let names = values.participants ? await readParticipants(values.participants) : [];
  if (values["seed-by"]) {
    let text: string;
    try {
      text = await readFile(values["seed-by"], "utf8");
    } catch (error) {
      throw new UsageError(`Impossible de lire le fichier --seed-by : ${(error as Error).message}`);
    }
    const ranking = readSeedFile(text);
    if (!names.length) names = ranking;
    const { entries, unknown } = seedBy(names, ranking);
    if (unknown.length)
      io.err(`Attention : ${unknown.length} nom(s) du fichier --seed-by absent(s) de la liste : ${unknown.join(", ")}`);
    return entries;
  }
  return values.shuffle ? shuffleSeeds(names, io.random) : names.map(name => ({ name }));
}

async function announce(
  run: Run,
  webhook: string,
  result: CreateResult,
  game: string | undefined,
  type: string,
): Promise<void> {
  const message = {
    content: `Nouveau tournoi : ${result.tournament.name ?? ""}`.trim(),
    embeds: [
      {
        title: result.tournament.name,
        url: result.tournament.bracketUrl,
        description: [`Format : ${type}`, game ? `Jeu : ${game}` : undefined, `Participants : ${result.participants}`]
          .filter(Boolean)
          .join("\n"),
        color: 0xf26e22,
      },
    ],
    allowed_mentions: { parse: [] },
  };
  if (run.dryRun) {
    run.io.out(`  POST ${redactWebhook(assertWebhookUrl(webhook))}`);
    for (const line of JSON.stringify(message, null, 2).split("\n")) run.io.out(`    ${line}`);
    return;
  }
  const rest = new DiscordRest({
    fetch: run.io.fetch,
    sleep: run.io.sleep,
    random: run.io.random,
  });
  try {
    await rest.executeWebhook(webhook, message);
    run.io.out("Annonce Discord envoyée.");
  } catch (error) {
    // Le tournoi existe déjà : un échec d'annonce n'annule rien, on prévient seulement.
    run.io.err(`Attention : annonce Discord non envoyée (${redact((error as Error).message, [webhook])}).`);
  }
}

async function create(io: Io, argv: string[]): Promise<number> {
  const { run, values } = await prepare(io, argv, CREATE_SPEC, {
    tournament: false,
  });
  if (!run) return help(io, "create");
  if (!values.name) throw new UsageError("Option --name obligatoire.");
  const type = normalizeType(values.type ?? "single_elimination");
  const game = values.game ?? run.config.game;
  const entries = await seedEntries(values, io);
  const webhook = values.announce ?? run.config.announceWebhook;
  if (webhook) assertWebhookUrl(webhook);
  const grandFinals = values["grand-finals"];
  if (grandFinals !== undefined && grandFinals !== "skip" && grandFinals !== "single") {
    throw new UsageError("--grand-finals attend « skip » ou « single ».");
  }
  const result = await createTournamentFlow(
    run.client,
    {
      name: values.name,
      type,
      game,
      url: values.url,
      description: values.description,
      private: values.private,
      startsAt: values["starts-at"],
      openSignup: values["open-signup"],
      signupCap: num(values["signup-cap"], "--signup-cap"),
      checkInMinutes: num(values.checkin, "--checkin"),
      swissRounds: num(values["swiss-rounds"], "--swiss-rounds"),
      thirdPlace: values["third-place"],
      grandFinals: grandFinals === undefined ? undefined : grandFinals === "skip" ? "skip" : "single match",
      groupStage: values["group-stage"]
        ? {
            size: num(values["group-size"], "--group-size"),
            advance: num(values.advance, "--advance"),
          }
        : undefined,
    },
    entries,
    { start: values.start, community: run.community },
  );

  if (run.dryRun) {
    printPlan(run);
    if (webhook) await announce(run, webhook, result, game, TYPE_LABEL[type]);
    run.io.out("Aucune requête envoyée.");
    return 0;
  }
  await run.store.update(state => {
    state.lastTournament = result.tournament;
  });
  if (run.json) {
    run.io.out(
      JSON.stringify(
        {
          tournament: result.tournament,
          state: result.state,
          participants: result.participants,
          started: result.started,
          requests: run.client.requestCount,
        },
        null,
        2,
      ),
    );
  } else {
    run.io.out(`Tournoi créé : ${result.tournament.name ?? values.name} (${TYPE_LABEL[type]})`);
    run.io.out(`  id           : ${result.tournament.id}`);
    run.io.out(`  état         : ${result.state ?? "inconnu"}`);
    run.io.out(`  bracket      : ${result.tournament.bracketUrl}`);
    run.io.out(`  participants : ${result.participants}${result.started ? " (tournoi lancé)" : ""}`);
    run.io.out(summary(run));
  }
  if (webhook) await announce(run, webhook, result, game, TYPE_LABEL[type]);
  return 0;
}

// --- add / start / randomize / finalize / checkin ----------------------------------------------------------------

async function add(io: Io, argv: string[]): Promise<number> {
  const { run, values, positionals } = await prepare(
    io,
    argv,
    withCommon({ participants: { type: "string", short: "p" } }),
    { tournament: true },
  );
  if (!run) return help(io, "add");
  const source = values.participants ?? positionals.join(",");
  if (!source) throw new UsageError('Indiquez des noms (add Alice Bob) ou --participants <fichier|"a,b,c">.');
  const names = await readParticipants(source);
  await addParticipants(
    run.client,
    run.tournamentId,
    names.map(name => ({ name })),
  );
  return finish(run, `${names.length} participant(s) ajouté(s) au tournoi ${run.tournamentId}.`);
}

async function stateCommand(io: Io, argv: string[], name: "start" | "finalize"): Promise<number> {
  const { run, values } = await prepare(
    io,
    argv,
    withCommon({
      shuffle: { type: "boolean" },
      "group-stage": { type: "boolean" },
    }),
    { tournament: true },
  );
  if (!run) return help(io, name);
  if (values.shuffle && name !== "start") throw new UsageError("--shuffle ne s'applique qu'à start.");
  if (values.shuffle) await run.client.randomizeParticipants(run.tournamentId);
  const target = stateFor(name, !!values["group-stage"]);
  const tournament = await run.client.changeState(run.tournamentId, target);
  const state = tournament?.attributes?.state;
  return finish(run, `Tournoi ${run.tournamentId} : « ${target} » effectué${state ? ` (état : ${state})` : ""}.`);
}

async function randomize(io: Io, argv: string[]): Promise<number> {
  const { run } = await prepare(io, argv, withCommon({}), { tournament: true });
  if (!run) return help(io, "randomize");
  await run.client.randomizeParticipants(run.tournamentId);
  return finish(run, `Têtes de série tirées au sort pour le tournoi ${run.tournamentId}.`);
}

async function checkin(io: Io, argv: string[]): Promise<number> {
  const { run, values } = await prepare(io, argv, withCommon({ abort: { type: "boolean" } }), {
    tournament: true,
  });
  if (!run) return help(io, "checkin");
  const target = values.abort ? "abort_checkin" : "process_checkin";
  await run.client.changeState(run.tournamentId, target);
  return finish(run, `Tournoi ${run.tournamentId} : « ${target} » effectué.`);
}

function finish(run: Run, message: string): number {
  if (run.dryRun) {
    printPlan(run);
    run.io.out("Aucune requête envoyée.");
    return 0;
  }
  run.io.out(
    run.json ? JSON.stringify({ ok: true, message, requests: run.client.requestCount }) : `${message}\n${summary(run)}`,
  );
  return 0;
}

// --- report / matches / list / show ---------------------------------------------------------------------------------

async function report(io: Io, argv: string[]): Promise<number> {
  const { run, values, positionals } = await prepare(
    io,
    argv,
    withCommon({
      winner: { type: "string" },
      tie: { type: "boolean" },
      force: { type: "boolean" },
    }),
    { tournament: true },
  );
  if (!run) return help(io, "report");
  const [match, score, ...rest] = positionals;
  if (!match || !score || rest.length) throw new UsageError("Usage : report <match> <score> (ex. report A 2-1).");
  const result = await reportMatch(run.client, run.tournamentId, match, score, {
    winner: values.winner,
    tie: values.tie,
    force: values.force,
  });
  if (run.dryRun) {
    printPlan(run);
    run.io.out("Aucune requête envoyée.");
    return 0;
  }
  const sets = result.score.sets.map(([a, b]) => `${a}-${b}`).join(", ");
  const outcome = result.tie ? "match nul" : result.winnerId ? `gagnant : participant ${result.winnerId}` : "";
  if (run.json)
    run.io.out(
      JSON.stringify({
        match: result.matchId,
        identifier: result.identifier,
        score: sets,
        winnerId: result.winnerId,
        tie: result.tie,
        requests: run.client.requestCount,
      }),
    );
  else
    run.io.out(
      `Score enregistré : match ${result.identifier ?? result.matchId} ${sets}${outcome ? ` (${outcome})` : ""}.\n${summary(run)}`,
    );
  return 0;
}

async function matches(io: Io, argv: string[]): Promise<number> {
  const { run, values } = await prepare(io, argv, withCommon({ state: { type: "string" } }), {
    tournament: true,
  });
  if (!run) return help(io, "matches");
  const state = values.state;
  if (state !== undefined && !["open", "pending", "complete"].includes(state))
    throw new UsageError("--state attend open, pending ou complete.");
  const found = await run.client.listMatches(run.tournamentId, state as "open" | "pending" | "complete" | undefined);
  const participants = run.dryRun ? [] : await run.client.listParticipants(run.tournamentId);
  if (run.dryRun) return finish(run, "");
  const names = new Map(participants.map(p => [String(p.id), p.attributes.name ?? String(p.id)]));
  const rows = found.map(m => {
    const { player1, player2 } = matchPlayers(m);
    return {
      id: m.id,
      identifier: m.attributes.identifier ?? "",
      round: m.attributes.round,
      state: m.attributes.state,
      player1: player1 ? (names.get(player1) ?? player1) : null,
      player2: player2 ? (names.get(player2) ?? player2) : null,
      scores: m.attributes.scores ?? "",
    };
  });
  if (run.json) run.io.out(JSON.stringify(rows, null, 2));
  else if (!rows.length) run.io.out("Aucun match.");
  else {
    for (const r of rows) {
      run.io.out(
        `${String(r.identifier).padEnd(3)} tour ${String(r.round ?? "?").padEnd(3)} ${String(r.state).padEnd(9)} ${r.player1 ?? "?"} vs ${r.player2 ?? "?"}  ${r.scores}  [id ${r.id}]`,
      );
    }
    run.io.out(summary(run));
  }
  return 0;
}

async function list(io: Io, argv: string[]): Promise<number> {
  const { run, values } = await prepare(
    io,
    argv,
    withCommon({
      state: { type: "string" },
      type: { type: "string" },
      page: { type: "string" },
    }),
    { tournament: false },
  );
  if (!run) return help(io, "list");
  if (values.state !== undefined && !["pending", "in_progress", "ended"].includes(values.state)) {
    throw new UsageError("--state attend pending, in_progress ou ended.");
  }
  const type = values.type ? normalizeType(values.type) : undefined;
  const tournaments = await run.client.listTournaments({
    state: values.state,
    type,
    page: num(values.page, "--page"),
  });
  if (run.dryRun) return finish(run, "");
  const rows = tournaments.map(t => ({
    id: t.id,
    url: t.attributes.url,
    name: t.attributes.name,
    state: t.attributes.state,
    type: t.attributes.tournament_type,
    bracket: bracketUrl(t.attributes, run.community),
  }));
  if (run.json) run.io.out(JSON.stringify(rows, null, 2));
  else if (!rows.length) run.io.out("Aucun tournoi.");
  else {
    for (const r of rows)
      run.io.out(
        `${String(r.id).padEnd(10)} ${String(r.state ?? "?").padEnd(12)} ${String(r.type ?? "?").padEnd(18)} ${r.name ?? ""}  ${r.bracket}`,
      );
    run.io.out(summary(run));
  }
  return 0;
}

async function show(io: Io, argv: string[]): Promise<number> {
  const { run } = await prepare(io, argv, withCommon({}), { tournament: true });
  if (!run) return help(io, "show");
  const tournament = await run.client.getTournament(run.tournamentId);
  if (run.dryRun) return finish(run, "");
  const link = bracketUrl(tournament.attributes, run.community);
  if (run.json) {
    run.io.out(
      JSON.stringify(
        {
          id: tournament.id,
          name: tournament.attributes.name,
          state: tournament.attributes.state,
          bracket: link,
        },
        null,
        2,
      ),
    );
  } else {
    run.io.out(`${tournament.attributes.name ?? run.tournamentId} — ${tournament.attributes.state ?? "état inconnu"}`);
    run.io.out(link);
  }
  return 0;
}

// --- bot ---------------------------------------------------------------------------------------------------------

async function bot(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    "dry-run": { type: "boolean" },
    "no-register": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) return help(io, "bot");
  if (values["dry-run"]) {
    io.out(
      "Commandes qui seraient enregistrées (PUT /applications/<DISCORD_APP_ID>/guilds/<DISCORD_GUILD_ID>/commands) :",
    );
    io.out(JSON.stringify(commandDefinitions(), null, 2));
    io.out("Aucune connexion ouverte.");
    return 0;
  }
  const config = await loadConfig(io.env);
  for (const warning of config.warnings) io.err(`Attention : ${warning}`);
  const controller = new AbortController();
  const stop = () => controller.abort();
  const real = io.signal === undefined;
  if (real) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  try {
    return await runBot({ ...io, signal: io.signal ?? controller.signal }, config, {
      register: !values["no-register"],
    });
  } finally {
    if (real) {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
}

// --- entrée ------------------------------------------------------------------------------------------------------

function help(io: Io, topic?: string): number {
  io.out(topic ? (HELPS[topic] ?? HELP) : HELP);
  return 0;
}

export async function runChallonge(argv: string[], io: Io = defaultIo()): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") return help(io);
  try {
    switch (sub) {
      case "create":
        return await create(io, rest);
      case "add":
        return await add(io, rest);
      case "start":
        return await stateCommand(io, rest, "start");
      case "finalize":
        return await stateCommand(io, rest, "finalize");
      case "randomize":
        return await randomize(io, rest);
      case "checkin":
        return await checkin(io, rest);
      case "report":
        return await report(io, rest);
      case "matches":
        return await matches(io, rest);
      case "list":
        return await list(io, rest);
      case "show":
        return await show(io, rest);
      case "bot":
        return await bot(io, rest);
      default:
        throw new UsageError(`Sous-commande inconnue : « ${sub} ».\n\n${HELP}`);
    }
  } catch (error) {
    if (error instanceof ChallongeError || error instanceof DiscordError) {
      io.err(`Erreur : ${error.message}`);
      return 1;
    }
    throw error;
  }
}

const command: Command = {
  name: "challonge",
  summary: "Créer et lancer un tournoi Challonge (CLI + bot Discord)",
  run: argv => runChallonge(argv),
};

export default command;
