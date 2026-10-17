import { UsageError } from "../../../shared/args.ts";
import type { ChallongeClient, Match, Participant, Tournament, TournamentAttrs } from "./client.ts";
import { BULK_LIMIT, chunk, type SeedEntry } from "./participants.ts";
import type { TournamentRef } from "./state.ts";

export type TournamentType = "single_elimination" | "double_elimination" | "round_robin" | "swiss" | "free_for_all";

/** Valeurs attendues par `tournament_type` à la création (schéma OpenAPI v2.1 : mots séparés par des espaces). */
export const TYPE_API: Record<TournamentType, string> = {
  single_elimination: "single elimination",
  double_elimination: "double elimination",
  round_robin: "round robin",
  swiss: "swiss",
  free_for_all: "free for all",
};

export const TYPE_LABEL: Record<TournamentType, string> = {
  single_elimination: "élimination directe",
  double_elimination: "double élimination",
  round_robin: "round robin",
  swiss: "ronde suisse",
  free_for_all: "free for all",
};

const TYPE_ALIASES: Record<string, TournamentType> = {
  single: "single_elimination",
  se: "single_elimination",
  elimination: "single_elimination",
  double: "double_elimination",
  de: "double_elimination",
  rr: "round_robin",
  roundrobin: "round_robin",
  ffa: "free_for_all",
};

export function normalizeType(input: string): TournamentType {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (key in TYPE_API) return key as TournamentType;
  const alias = TYPE_ALIASES[key];
  if (alias) return alias;
  throw new UsageError(`Type de tournoi inconnu : « ${input} ». Valeurs : ${Object.keys(TYPE_API).join(", ")}.`);
}

/** Slug d'URL Challonge : lettres, chiffres et underscores (règle de l'API v1, reprise par prudence). */
export function assertSlug(slug: string): string {
  if (!/^[A-Za-z0-9_]{1,60}$/.test(slug)) {
    throw new UsageError(`URL invalide : « ${slug} ». Utilisez uniquement lettres, chiffres et _ (60 caractères max).`);
  }
  return slug;
}

export interface CreateOptions {
  name: string;
  type: TournamentType;
  game?: string;
  url?: string;
  description?: string;
  private?: boolean;
  startsAt?: string;
  openSignup?: boolean;
  signupCap?: number;
  /** Minutes de check-in avant l'heure de début (multiple de 5). */
  checkInMinutes?: number;
  swissRounds?: number;
  thirdPlace?: boolean;
  grandFinals?: "skip" | "single match";
  groupStage?: { size?: number; advance?: number };
}

export function buildTournamentAttributes(o: CreateOptions): Record<string, unknown> {
  if (!o.name.trim()) throw new UsageError("Le nom du tournoi est obligatoire (--name).");
  const attributes: Record<string, unknown> = {
    name: o.name.trim(),
    tournament_type: TYPE_API[o.type],
  };
  if (o.url) attributes.url = assertSlug(o.url);
  if (o.game) attributes.game_name = o.game;
  if (o.description) attributes.description = o.description;
  if (o.private) attributes.private = true;
  if (o.startsAt) {
    const date = new Date(o.startsAt);
    if (Number.isNaN(date.getTime()))
      throw new UsageError(`Date invalide pour --starts-at : « ${o.startsAt} » (ex. 2026-11-07T18:00:00+01:00).`);
    attributes.starts_at = date.toISOString();
  }
  const registration: Record<string, unknown> = {};
  if (o.openSignup) registration.open_signup = true;
  if (o.signupCap !== undefined) registration.signup_cap = positive(o.signupCap, "--signup-cap");
  if (o.checkInMinutes !== undefined) {
    if (!Number.isInteger(o.checkInMinutes) || o.checkInMinutes <= 0 || o.checkInMinutes % 5 !== 0) {
      throw new UsageError("--checkin doit être un multiple de 5 (minutes).");
    }
    registration.check_in_duration = o.checkInMinutes;
  }
  if (Object.keys(registration).length) attributes.registration_options = registration;
  if (o.thirdPlace) attributes.match_options = { consolation_matches_target_rank: 3 };
  if (o.grandFinals) {
    if (o.type !== "double_elimination")
      throw new UsageError("--grand-finals ne s'applique qu'à la double élimination.");
    attributes.double_elimination_options = {
      grand_finals_modifier: o.grandFinals,
    };
  }
  if (o.swissRounds !== undefined) {
    if (o.type !== "swiss") throw new UsageError("--swiss-rounds ne s'applique qu'au format swiss.");
    attributes.swiss_options = {
      rounds: positive(o.swissRounds, "--swiss-rounds"),
    };
  }
  if (o.groupStage) {
    attributes.group_stage_enabled = true;
    attributes.group_stage_options = {
      stage_type: "round robin",
      group_size: positive(o.groupStage.size ?? 4, "--group-size"),
      participant_count_to_advance_per_group: positive(o.groupStage.advance ?? 2, "--advance"),
    };
  }
  return attributes;
}

