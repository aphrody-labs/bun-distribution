import { UsageError } from "../../../shared/args.ts";
import { COMMAND_NAME, commandDefinitions, REGISTER_PREFIX } from "./bot-commands.ts";
import { ChallongeClient, ChallongeError, type Participant } from "./client.ts";
import { authOf, type ChallongeConfig, secretsOf } from "./config.ts";
import {
  type CommandOption,
  DiscordError,
  type DiscordMember,
  DiscordRest,
  ephemeral,
  type Interaction,
  type MessageData,
  plain,
} from "./discord.ts";
import { FALLBACK_GATEWAY, Gateway, GatewayFatalError, INTENT_GUILDS } from "./gateway.ts";
import { errorText, redact } from "./http.ts";
import type { Io } from "./io.ts";
import { BULK_LIMIT, chunk, shuffle, type SeedEntry } from "./participants.ts";
import { defaultStatePath, type PlayerRef, StateStore, type TournamentRef } from "./state.ts";
import { assertSlug, createTournamentFlow, normalizeType, reportMatch, TYPE_LABEL } from "./tournaments.ts";

export interface BotConfig {
  guildId: string;
  organiserRoleId?: string;
  batchRegistrations: boolean;
  defaultGame?: string;
  community?: string;
}

export interface BotContext {
  config: BotConfig;
  challonge: ChallongeClient;
  discord: DiscordRest;
  state: StateStore;
  log: (message: string) => void;
  random: () => number;
  /** Inscriptions en cours (évite qu'un double clic crée deux participants). */
  inflight: Set<string>;
}

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const COLOR = 0xf26e22;

/**
 * Rôle organisateur configuré (ORGANISER_ROLE_ID) ou, à défaut, permission « Gérer le serveur ».
 * Un administrateur du serveur passe toujours.
 */
export function isOrganiser(config: BotConfig, member?: DiscordMember): boolean {
  if (!member) return false;
  let permissions = 0n;
  try {
    permissions = BigInt(member.permissions ?? "0");
  } catch {
    // champ illisible : on ne déduit aucun droit
  }
  if (permissions & ADMINISTRATOR) return true;
  if (config.organiserRoleId) return member.roles?.includes(config.organiserRoleId) ?? false;
  return (permissions & MANAGE_GUILD) !== 0n;
}

function optionValues(options?: CommandOption[]): Map<string, string | number | boolean> {
  const map = new Map<string, string | number | boolean>();
  for (const option of options ?? []) if (option.value !== undefined) map.set(option.name, option.value);
  return map;
}

function text(values: Map<string, string | number | boolean>, name: string): string | undefined {
  const value = values.get(name);
  return value === undefined || value === "" ? undefined : String(value).trim() || undefined;
}

export async function handleInteraction(ctx: BotContext, interaction: Interaction): Promise<void> {
  try {
    if (interaction.guild_id !== ctx.config.guildId) {
      await ctx.discord.respond(interaction, ephemeral("Ce bot n'est pas configuré pour ce serveur."));
      return;
    }
    if (interaction.type === 2 && interaction.data?.name === COMMAND_NAME) return await onCommand(ctx, interaction);
    if (interaction.type === 3 && interaction.data?.custom_id?.startsWith(REGISTER_PREFIX))
      return await onRegisterButton(ctx, interaction);
  } catch (error) {
    ctx.log(`Interaction ${interaction.id} : ${errorText(error)}`);
  }
}

async function onCommand(ctx: BotContext, interaction: Interaction): Promise<void> {
  const sub = interaction.data?.options?.[0];
  if (!sub)
    return ctx.discord.respond(
      interaction,
      ephemeral("Sous-commande manquante : creer, inscrire, demarrer, score, terminer ou bracket."),
    );
  const values = optionValues(sub.options);

  if (sub.name === "bracket") return showBracket(ctx, interaction);
  if (sub.name === "inscrire") {
    return deferred(ctx, interaction, async () => ({
      reply: await register(ctx, interaction, await activeTournament(ctx), text(values, "pseudo")),
    }));
  }
  if (!["creer", "demarrer", "score", "terminer"].includes(sub.name)) {
    return ctx.discord.respond(interaction, ephemeral(`Sous-commande inconnue : ${sub.name}.`));
  }
  // Contrôle de rôle AVANT tout travail : la réponse part dans les 3 s imposées par Discord.
  if (!isOrganiser(ctx.config, interaction.member)) {
    const who = ctx.config.organiserRoleId
      ? `le rôle <@&${ctx.config.organiserRoleId}>`
      : "la permission « Gérer le serveur »";
    return ctx.discord.respond(interaction, ephemeral(`Commande réservée aux organisateurs (${who}).`));
  }
  switch (sub.name) {
    case "creer":
      return deferred(ctx, interaction, () => create(ctx, interaction, values));
    case "demarrer":
      return deferred(ctx, interaction, () => start(ctx, values.get("melanger") === true));
    case "score":
      return deferred(ctx, interaction, () => score(ctx, values));
    default:
      return deferred(ctx, interaction, () => finish(ctx));
  }
}

