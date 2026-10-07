import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { UsageError } from "../../../shared/args.ts";
import type { Auth } from "./client.ts";

export interface DiscordConfig {
  token?: string;
  appId?: string;
  guildId?: string;
  organiserRoleId?: string;
  /** Inscriptions Discord regroupées et envoyées par lots de 20 au démarrage (économise le quota Challonge). */
  batchRegistrations: boolean;
}

export interface ChallongeConfig {
  /** Clé API v1 (utilisée avec `Authorization-Type: v1` sur l'API v2.1). Ne jamais l'afficher. */
  apiKey?: string;
  /** Jeton OAuth v2 (prioritaire sur la clé si présent). */
  oauthToken?: string;
  /** Sous-domaine ou permalink de la communauté Challonge propriétaire des tournois. */
  communityId?: string;
  game?: string;
  announceWebhook?: string;
  discord: DiscordConfig;
  /** Dossier de configuration (fichier challonge.json, état du bot). */
  dir: string;
  warnings: string[];
}

export const CONFIG_FILE = "challonge.json";

export function configDir(env: Record<string, string | undefined>): string {
  return env.CREATOR_KIT_CONFIG_DIR || join(homedir(), ".config", "creator-kit");
}

function str(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string")
    throw new UsageError(`${CONFIG_FILE} : « ${field} » doit être une chaîne.`);
  return value;
}

function flag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "oui", "yes"].includes(value.toLowerCase());
  return undefined;
}

async function readFileConfig(
  dir: string,
): Promise<{ data: Record<string, unknown>; warnings: string[] }> {
  const path = join(dir, CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { data: {}, warnings: [] };
    throw new UsageError(`Impossible de lire ${path} : ${(error as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${path} n'est pas du JSON valide : ${(error as Error).message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new UsageError(`${path} doit contenir un objet JSON.`);
  }
  const warnings: string[] = [];
  if (process.platform !== "win32") {
    try {
      const mode = (await stat(path)).mode & 0o777;
      if (mode & 0o077)
        warnings.push(
          `${path} est lisible par d'autres utilisateurs (chmod 600 recommandé : il peut contenir des clés).`,
        );
    } catch {
      // le fichier vient d'être lu : un échec de stat n'est pas bloquant
    }
  }
  return { data: data as Record<string, unknown>, warnings };
}

/**
 * Configuration = variables d'environnement (prioritaires) puis `~/.config/creator-kit/challonge.json`.
 * Variables : CHALLONGE_API_KEY, CHALLONGE_OAUTH_TOKEN, CHALLONGE_COMMUNITY, CHALLONGE_ANNOUNCE_WEBHOOK,
 * CHALLONGE_BATCH_REGISTRATIONS, DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID, ORGANISER_ROLE_ID.
 */
export async function loadConfig(
  env: Record<string, string | undefined>,
  dir = configDir(env),
): Promise<ChallongeConfig> {
  const { data, warnings } = await readFileConfig(dir);
  const discordFile = (
    typeof data.discord === "object" && data.discord !== null ? data.discord : {}
  ) as Record<string, unknown>;
  return {
    apiKey: env.CHALLONGE_API_KEY || str(data.apiKey, "apiKey"),
    oauthToken: env.CHALLONGE_OAUTH_TOKEN || str(data.oauthToken, "oauthToken"),
    communityId: env.CHALLONGE_COMMUNITY || str(data.communityId, "communityId"),
    game: str(data.game, "game"),
    announceWebhook: env.CHALLONGE_ANNOUNCE_WEBHOOK || str(data.announceWebhook, "announceWebhook"),
    discord: {
      token: env.DISCORD_TOKEN || str(discordFile.token, "discord.token"),
      appId: env.DISCORD_APP_ID || str(discordFile.appId, "discord.appId"),
      guildId: env.DISCORD_GUILD_ID || str(discordFile.guildId, "discord.guildId"),
      organiserRoleId:
        env.ORGANISER_ROLE_ID || str(discordFile.organiserRoleId, "discord.organiserRoleId"),
      batchRegistrations:
        flag(env.CHALLONGE_BATCH_REGISTRATIONS) ?? flag(discordFile.batchRegistrations) ?? false,
    },
    dir,
    warnings,
  };
}

/** Auth Challonge : le jeton OAuth l'emporte sur la clé v1 ; sinon erreur d'usage explicite. */
export function authOf(config: ChallongeConfig): Auth {
  if (config.oauthToken) return { kind: "oauth", token: config.oauthToken };
  if (config.apiKey) return { kind: "key", key: config.apiKey };
  throw new UsageError(
    "Clé API Challonge absente : définissez CHALLONGE_API_KEY (clé à créer sur https://challonge.com/settings/developer) " +
      `ou « apiKey » dans ${join(config.dir, CONFIG_FILE)}.`,
  );
}

/** Tous les secrets de la configuration, pour les masquer dans les journaux. */
export function secretsOf(config: ChallongeConfig): string[] {
  return [config.apiKey, config.oauthToken, config.discord.token, config.announceWebhook].filter(
    (v): v is string => !!v,
  );
}