function positive(value: number, flag: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new UsageError(`${flag} doit être un entier strictement positif.`);
  return value;
}

/**
 * URL publique du bracket. Si l'API fournit `full_challonge_url` on l'utilise (champ non documenté : NON VÉRIFIÉ) ;
 * sinon `https://challonge.com/<url>` (le préfixe de communauté n'est pas confirmé par la doc : NON VÉRIFIÉ).
 */
export function bracketUrl(attributes: TournamentAttrs, community?: string): string {
  if (typeof attributes.full_challonge_url === "string" && attributes.full_challonge_url)
    return attributes.full_challonge_url;
  const slug = attributes.url ?? "";
  return `https://challonge.com/${community ? `${community}/` : ""}${slug}`;
}

export function tournamentRef(tournament: Tournament, community?: string): TournamentRef {
  return {
    id: String(tournament.id),
    url: tournament.attributes.url,
    name: tournament.attributes.name,
    bracketUrl: bracketUrl(tournament.attributes, community),
    community,
  };
}

/** Envoie les participants par lots de 20 (`bulk_add`) et renvoie ceux créés (liste vide en dry-run). */
export async function addParticipants(
  client: ChallongeClient,
  tournamentId: string,
  entries: readonly SeedEntry[],
): Promise<Participant[]> {
  const created: Participant[] = [];
  for (const batch of chunk(entries, BULK_LIMIT)) {
    const payload = batch.map(entry => {
      const attributes: Record<string, unknown> = { name: entry.name };
      if (entry.seed !== undefined) attributes.seed = entry.seed;
      if (entry.misc) attributes.misc = entry.misc;
      return attributes;
    });
    // oxlint-disable-next-line no-await-in-loop -- lots envoyés séquentiellement : limite de débit de l'API Challonge et ordre des participants créés
    created.push(...(await client.bulkAddParticipants(tournamentId, payload)));
  }
  return created;
}

export interface CreateResult {
  tournament: TournamentRef;
  state?: string;
  participants: number;
  started: boolean;
  created: Participant[];
}

/** Création complète : tournoi, participants par lots de 20, démarrage optionnel. */
export async function createTournamentFlow(
  client: ChallongeClient,
  options: CreateOptions,
  entries: readonly SeedEntry[],
  config: { start?: boolean; community?: string },
): Promise<CreateResult> {
  const tournament = await client.createTournament(buildTournamentAttributes(options));
  const ref = tournamentRef(tournament, config.community);
  const created = entries.length ? await addParticipants(client, ref.id, entries) : [];
  let state = tournament.attributes.state;
  if (config.start) {
    const started = await client.changeState(ref.id, options.groupStage ? "start_group_stage" : "start");
    state = started?.attributes?.state ?? state;
  }
  return {
    tournament: ref,
    state,
    participants: entries.length,
    started: !!config.start,
    created,
  };
}

/** Transitions d'état documentées (Change Tournament State) exposées par la CLI. */
export type StateAction = "start" | "finalize" | "process_checkin" | "abort_checkin";

export function stateFor(action: StateAction, groupStage: boolean): string {
  if (!groupStage) return action;
  if (action === "start") return "start_group_stage";
  if (action === "finalize") return "finalize_group_stage";
  throw new UsageError("--group-stage ne s'applique qu'à start et finalize.");
}

// --- Scores -----------------------------------------------------------------------------------------------------