async function onRegisterButton(ctx: BotContext, interaction: Interaction): Promise<void> {
  const tournamentId = interaction.data?.custom_id?.slice(REGISTER_PREFIX.length) ?? "";
  await deferred(ctx, interaction, async () => {
    const tournament = await activeTournament(ctx);
    if (tournament.id !== tournamentId)
      throw new UsageError("Ce bouton appartient à un ancien tournoi : utilisez /tournoi inscrire.");
    return { reply: await register(ctx, interaction, tournament) };
  });
}

interface Done {
  reply: string;
  /** Message public posté dans le salon en plus de la confirmation éphémère. */
  announce?: MessageData;
}

/**
 * Accuse réception de façon éphémère (réponse différée, dans les 3 s), travaille, puis édite la réponse.
 * Les erreurs sont toujours éphémères ; l'annonce publique n'est envoyée qu'en cas de succès.
 */
async function deferred(ctx: BotContext, interaction: Interaction, work: () => Promise<Done>): Promise<void> {
  try {
    await ctx.discord.defer(interaction, true);
  } catch (error) {
    ctx.log(`Impossible d'accuser réception de ${interaction.id} : ${errorText(error)}`);
    return;
  }
  try {
    const done = await work();
    await ctx.discord.editOriginal(interaction, plain(done.reply));
    if (done.announce) await ctx.discord.followup(interaction, done.announce);
  } catch (error) {
    const message = userMessage(ctx, error);
    await ctx.discord
      .editOriginal(interaction, plain(message))
      .catch(e => ctx.log(`Réponse d'erreur impossible : ${errorText(e)}`));
  }
}

/** " <nom>" ou chaîne vide, pour des phrases correctes même sans nom. */
function named(tournament: TournamentRef): string {
  return tournament.name ? ` ` : "";
}

