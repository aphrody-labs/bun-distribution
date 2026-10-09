import { UsageError } from "../../../shared/args.ts";
import {
  backoffMs,
  errorText,
  type Fetch,
  realSleep,
  redact,
  retryAfterMs,
  type Sleep,
} from "./http.ts";

/** API REST Discord v10 (versions 9 et 10 « Available », 6 par défaut mais dépréciée : doc du 2026-10-06). */
export const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "DiscordBot (https://aphrody.com, 0.1.0)";

export const EPHEMERAL = 64;
/** Types de callback d'interaction (docs « Receiving and Responding »). */
export const CallbackType = { ChannelMessage: 4, DeferredChannelMessage: 5 } as const;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface DiscordMember {
  user?: DiscordUser;
  nick?: string | null;
  roles: string[];
  /** Bitfield de permissions (chaîne) de l'invoquant dans ce salon. */
  permissions?: string;
}

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
}

export interface InteractionData {
  id?: string;
  name?: string;
  type?: number;
  custom_id?: string;
  component_type?: number;
  options?: CommandOption[];
}

export interface Interaction {
  id: string;
  application_id: string;
  /** 2 = APPLICATION_COMMAND, 3 = MESSAGE_COMPONENT. */
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: InteractionData;
}

export interface MessageData {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  flags?: number;
  allowed_mentions?: unknown;
}

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

export interface RestOptions {
  token?: string;
  appId?: string;
  fetch?: Fetch;
  sleep?: Sleep;
  random?: () => number;
  baseUrl?: string;
  maxRetries?: number;
}

interface CallOptions {
  body?: unknown;
  /** Les routes d'interaction et de webhook s'authentifient par leur jeton d'URL : pas d'en-tête Bot. */
  bot?: boolean;
  /** URL absolue (webhooks fournis par l'utilisateur). */
  absolute?: string;
}

export class DiscordRest {
  private readonly token?: string;
  private readonly appId?: string;
  private readonly fetchImpl: Fetch;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(options: RestOptions = {}) {
    this.token = options.token;
    this.appId = options.appId;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? realSleep;
    this.random = options.random ?? Math.random;
    this.baseUrl = options.baseUrl ?? DISCORD_API;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async call<T>(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<T | undefined> {
    const url = options.absolute ?? this.baseUrl + path;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.bot !== false && this.token && !options.absolute)
      headers.Authorization = `Bot ${this.token}`;
    const init: RequestInit = {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    };

    for (let attempt = 0; ; attempt += 1) {
      let res: Response;
      try {
        // oxlint-disable-next-line no-await-in-loop -- Discord retries are sequential by design: each attempt waits for the rate-limit/backoff of the previous one
        res = await this.fetchImpl(url, init);
      } catch (cause) {
        throw new DiscordError(
          `Réseau injoignable (${redact(errorText(cause), [this.token])}).`,
          0,
        );
      }
      if (res.ok) {
        if (res.status === 204) return undefined;
        // oxlint-disable-next-line no-await-in-loop -- the body of this attempt is needed to return; the loop exits here
        const text = await res.text();
        return text ? (JSON.parse(text) as T) : undefined;
      }
      // oxlint-disable-next-line no-await-in-loop -- error body of this attempt is needed to decide retry or throw
      const text = await res.text().catch(() => "");
      let parsed: { message?: string; code?: number; retry_after?: number } = {};
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        // corps non JSON (page d'erreur Cloudflare…)
      }
      const retryable = res.status === 429 || (res.status >= 500 && method !== "POST");
      if (retryable && attempt < this.maxRetries) {
        const waitMs =
          res.status === 429
            ? Math.min(
                30_000,
                Math.round((parsed.retry_after ?? 0) * 1000) ||
                  retryAfterMs(res) ||
                  backoffMs(attempt, this.random),
              )
            : backoffMs(attempt, this.random);
        // oxlint-disable-next-line no-await-in-loop -- rate-limit/backoff wait before the next sequential attempt
        await this.sleep(waitMs);
        continue;
      }
      throw new DiscordError(
        redact(frenchDiscord(res.status, parsed.message, parsed.code), [this.token]),
        res.status,
        parsed.code,
      );
    }
  }

  // --- Passerelle et commandes ---------------------------------------------------------------------------------