export interface ParsedScore {
  sets: [number, number][];
  /** `score_set` du joueur 1 / joueur 2 : scores de chaque manche séparés par des virgules. */
  set1: string;
  set2: string;
  /** 0 ou 1 = joueur en tête (manches gagnées, puis total de points) ; undefined = égalité. */
  leader?: 0 | 1;
}

/** `2-1` (une manche) ou `3-1,2-4,3-0` (une paire par manche). Le premier chiffre est celui du joueur 1. */
export function parseScore(text: string): ParsedScore {
  const normalised = text.trim().replace(/\s*([-:])\s*/g, "$1");
  const parts = normalised.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new UsageError("Score vide : attendu « 2-1 » ou « 3-1,2-4,3-0 ».");
  const sets: [number, number][] = parts.map(part => {
    const match = /^(\d+)[-:](\d+)$/.exec(part);
    if (!match) throw new UsageError(`Score invalide : « ${part} » (attendu « 2-1 », premier chiffre = joueur 1).`);
    return [Number(match[1]), Number(match[2])];
  });
  const wins = [0, 0];
  const totals = [0, 0];
  for (const [a, b] of sets) {
    if (a > b) wins[0]! += 1;
    else if (b > a) wins[1]! += 1;
    totals[0]! += a;
    totals[1]! += b;
  }
  let leader: 0 | 1 | undefined;
  if (wins[0]! !== wins[1]!) leader = wins[0]! > wins[1]! ? 0 : 1;
  else if (totals[0]! !== totals[1]!) leader = totals[0]! > totals[1]! ? 0 : 1;
  return {
    sets,
    set1: sets.map(s => s[0]).join(","),
    set2: sets.map(s => s[1]).join(","),
    leader,
  };
}

export interface MatchPlayers {
  player1?: string;
  player2?: string;
}

/** Joueurs d'un match : `relationships` (placé dans `attributes` d'après le schéma, ou à la racine selon JSON:API). */
export function matchPlayers(match: Match): MatchPlayers {
  const relationships =
    match.attributes.relationships ??
    (
      match as unknown as {
        relationships?: Match["attributes"]["relationships"];
      }
    ).relationships ??
    {};
  const fromRel = (key: string): string | undefined => {
    const id = relationships[key]?.data?.id;
    return id === undefined || id === null ? undefined : String(id);
  };
  let player1 = fromRel("player1");
  let player2 = fromRel("player2");
  const points = match.attributes.points_by_participant;
  if ((!player1 || !player2) && Array.isArray(points)) {
    player1 ??= points[0] ? String(points[0].participant_id) : undefined;
    player2 ??= points[1] ? String(points[1].participant_id) : undefined;
  }
  return { player1, player2 };
}

const MATCH_ID = /^\d{5,}$/;

/** Retrouve un match par ID numérique ou par identifiant de bracket (A, B… AA) sans appel inutile. */
export async function findMatch(client: ChallongeClient, tournamentId: string, ref: string): Promise<Match> {
  const wanted = ref.trim();
  if (MATCH_ID.test(wanted)) return client.getMatch(tournamentId, wanted);
  const identifier = wanted.toUpperCase();
  const pick = (matches: Match[]) =>
    matches.find(m => String(m.attributes.identifier ?? "").toUpperCase() === identifier);
  const open = pick(await client.listMatches(tournamentId, "open"));
  if (open) return open;
  const any = pick(await client.listMatches(tournamentId));
  if (any) return any;
  throw new UsageError(
    `Match « ${ref} » introuvable (identifiant de bracket ou ID numérique ; voir « challonge matches »).`,
  );
}

export interface ReportOptions {
  /** `1`, `2` (joueur 1/2), ID de participant ou nom. */
  winner?: string;
  tie?: boolean;
  /** Autorise un gagnant dont le score est inférieur. */
  force?: boolean;
}

export interface ReportResult {
  matchId: string;
  identifier?: string;
  players: MatchPlayers;
  score: ParsedScore;
  winnerId?: string;
  tie: boolean;
  state?: string;
}

