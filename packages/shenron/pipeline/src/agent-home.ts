// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Home du domaine Shenron (`dbfr`) côté Bun : choix du profil et lecture de ses seules
 * consignes de persona (clés de frontmatter de SOUL.md et IDENTITY.md).
 *
 * Résolution, alignée sur `crates/os/a2a-coord` (domaine) et `crates/ai/agent-home` (chemins) :
 * `APHRODY_AGENT_DOMAIN`, sinon le domaine de `APHRODY_WORKSPACE` (qui doit être
 * `<APHRODY_HOME>/workspaces/<domaine>`, liens symboliques résolus), sinon `APHRODY_PROFILE`
 * (`shenron` est l'ancien nom de `dbfr`), sinon `dbfr`, le domaine du produit. Un autre domaine
 * n'a pas de profil Shenron : aucun repli implicite sur dbfr, aucune lecture du profil étranger.
 * `APHRODY_PROFILE_HOME` reste l'alias historique d'un dossier explicite.
 *
 * Ni mémoire, ni corpus, ni secret n'est lu : seuls SOUL.md et IDENTITY.md sont ouverts, et seules
 * trois clés (`tone`, `brevity`, `vibe`) en sortent.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { HomePersona } from "@shenron/pipeline/ai/prompts";

export type AgentEnv = Record<string, string | undefined>;

export const SHENRON_DOMAIN = "dbfr";

/** Ancien nom du profil Shenron : lien vers `workspaces/dbfr` sur les machines migrées. */
const LEGACY_PROFILE_DIR = "workspace-shenron";
const DOMAIN_NAME = /^[a-z][a-z0-9_-]*$/;

export type AgentHomeResolution =
  | {
      status: "home";
      domain: typeof SHENRON_DOMAIN;
      dir: string;
      /** `profile-home` et `workspace` désignent un dossier : il doit exister. */
      source: "profile-home" | "workspace" | "domain" | "default";
    }
  | { status: "foreign-domain"; domain: string };

function setting(env: AgentEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function invalid(reason: string): Error {
  return new Error(`Agent Home invalide: ${reason}`);
}

/** `realpath` tolérant : résout le plus proche ancêtre existant et rattache la queue absente. */
function real(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(real(parent), basename(absolute));
  }
}

/** Domaine d'un dossier `<état>/workspaces/<domaine>`, ou `undefined` pour tout autre dossier. */
function workspaceDomain(workspace: string, state: string): string | undefined {
  const dir = real(workspace);
  const name = basename(dir);
  return dirname(dir) === real(join(state, "workspaces")) && DOMAIN_NAME.test(name)
    ? name
    : undefined;
}

/**
 * Profil Agent Home de Shenron pour cet environnement. Lève quand la configuration est
 * explicitement invalide : domaine mal formé, `APHRODY_WORKSPACE` hors `workspaces/<domaine>` ou
 * en désaccord avec `APHRODY_AGENT_DOMAIN`.
 */
export function resolveShenronHome(
  env: AgentEnv = process.env,
  home: string = homedir(),
): AgentHomeResolution {
  const state = setting(env, "APHRODY_HOME") ?? join(home, ".aphrody");
  const declared = setting(env, "APHRODY_AGENT_DOMAIN");
  if (declared !== undefined && !DOMAIN_NAME.test(declared))
    throw invalid(`APHRODY_AGENT_DOMAIN=${declared}`);

  const workspace = setting(env, "APHRODY_WORKSPACE");
  const owner = workspace === undefined ? undefined : workspaceDomain(workspace, state);
  if (workspace !== undefined && owner === undefined)
    throw invalid(`APHRODY_WORKSPACE doit être ${join(state, "workspaces", "<domaine>")}`);
  if (declared !== undefined && owner !== undefined && declared !== owner)
    throw invalid(
      `APHRODY_AGENT_DOMAIN=${declared} ne correspond pas à APHRODY_WORKSPACE (${owner})`,
    );

  const profile = setting(env, "APHRODY_PROFILE")?.toLowerCase();
  const fromProfile = profile === "shenron" ? SHENRON_DOMAIN : profile;
  const domain = declared ?? owner ?? fromProfile ?? SHENRON_DOMAIN;
  if (domain !== SHENRON_DOMAIN) return { status: "foreign-domain", domain };

  if (workspace !== undefined)
    return { status: "home", domain, dir: resolve(workspace), source: "workspace" };
  const profileHome = setting(env, "APHRODY_PROFILE_HOME");
  if (profileHome !== undefined) {
    const profileDomain = workspaceDomain(profileHome, state);
    if (profileDomain !== undefined && profileDomain !== domain)
      throw invalid(`APHRODY_PROFILE_HOME désigne le domaine ${profileDomain}, attendu ${domain}`);
    return { status: "home", domain, dir: resolve(profileHome), source: "profile-home" };
  }

  const canonical = join(state, "workspaces", domain);
  if (declared !== undefined || fromProfile !== undefined)
    return { status: "home", domain, dir: canonical, source: "domain" };
  const legacy = join(state, LEGACY_PROFILE_DIR);
  return {
    status: "home",
    domain,
    dir: !existsSync(canonical) && existsSync(legacy) ? legacy : canonical,
    source: "default",
  };
}

export interface ProfileFiles {
  soul: string | null;
  identity: string | null;
}

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Texte brut de SOUL.md et IDENTITY.md (`null` si absent) : les deux seuls fichiers lus. */
export function readProfileFiles(dir: string): ProfileFiles {
  return {
    soul: readOptional(join(dir, "SOUL.md")),
    identity: readOptional(join(dir, "IDENTITY.md")),
  };
}

/** Clés `clé: valeur` du frontmatter `---` d'un fichier de profil (valeurs entre guillemets acceptées). */
export function parseFrontmatter(text: string): Record<string, string> {
  const block = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
  const keys: Record<string, string> = {};
  if (block === undefined) return keys;
  for (const line of block.split(/\r?\n/u)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    let value = match[2] ?? "";
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote))
      value = value.slice(1, -1);
    keys[match[1] ?? ""] = value;
  }
  return keys;
}