  async getGatewayBot(): Promise<{
    url: string;
    session_start_limit?: { remaining: number; total: number; reset_after: number };
  }> {
    const res = await this.call<{
      url: string;
      session_start_limit?: { remaining: number; total: number; reset_after: number };
    }>("GET", "/gateway/bot");
    if (!res?.url) throw new DiscordError("Réponse /gateway/bot sans URL.", 0);
    return res;
  }

  /** PUT remplace TOUTES les commandes de l'application pour ce serveur (slash, utilisateur et message). */
  async putGuildCommands(guildId: string, commands: unknown[]): Promise<unknown[]> {
    if (!this.appId) throw new UsageError("DISCORD_APP_ID manquant.");
    return (
      (await this.call<unknown[]>("PUT", `/applications/${this.appId}/guilds/${guildId}/commands`, {
        body: commands,
      })) ?? []
    );
  }

  // --- Interactions (3 s pour le premier callback, jeton valable 15 min) -----------------------------------------

  async callback(interaction: Interaction, type: number, data?: MessageData): Promise<void> {
    await this.call("POST", `/interactions/${interaction.id}/${interaction.token}/callback`, {
      body: { type, data },
      bot: false,
    });
  }

  defer(interaction: Interaction, hidden: boolean): Promise<void> {
    return this.callback(
      interaction,
      CallbackType.DeferredChannelMessage,
      hidden ? { flags: EPHEMERAL } : undefined,
    );
  }

  respond(interaction: Interaction, data: MessageData): Promise<void> {
    return this.callback(interaction, CallbackType.ChannelMessage, data);
  }

  async editOriginal(interaction: Interaction, data: MessageData): Promise<void> {
    await this.call(
      "PATCH",
      `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      { body: data, bot: false },
    );
  }

  /** Nouveau message après un premier editOriginal (public sauf drapeau éphémère). */
  async followup(interaction: Interaction, data: MessageData): Promise<void> {
    await this.call("POST", `/webhooks/${interaction.application_id}/${interaction.token}`, {
      body: data,
      bot: false,
    });
  }

  // --- Webhooks d'annonce -----------------------------------------------------------------------------------------

  async executeWebhook(
    webhookUrl: string,
    data: MessageData & { username?: string },
  ): Promise<void> {
    await this.call("POST", "", { body: data, absolute: assertWebhookUrl(webhookUrl) });
  }
}

const WEBHOOK_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
]);

/** N'accepte que de vrais webhooks Discord (évite d'envoyer un message à une URL arbitraire). */
export function assertWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(
      "URL de webhook invalide (attendu https://discord.com/api/webhooks/<id>/<jeton>).",
    );
  }
  if (
    url.protocol !== "https:" ||
    !WEBHOOK_HOSTS.has(url.hostname) ||
    !/^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)
  ) {
    throw new UsageError(
      "URL de webhook invalide (attendu https://discord.com/api/webhooks/<id>/<jeton>).",
    );
  }
  return url.toString();
}

/** Masque le jeton d'un webhook pour l'affichage. */
export function redactWebhook(raw: string): string {
  return raw.replace(/(\/webhooks\/\d+\/)[\w-]+/, "$1***");
}

export function frenchDiscord(status: number, message?: string, code?: number): string {
  const detail = message ? ` (${message}${code ? `, code ${code}` : ""})` : "";
  switch (status) {
    case 401:
      return `Token Discord refusé (401)${detail} : vérifiez DISCORD_TOKEN.`;
    case 403:
      return `Permission Discord manquante (403)${detail} : le bot n'a pas le droit d'effectuer cette action ici.`;
    case 404:
      return `Ressource Discord introuvable (404)${detail} : interaction expirée, serveur ou webhook inconnu.`;
    case 429:
      return `Limite de débit Discord (429)${detail} : réessayez dans un instant.`;
    default:
      return `Erreur Discord ${status}${detail}.`;
  }
}

/** Message éphémère (visible uniquement par l'invoquant), sans mention : pour un premier callback. */
export function ephemeral(content: string): MessageData {
  return { content: content.slice(0, 2000), flags: EPHEMERAL, allowed_mentions: { parse: [] } };
}

/** Texte simple sans mention, pour éditer un message déjà différé (son caractère éphémère est figé au defer). */
export function plain(content: string): MessageData {
  return { content: content.slice(0, 2000), allowed_mentions: { parse: [] } };
}
