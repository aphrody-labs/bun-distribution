/**
 * Exécuteur HTTP des interactions Discord — la moitié Bun du bot sans passerelle.
 *
 * ── LE CHEMIN D'UNE INTERACTION ────────────────────────────────────────────
 * Discord poste chaque interaction sur l'endpoint HTTP de l'application, servi
 * par `crates/aphrody-rg-server` (fonction Rust Vercel). Celle-ci vérifie la
 * signature Ed25519, répond elle-même au PING, puis transmet le corps BRUT ici
 * avec `X-Internal-Secret`. On reconstruit l'interaction discord.js, on la donne
 * à `client.executeInteraction` — exactement les mêmes modules de commandes que
 * le bot de passerelle (`PROFIL.modules`) — et on renvoie la PREMIÈRE réponse
 * (le corps du callback que discord.js aurait posté) dans la réponse HTTP. Le
 * Rust la relaie à Discord : un seul aller-retour, aucun appel REST de plus.
 *
 * ── LE BUDGET ──────────────────────────────────────────────────────────────
 * Discord donne trois secondes, le Rust en garde 2,5 pour nous. Si la commande
 * n'a pas répondu au bout de `RG_INTERACTIONS_EXECUTOR_BUDGET_MS` (2 s), on
 * rend `202` : le Rust acquitte en différé (type 5 pour une commande ou une
 * modale, 6 pour un composant, choix vides pour l'autocomplétion). La commande
 * continue sous `waitUntil` ; ses réponses tardives sont traduites en appels de
 * webhook (édition de `@original` ou message de suivi), parce qu'un second
 * callback serait refusé par Discord (`40060`).
 *
 * ── SANS PASSERELLE ────────────────────────────────────────────────────────
 * Le client n'appelle jamais `login()` : seul le jeton REST est posé. Les
 * guildes ne sont donc pas en cache ; on charge celle de l'interaction par
 * REST avant de construire l'objet, pour que `interaction.guild` et
 * `interaction.member` soient des structures discord.js et non des objets
 * bruts. Les commandes qui supposent un cache rempli par la passerelle
 * (membres, présences) doivent passer par `fetch()`.
 */
import "reflect-metadata";
import { timingSafeEqual } from "node:crypto";

import {
  createProductionCacheOptions,
  safeExecuteInteraction,
} from "@aphrody/discord-kit";
import { waitUntil } from "@vercel/functions";
import {
  ClientApplication,
  ClientUser,
  DiscordAPIError,
  Events,
  InteractionResponseType,
  InteractionType,
  Partials,
  Routes,
  type APIInteraction,
  type APIUser,
  type BaseInteraction,
} from "discord.js";
import { Client } from "discordx";

import { DISCORD_TOKEN, GUILD_IDS, PROFIL } from "../lib/config";
import { MODULE_LOADERS } from "../modules";

/** Temps laissé à la commande pour sa première réponse avant de rendre `202`. */
const BUDGET_MS = borne(
  Number(Bun.env.RG_INTERACTIONS_EXECUTOR_BUDGET_MS ?? 2_000),
  200,
  2_400,
);

/** Délai maximal du chargement de la guilde par REST, pris sur le budget. */
const GUILDE_MS = 700;

/** Erreurs Discord d'un webhook pas encore utilisable (acquittement en vol). */
const CODES_WEBHOOK_PAS_PRET = new Set([10_008, 10_015]);

const ROUTE_CALLBACK = /^\/interactions\/(\d+)\/([^/]+)\/callback$/;
const ROUTE_WEBHOOK = /^\/webhooks\/(\d+)\/([^/]+)(\/.*)?$/;

function borne(valeur: number, min: number, max: number): number {
  return Number.isFinite(valeur) ? Math.min(max, Math.max(min, valeur)) : max;
}

type Phase = "initiale" | "repondue" | "differee";

interface Suivi {
  id: string;
  applicationId: string;
  token: string;
  type: InteractionType;
  phase: Phase;
  /** Résout la réponse HTTP : un corps de callback, ou `null` pour `202`. */
  repondre(corps: unknown): void;
}

/** Interactions en cours, par identifiant et par jeton de webhook. */
const suivisParId = new Map<string, Suivi>();
const suivisParJeton = new Map<string, Suivi>();