function userMessage(ctx: BotContext, error: unknown): string {
  if (error instanceof UsageError || error instanceof ChallongeError) return error.message;
  if (error instanceof DiscordError) return `Erreur Discord : ${error.message}`;
  ctx.log(`Erreur interne : ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return "Erreur interne : l'opération a échoué (détails dans les journaux du bot).";
}

async function activeTournament(ctx: BotContext): Promise<TournamentRef> {
  const state = await ctx.state.read();
  const tournament = state.guilds[ctx.config.guildId]?.tournament;
  if (!tournament) throw new UsageError("Aucun tournoi en cours : un organisateur doit lancer /tournoi creer.");
  return tournament;
}

async function showBracket(ctx: BotContext, interaction: Interaction): Promise<void> {
  try {
    const tournament = await activeTournament(ctx);
    await ctx.discord.respond(interaction, {
      content: `Bracket de ${tournament.name ?? "tournoi"} : ${tournament.bracketUrl ?? "(lien indisponible)"}`,
      allowed_mentions: { parse: [] },
    });
  } catch (error) {
    await ctx.discord.respond(interaction, ephemeral(userMessage(ctx, error)));
  }
}

// --- Création ---------------------------------------------------------------------------------------------------

async function create(
  ctx: BotContext,
  interaction: Interaction,
  values: Map<string, string | number | boolean>,
): Promise<Done> {
  const name = text(values, "nom");
  if (!name) throw new UsageError("Le nom du tournoi est obligatoire.");
  const url = text(values, "url");
  if (url) assertSlug(url);
  const type = normalizeType(text(values, "format") ?? "single_elimination");
  const game = text(values, "jeu") ?? ctx.config.defaultGame;
  const result = await createTournamentFlow(ctx.challonge, { name, type, game, url }, [], {
    community: ctx.config.community,
  });
  const tournament = result.tournament;
  const replaced = await ctx.state.update(state => {
    const previous = state.guilds[ctx.config.guildId]?.tournament;
    state.guilds[ctx.config.guildId] = { tournament };
    state.lastTournament = tournament;
    return previous;
  });
  const author = interaction.member?.user?.username ?? "un organisateur";
  const lines = [
    `Tournoi créé : ${tournament.bracketUrl}`,
    "Les inscriptions sont ouvertes (bouton ou /tournoi inscrire).",
  ];
  if (replaced) lines.push(`Il remplace le tournoi actif précédent (${replaced.name ?? replaced.id}) pour ce serveur.`);
  return {
    reply: lines.join("\n"),
    announce: {
      embeds: [
        {
          title: name,
          url: tournament.bracketUrl,
          description: [
            `Format : ${TYPE_LABEL[type]}`,
            game ? `Jeu : ${game}` : undefined,
            "Inscriptions ouvertes : bouton ci-dessous ou /tournoi inscrire.",
          ]
            .filter(Boolean)
            .join("\n"),
          color: COLOR,
          footer: { text: `Organisé par ${author}` },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "S'inscrire",
              custom_id: `${REGISTER_PREFIX}${tournament.id}`,
            },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    },
  };
}

// --- Inscriptions -----------------------------------------------------------------------------------------------

function uniqueName(base: string, taken: Set<string>, username: string): string {
  let name = base.slice(0, 60);
  if (taken.has(name.toLocaleLowerCase())) name = `${name.slice(0, 45)} (${username})`.slice(0, 60);
  for (let n = 2; taken.has(name.toLocaleLowerCase()); n += 1) name = `${base.slice(0, 50)} ${n}`;
  return name;
}

async function register(
  ctx: BotContext,
  interaction: Interaction,
  tournament: TournamentRef,
  requested?: string,
): Promise<string> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) throw new UsageError("Utilisateur Discord introuvable dans l'interaction.");
  const key = `${tournament.id}:${user.id}`;
  if (ctx.inflight.has(key)) throw new UsageError("Ton inscription est déjà en cours de traitement.");
  ctx.inflight.add(key);
  try {
    const snapshot = await ctx.state.read();
    const known = snapshot.players[tournament.id]?.[user.id] ?? snapshot.pending[tournament.id]?.[user.id];
    if (known) throw new UsageError(`Tu es déjà inscrit·e sous le nom « ${known.name} ».`);
    const taken = new Set([
      ...Object.values(snapshot.players[tournament.id] ?? {}).map(p => p.name.toLocaleLowerCase()),
      ...Object.values(snapshot.pending[tournament.id] ?? {}).map(p => p.name.toLocaleLowerCase()),
    ]);
    const base = requested ?? interaction.member?.nick ?? user.global_name ?? user.username;
    const name = uniqueName(base, taken, user.username);

    if (ctx.config.batchRegistrations) {
      await ctx.state.update(state => {
        (state.pending[tournament.id] ??= {})[user.id] = {
          name,
          at: Date.now(),
        };
      });
      return `Inscription enregistrée sous « ${name} ». Elle sera envoyée à Challonge au démarrage du tournoi.`;
    }
    const participant = await ctx.challonge.addParticipant(tournament.id, {
      name,
      misc: `discord:${user.id}`,
    });
    await ctx.state.update(state => {
      (state.players[tournament.id] ??= {})[user.id] = {
        participantId: String(participant.id),
        name,
      };
    });
    return `Inscrit·e sous « ${name} ». Bracket : ${tournament.bracketUrl ?? ""}`.trim();
  } finally {
    ctx.inflight.delete(key);
  }
}

/** Envoie les inscriptions en attente par lots de 20, en persistant chaque lot réussi (reprise sûre en cas d'échec). */
async function flushPending(ctx: BotContext, tournament: TournamentRef, shuffleSeeds: boolean): Promise<number> {
  const snapshot = await ctx.state.read();
  const waiting = Object.entries(snapshot.pending[tournament.id] ?? {})
    .map(([userId, p]) => ({ userId, name: p.name, at: p.at ?? 0 }))
    .toSorted((a, b) => a.at - b.at);
  if (!waiting.length) return 0;
  const ordered = shuffleSeeds ? shuffle(waiting, ctx.random) : waiting;
  const entries: (SeedEntry & { userId: string })[] = ordered.map((w, index) => {
    const entry: SeedEntry & { userId: string } = {
      userId: w.userId,
      name: w.name,
      misc: `discord:${w.userId}`,
    };
    if (shuffleSeeds) entry.seed = index + 1;
    return entry;
  });
  let unresolved: { userId: string; name: string }[] = [];
  let sent = 0;
  for (const batch of chunk(entries, BULK_LIMIT)) {
    // oxlint-disable-next-line no-await-in-loop -- batches run in order: each state update must land before the next bulk request (Challonge rate limits)
    const created = await ctx.challonge.bulkAddParticipants(
      tournament.id,
      batch.map(e => ({
        name: e.name,
        misc: e.misc,
        ...(e.seed !== undefined ? { seed: e.seed } : {}),
      })),
    );
    const mapped: Record<string, PlayerRef> = {};
    for (const entry of batch) {
      const hit =
        created.find(p => p.attributes.misc === entry.misc) ?? created.find(p => p.attributes.name === entry.name);
      if (hit)
        mapped[entry.userId] = {
          participantId: String(hit.id),
          name: entry.name,
        };
      else unresolved.push({ userId: entry.userId, name: entry.name });
    }
    // oxlint-disable-next-line no-await-in-loop -- batches run in order: each state update must land before the next bulk request (Challonge rate limits)
    await ctx.state.update(state => {
      for (const entry of batch) {
        delete state.pending[tournament.id]?.[entry.userId];
        const ref = mapped[entry.userId];
        if (ref) (state.players[tournament.id] ??= {})[entry.userId] = ref;
      }
    });
    sent += batch.length;
  }
  if (unresolved.length) {
    // La réponse de bulk_add n'a pas permis d'associer ces joueurs : une seule lecture de la liste suffit.
    const all: Participant[] = await ctx.challonge.listParticipants(tournament.id);
    const found: Record<string, PlayerRef> = {};
    for (const u of unresolved) {
      const hit =
        all.find(p => p.attributes.misc === `discord:${u.userId}`) ?? all.find(p => p.attributes.name === u.name);
      if (hit) found[u.userId] = { participantId: String(hit.id), name: u.name };
    }
    await ctx.state.update(state => {
      for (const [userId, ref] of Object.entries(found)) (state.players[tournament.id] ??= {})[userId] = ref;
    });
    unresolved = unresolved.filter(u => !found[u.userId]);
    if (unresolved.length)
      ctx.log(`Joueurs non rattachés à un participant Challonge : ${unresolved.map(u => u.name).join(", ")}`);
  }
  return sent;
}

// --- Démarrage, scores, clôture -----------------------------------------------------------------------------------

async function start(ctx: BotContext, shuffleSeeds: boolean): Promise<Done> {
  const tournament = await activeTournament(ctx);
  let sent = 0;
  if (ctx.config.batchRegistrations) sent = await flushPending(ctx, tournament, shuffleSeeds);
  else if (shuffleSeeds) await ctx.challonge.randomizeParticipants(tournament.id);
  await ctx.challonge.changeState(tournament.id, "start");
  const link = tournament.bracketUrl ?? "";
  return {
    reply: `Tournoi démarré${sent ? ` (${sent} inscription(s) envoyée(s) à Challonge)` : ""}. ${link}`.trim(),
    announce: {
      content: `Le tournoi${named(tournament)} est lancé ! Bracket : ${link}`,
      allowed_mentions: { parse: [] },
    },
  };
}

async function score(ctx: BotContext, values: Map<string, string | number | boolean>): Promise<Done> {
  const tournament = await activeTournament(ctx);
  const matchRef = text(values, "match");
  const scoreText = text(values, "score");
  if (!matchRef || !scoreText)
    throw new UsageError("Indiquez le match et le score (ex. /tournoi score match:A score:2-1).");
  const winnerUser = text(values, "gagnant");
  const state = await ctx.state.read();
  const roster = state.players[tournament.id] ?? {};
  const nameOf = (participantId: string) => Object.values(roster).find(p => p.participantId === participantId)?.name;
  let winner: string | undefined;
  if (winnerUser) {
    winner = roster[winnerUser]?.participantId;
    if (!winner)
      throw new UsageError(
        "Ce joueur n'est pas inscrit via le bot : retirez « gagnant » (le score le plus haut gagne) ou utilisez le site Challonge.",
      );
  }
  const result = await reportMatch(
    ctx.challonge,
    tournament.id,
    matchRef,
    scoreText,
    { winner, tie: values.get("egalite") === true },
    nameOf,
  );
  const label = (id: string | undefined, fallback: string) => (id ? (nameOf(id) ?? fallback) : fallback);
  const p1 = label(result.players.player1, "Joueur 1");
  const p2 = label(result.players.player2, "Joueur 2");
  const sets = result.score.sets.map(([a, b]) => `${a}-${b}`).join(", ");
  const outcome = result.tie ? "match nul" : result.winnerId ? `gagnant : ${label(result.winnerId, "?")}` : "";
  const line = `Match ${result.identifier ?? result.matchId} : ${p1} ${sets} ${p2}${outcome ? ` (${outcome})` : ""}`;
  return {
    reply: `Score enregistré. ${line}`,
    announce: { content: line, allowed_mentions: { parse: [] } },
  };
}

async function finish(ctx: BotContext): Promise<Done> {
  const tournament = await activeTournament(ctx);
  await ctx.challonge.changeState(tournament.id, "finalize");
  await ctx.state.update(state => {
    delete state.guilds[ctx.config.guildId];
  });
  const link = tournament.bracketUrl ?? "";
  return {
    reply: `Tournoi clôturé. Classement final : ${link}`.trim(),
    announce: {
      content: `Le tournoi${named(tournament)} est terminé ! Résultats : ${link}`,
      allowed_mentions: { parse: [] },
    },
  };
}

// --- Exécution (Gateway) -----------------------------------------------------------------------------------------

export interface RunBotOptions {
  /** Enregistre `/tournoi` sur le serveur au démarrage (défaut : oui). */
  register?: boolean;
}

export function botConfigOf(config: ChallongeConfig): {
  bot: BotConfig;
  token: string;
  appId: string;
} {
  const d = config.discord;
  const missing = [
    !d.token && "DISCORD_TOKEN",
    !d.appId && "DISCORD_APP_ID",
    !d.guildId && "DISCORD_GUILD_ID",
    !config.apiKey && !config.oauthToken && "CHALLONGE_API_KEY",
  ].filter(Boolean);
  if (missing.length) throw new UsageError(`Variables manquantes pour le bot : ${missing.join(", ")}.`);
  return {
    token: d.token!,
    appId: d.appId!,
    bot: {
      guildId: d.guildId!,
      organiserRoleId: d.organiserRoleId,
      batchRegistrations: d.batchRegistrations,
      defaultGame: config.game,
      community: config.communityId,
    },
  };
}

/** Lance le bot jusqu'à l'arrêt (`io.signal`) ou une erreur Gateway définitive. Renvoie le code de sortie. */
export async function runBot(io: Io, config: ChallongeConfig, options: RunBotOptions = {}): Promise<number> {
  const { bot, token, appId } = botConfigOf(config);
  const secrets = secretsOf(config);
  const log = (message: string) => io.err(`[bot] ${redact(message, secrets)}`);
  const challonge = new ChallongeClient({
    auth: authOf(config),
    fetch: io.fetch,
    sleep: io.sleep,
    random: io.random,
    community: config.communityId,
    onRetry: ({ status, attempt, waitMs }) =>
      log(`Challonge ${status} : nouvelle tentative ${attempt} dans ${waitMs} ms.`),
  });
  const discord = new DiscordRest({
    token,
    appId,
    fetch: io.fetch,
    sleep: io.sleep,
    random: io.random,
  });
  const ctx: BotContext = {
    config: bot,
    challonge,
    discord,
    state: new StateStore(defaultStatePath(config.dir)),
    log,
    random: io.random,
    inflight: new Set(),
  };
  if (!bot.organiserRoleId)
    log("ORGANISER_ROLE_ID absent : seuls les membres avec « Gérer le serveur » ou administrateur peuvent organiser.");
  if (bot.batchRegistrations)
    log("Inscriptions groupées : envoyées à Challonge par lots de 20 au démarrage du tournoi.");

  if (options.register !== false) {
    const registered = await discord.putGuildCommands(bot.guildId, commandDefinitions());
    log(`${registered.length} commande(s) enregistrée(s) sur le serveur ${bot.guildId}.`);
  }

  const gateway = new Gateway({
    token,
    intents: INTENT_GUILDS,
    getUrl: async () => {
      try {
        const info = await discord.getGatewayBot();
        if (info.session_start_limit)
          log(`Sessions Gateway restantes : ${info.session_start_limit.remaining}/${info.session_start_limit.total}.`);
        return info.url;
      } catch (error) {
        if (error instanceof DiscordError && error.status === 401) throw new GatewayFatalError(4004, error.message);
        log(`GET /gateway/bot impossible (${errorText(error)}) : URL par défaut.`);
        return FALLBACK_GATEWAY;
      }
    },
    onReady: data => log(`Connecté à la Gateway (utilisateur ${data.user?.id ?? "?"}).`),
    onDispatch: (event, data) => {
      if (event === "INTERACTION_CREATE") void handleInteraction(ctx, data as Interaction);
    },
    WebSocketImpl: io.WebSocketImpl,
    random: io.random,
    sleep: io.sleep,
    log,
    signal: io.signal,
  });
  try {
    await gateway.run();
    return 0;
  } catch (error) {
    if (error instanceof GatewayFatalError) {
      io.err(redact(error.message, secrets));
      return 1;
    }
    throw error;
  }
}