/**
 * Profil éditorial complet (texte de SOUL.md et IDENTITY.md), contrat historique : lève si un des
 * deux manque. Sous un autre domaine que dbfr il n'existe pas de profil Shenron et la fonction lève.
 */
export function getToriyamaPersona(
  env: AgentEnv = process.env,
  home: string = homedir(),
): { soul: string; identity: string } {
  const resolution = resolveShenronHome(env, home);
  if (resolution.status !== "home")
    throw new Error(`Profil Shenron indisponible pour le domaine ${resolution.domain}`);
  const { soul, identity } = readProfileFiles(resolution.dir);
  if (soul === null || identity === null)
    throw new Error(`Profil Shenron incomplet: ${resolution.dir}`);
  return { soul, identity };
}

/**
 * Ton et style du profil Shenron (`tone` et `brevity` de SOUL.md, `vibe` d'IDENTITY.md), ou `null`
 * pour garder la persona canonique : domaine étranger, profil par défaut absent, fichiers absents
 * ou sans ces clés. Lève si le dossier explicitement désigné n'existe pas ou si la configuration
 * est invalide.
 */
export function loadShenronHomePersona(
  env: AgentEnv = process.env,
  home: string = homedir(),
): HomePersona | null {
  const resolution = resolveShenronHome(env, home);
  if (resolution.status !== "home") return null;
  if (!existsSync(resolution.dir)) {
    if (resolution.source === "profile-home" || resolution.source === "workspace")
      throw invalid(`profil introuvable: ${resolution.dir}`);
    return null;
  }
  const { soul, identity } = readProfileFiles(resolution.dir);
  const soulKeys: Record<string, string> = soul === null ? {} : parseFrontmatter(soul);
  const identityKeys: Record<string, string> = identity === null ? {} : parseFrontmatter(identity);
  const persona: HomePersona = {
    tone: soulKeys.tone,
    brevity: soulKeys.brevity,
    vibe: identityKeys.vibe,
  };
  return [persona.tone, persona.brevity, persona.vibe].some((value) => value?.trim())
    ? persona
    : null;
}