async function resolveWinner(
  client: ChallongeClient,
  tournamentId: string,
  wanted: string,
  players: Required<MatchPlayers>,
  knownNames?: (id: string) => string | undefined,
): Promise<0 | 1> {
  const text = wanted.trim();
  if (/^(1|p1|j1|joueur1)$/i.test(text)) return 0;
  if (/^(2|p2|j2|joueur2)$/i.test(text)) return 1;
  if (text === players.player1) return 0;
  if (text === players.player2) return 1;
  if (/^\d{5,}$/.test(text)) throw new UsageError(`--winner ${text} : ce participant ne joue pas ce match.`);
  const lower = text.toLocaleLowerCase();
  const names = [0, 1].map(i => knownNames?.(i === 0 ? players.player1 : players.player2));
  for (const i of [0, 1] as const) if (names[i]?.toLocaleLowerCase() === lower) return i;
  const participants = await client.listParticipants(tournamentId);
  const nameOf = (id: string) => participants.find(p => String(p.id) === id)?.attributes.name?.toLocaleLowerCase();
  if (nameOf(players.player1) === lower) return 0;
  if (nameOf(players.player2) === lower) return 1;
  throw new UsageError(
    `--winner « ${wanted} » ne correspond à aucun des deux joueurs du match (utilisez 1, 2, un ID ou le nom exact).`,
  );
}

/** Saisit un score : retrouve le match, désigne le gagnant, envoie `PUT /matches/{id}`. */
export async function reportMatch(
  client: ChallongeClient,
  tournamentId: string,
  matchRef: string,
  scoreText: string,
  options: ReportOptions = {},
  knownNames?: (participantId: string) => string | undefined,
): Promise<ReportResult> {
  const score = parseScore(scoreText);
  if (options.tie && options.winner) throw new UsageError("--tie et --winner s'excluent mutuellement.");

  let matchId: string;
  let identifier: string | undefined;
  let players: MatchPlayers;
  let state: string | undefined;
  if (client.dryRun) {
    // Plan seulement : on montre la recherche, puis l'envoi avec des identifiants fictifs pour les joueurs.
    if (MATCH_ID.test(matchRef.trim())) {
      matchId = matchRef.trim();
      await client.getMatch(tournamentId, matchId);
    } else {
      matchId = "MATCH_ID";
      await client.listMatches(tournamentId, "open");
    }
    players = { player1: "PLAYER1_ID", player2: "PLAYER2_ID" };
  } else {
    const match = await findMatch(client, tournamentId, matchRef);
    matchId = String(match.id);
    identifier = match.attributes.identifier;
    players = matchPlayers(match);
    state = match.attributes.state;
    if (state === "pending")
      throw new UsageError(
        `Le match ${identifier ?? matchId} n'est pas encore jouable (joueurs inconnus : en attente des matchs précédents).`,
      );
  }
  if (!players.player1 || !players.player2)
    throw new UsageError(`Le match ${identifier ?? matchId} n'a pas ses deux joueurs.`);
  const both = { player1: players.player1, player2: players.player2 };

  let winnerIndex: 0 | 1 | undefined;
  if (options.tie) {
    if (score.leader !== undefined) throw new UsageError("--tie demandé alors que les scores ne sont pas égaux.");
  } else if (options.winner !== undefined) {
    winnerIndex =
      client.dryRun && !/^(1|2|p1|p2)$/i.test(options.winner.trim())
        ? undefined
        : await resolveWinner(client, tournamentId, options.winner, both, knownNames);
    if (winnerIndex !== undefined && score.leader !== undefined && score.leader !== winnerIndex && !options.force) {
      throw new UsageError("Le gagnant désigné a le score le plus bas : corrigez le score ou ajoutez --force.");
    }
  } else if (score.leader !== undefined) {
    winnerIndex = score.leader;
  } else {
    throw new UsageError("Score à égalité : précisez --winner 1|2 (ou --tie pour un match nul en round robin/swiss).");
  }

  const entry = (id: string, scores: string, index: 0 | 1) => ({
    participant_id: id,
    score_set: scores,
    ...(winnerIndex === index ? { advancing: true } : {}),
  });
  const attributes: Record<string, unknown> = {
    match: [entry(both.player1, score.set1, 0), entry(both.player2, score.set2, 1)],
  };
  if (options.tie) attributes.tie = true;
  const updated = await client.updateMatch(tournamentId, matchId, attributes);
  return {
    matchId,
    identifier,
    players,
    score,
    winnerId: winnerIndex === undefined ? undefined : winnerIndex === 0 ? both.player1 : both.player2,
    tie: !!options.tie,
    state: updated?.attributes?.state,
  };
}