interface RequeteRest {
  fullRoute: `/${string}`;
  method: string;
  body?: unknown;
  files?: unknown[];
  auth?: boolean;
  query?: URLSearchParams;
  [cle: string]: unknown;
}

type RequeteRestFn = (options: RequeteRest) => Promise<unknown>;

const attendre = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Rejoue un appel de webhook tant que Discord n'a pas encore enregistré
 * l'acquittement relayé par le Rust (la course dure quelques centaines de ms).
 */
async function avecReprise<T>(appel: () => Promise<T>): Promise<T> {
  for (let essai = 0; ; essai++) {
    try {
      return await appel();
    } catch (err) {
      if (
        essai >= 5 ||
        !(err instanceof DiscordAPIError) ||
        !CODES_WEBHOOK_PAS_PRET.has(Number(err.code))
      ) {
        throw err;
      }
      await attendre(250 * (essai + 1));
    }
  }
}

/** Callback qui acquitte sans contenu : il n'y a plus rien à envoyer après un différé. */
function estAcquittement(type: number): boolean {
  return (
    type === InteractionResponseType.DeferredChannelMessageWithSource ||
    type === InteractionResponseType.DeferredMessageUpdate
  );
}

/** Équivalent différé d'un callback qui porte des fichiers (impossibles à relayer en JSON). */
function differeDe(type: number): number {
  return type === InteractionResponseType.UpdateMessage
    ? InteractionResponseType.DeferredMessageUpdate
    : InteractionResponseType.DeferredChannelMessageWithSource;
}

/**
 * Traduit un callback reçu APRÈS l'acquittement (différé du Rust ou fichiers)
 * en appel de webhook. Discord refuserait un second callback.
 */
async function rejouerEnWebhook(
  original: RequeteRestFn,
  suivi: Suivi,
  options: RequeteRest,
): Promise<unknown> {
  const corps = (options.body ?? {}) as {
    type?: number;
    data?: Record<string, unknown>;
  };
  const type = Number(corps.type);
  if (estAcquittement(type)) {
    return undefined;
  }
  if (
    type !== InteractionResponseType.ChannelMessageWithSource &&
    type !== InteractionResponseType.UpdateMessage
  ) {
    // Modale ou choix d'autocomplétion : leur fenêtre est close, rien ne peut les remplacer.
    console.warn(
      `[rg-interactions] callback de type ${type} trop tardif pour ${suivi.id}, ignoré.`,
    );
    return undefined;
  }
  // Après un `deferUpdate` (composant), une RÉPONSE est un nouveau message : un
  // suivi. L'écrire dans `@original` écraserait le message qui porte le bouton.
  const suiviMessage =
    type === InteractionResponseType.ChannelMessageWithSource &&
    suivi.type === InteractionType.MessageComponent;
  const { body: _corps, query: _requete, ...reste } = options;
  return avecReprise(() =>
    suiviMessage
      ? original({
          ...reste,
          method: "POST",
          fullRoute: Routes.webhook(suivi.applicationId, suivi.token),
          body: corps.data ?? {},
          auth: false,
        })
      : original({
          ...reste,
          method: "PATCH",
          fullRoute: Routes.webhookMessage(
            suivi.applicationId,
            suivi.token,
            "@original",
          ),
          body: corps.data ?? {},
          auth: false,
        }),
  );
}

/**
 * Pose l'aiguillage sur `client.rest.request`, par où passent TOUS les appels
 * de discord.js (`post`, `patch`… n'en sont que des alias).
 */
function intercepterRest(client: Client): void {
  const rest = client.rest as unknown as { request: RequeteRestFn };
  const original: RequeteRestFn = rest.request.bind(client.rest);

  rest.request = async (options: RequeteRest) => {
    const callback = ROUTE_CALLBACK.exec(options.fullRoute);
    if (callback) {
      const suivi = suivisParId.get(callback[1]!);
      if (!suivi) {
        return original(options);
      }
      if (suivi.phase === "initiale") {
        suivi.phase = "repondue";
        const corps = options.body as { type: number };
        if (options.files?.length) {
          // Un callback multipart ne se relaie pas en JSON : on acquitte en
          // différé, puis on livre le contenu et ses fichiers par le webhook.
          suivi.repondre({ type: differeDe(corps.type) });
          return rejouerEnWebhook(original, suivi, options);
        }
        suivi.repondre(corps);
        return undefined;
      }
      if (suivi.phase === "differee") {
        return rejouerEnWebhook(original, suivi, options);
      }
      return original(options);
    }

    const webhook = ROUTE_WEBHOOK.exec(options.fullRoute);
    if (webhook && suivisParJeton.has(webhook[2]!)) {
      // `editReply`/`followUp` juste après la première réponse : elle est
      // peut-être encore en route via le Rust.
      return avecReprise(() => original(options));
    }
    return original(options);
  };
}

/**
 * Charge les modules du profil pour leurs décorateurs, dans l'ordre, comme
 * `src/index.ts`. Les événements de passerelle (`events/*`) ne sont pas chargés :
 * sans passerelle, ils n'auraient jamais rien à écouter.
 */
async function chargerModules(chemins: readonly string[]): Promise<void> {
  for (const chemin of chemins) {
    try {
      const loader = MODULE_LOADERS[chemin];
      if (loader) {
        await loader();
      } else {
        await import(`../${chemin}`);
      }
    } catch (err) {
      console.error(
        `✗ profil « ${PROFIL.nom} » : échec du chargement de src/${chemin} —`,
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      throw err;
    }
  }
}

async function construireClient(): Promise<Client> {
  if (!DISCORD_TOKEN) {
    throw new Error(
      `profil « ${PROFIL.nom} » : aucun jeton Discord, l'exécuteur ne peut pas répondre.`,
    );
  }
  const client = new Client({
    intents: [],
    partials: [Partials.GuildMember, Partials.User],
    silent: true,
    botId: PROFIL.identifiantBot,
    ...createProductionCacheOptions(),
    ...(PROFIL.porteeCommandes === "guildes"
      ? { botGuilds: [...GUILD_IDS] }
      : {}),
  });
  client.rest.setToken(DISCORD_TOKEN);
  // `token` est posé par `login()` ; certains appels (webhooks, `client.token`)
  // le lisent directement.
  (client as unknown as { token: string }).token = DISCORD_TOKEN;
  intercepterRest(client);

  await chargerModules(PROFIL.modules);
  await client.build();

  // `client.user` et `client.application` viennent d'ordinaire du READY de la passerelle.
  const moi = (await client.rest.get(Routes.user("@me"))) as APIUser;
  const mutable = client as unknown as {
    user: ClientUser;
    application: ClientApplication;
  };
  mutable.user = new (
    ClientUser as unknown as new (c: Client, d: APIUser) => ClientUser
  )(client, moi);
  mutable.application = new (
    ClientApplication as unknown as new (
      c: Client,
      d: { id: string },
    ) => ClientApplication
  )(client, { id: Bun.env.DISCORD_CLIENT_ID ?? moi.id });
  console.log(
    `✓ exécuteur d'interactions prêt — profil « ${PROFIL.nom} », ${PROFIL.modules.length} module(s).`,
  );
  return client;
}

let clientPromesse: Promise<Client> | null = null;

/** Client unique par instance chaude ; un échec de construction n'est pas mis en cache. */
function obtenirClient(): Promise<Client> {
  clientPromesse ??= construireClient().catch((err) => {
    clientPromesse = null;
    throw err;
  });
  return clientPromesse;
}

/** Met la guilde de l'interaction en cache, sans dépasser `GUILDE_MS`. */
async function prechargerGuilde(
  client: Client,
  guildId: string | undefined,
): Promise<void> {
  if (!guildId || client.guilds.cache.has(guildId)) {
    return;
  }
  await Promise.race([
    client.guilds.fetch(guildId).catch((err) => {
      console.warn(
        `[rg-interactions] guilde ${guildId} non chargée :`,
        err instanceof Error ? err.message : err,
      );
    }),
    attendre(GUILDE_MS),
  ]);
}

/** Construit l'interaction discord.js comme le ferait l'événement de passerelle. */
function creerInteraction(
  client: Client,
  donnees: APIInteraction,
): BaseInteraction | null {
  let creee: BaseInteraction | null = null;
  const capter = (interaction: BaseInteraction) => {
    creee = interaction;
  };
  client.once(Events.InteractionCreate, capter);
  try {
    (
      client as unknown as {
        actions: { InteractionCreate: { handle(d: unknown): void } };
      }
    ).actions.InteractionCreate.handle(donnees);
  } finally {
    client.off(Events.InteractionCreate, capter);
  }
  return creee;
}

function secretValide(recu: string | null): boolean {
  const attendu = Bun.env.RG_INTERNAL_SECRET;
  if (!attendu || !recu) {
    return false;
  }
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Marque de `premiereReponse` : le client n'a pas pu être construit. */
const CLIENT_INDISPONIBLE = Symbol("client-indisponible");

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Point d'entrée HTTP : `POST /v1/discord/interactions/execute`.
 *
 * Réponses : `200` + corps de callback, `202` (le Rust acquitte en différé),
 * `401` secret invalide, `400` corps illisible, `503` client indisponible.
 */
export async function executerInteractionDiscord(
  request: Request,
): Promise<Response> {
  // Le budget court depuis l'arrivée : un démarrage à froid le consomme aussi.
  const debut = performance.now();
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!secretValide(request.headers.get("x-internal-secret"))) {
    return json({ error: "unauthorized" }, 401);
  }

  let donnees: APIInteraction;
  try {
    donnees = (await request.json()) as APIInteraction;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (
    !donnees?.id ||
    !donnees.token ||
    !donnees.application_id ||
    typeof donnees.type !== "number"
  ) {
    return json({ error: "invalid_interaction" }, 400);
  }
  if (donnees.type === InteractionType.Ping) {
    return json({ type: InteractionResponseType.Pong });
  }

  let repondre!: (corps: unknown) => void;
  const premiereReponse = new Promise<unknown>((resolve) => {
    repondre = resolve;
  });
  const suivi: Suivi = {
    id: donnees.id,
    applicationId: donnees.application_id,
    token: donnees.token,
    type: donnees.type,
    phase: "initiale",
    repondre,
  };
  suivisParId.set(suivi.id, suivi);
  suivisParJeton.set(suivi.token, suivi);

  const execution = (async () => {
    let client: Client;
    try {
      // Dans l'exécution, pas avant : un démarrage à froid plus long que le
      // budget doit finir en `202` (différé), pas en réponse perdue.
      client = await obtenirClient();
    } catch (err) {
      console.error(
        "[rg-interactions] client indisponible :",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      suivi.repondre(CLIENT_INDISPONIBLE);
      suivisParId.delete(suivi.id);
      suivisParJeton.delete(suivi.token);
      return;
    }
    try {
      await prechargerGuilde(client, donnees.guild_id);
      const interaction = creerInteraction(client, donnees);
      if (!interaction) {
        console.warn(
          `[rg-interactions] interaction ${donnees.id} de type ${donnees.type} non prise en charge.`,
        );
        return;
      }
      await safeExecuteInteraction(
        client,
        interaction as Parameters<typeof safeExecuteInteraction>[1],
        {
          failureMessage:
            "❌ La commande a échoué. Le détail est dans le journal du service.",
          unhandledMessage:
            "Commande inconnue ou expirée. Recharge Discord (Ctrl+R) pour rafraîchir la liste.",
        },
      );
    } catch (err) {
      console.error(
        `[rg-interactions] exécution de ${donnees.id} :`,
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
    } finally {
      // Aucune réponse du tout (autocomplétion sans gestionnaire…) : le Rust acquitte.
      suivi.repondre(null);
      // Le jeton d'interaction vit 15 minutes ; au-delà, plus rien ne peut l'utiliser.
      setTimeout(() => {
        suivisParId.delete(suivi.id);
        suivisParJeton.delete(suivi.token);
      }, 15 * 60_000).unref?.();
    }
  })();
  waitUntil(execution);

  const restant = Math.max(0, BUDGET_MS - (performance.now() - debut));
  const corps = await Promise.race([
    premiereReponse,
    attendre(restant).then(() => null),
  ]);
  if (corps === CLIENT_INDISPONIBLE) {
    return json({ error: "executor_unavailable" }, 503);
  }
  if (corps === null) {
    // Bascule atomique : un callback arrivé après ce point passera par le webhook.
    if (suivi.phase === "initiale") {
      suivi.phase = "differee";
    }
    if (suivi.phase === "differee") {
      return new Response(null, { status: 202 });
    }
  }
  const tardif = corps ?? (await premiereReponse);
  return tardif === CLIENT_INDISPONIBLE
    ? json({ error: "executor_unavailable" }, 503)
    : json(tardif);
}
