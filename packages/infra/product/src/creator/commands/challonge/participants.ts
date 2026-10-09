import { readFile } from "node:fs/promises";

import { UsageError } from "../../../shared/args.ts";

export interface SeedEntry {
  name: string;
  /** Tête de série explicite (1 = meilleure) ; absente = ordre d'insertion côté Challonge. */
  seed?: number;
  /** Champ « misc » de l'API (clé étrangère libre), ex. `discord:<id>`. */
  misc?: string;
}

/** Limite documentée de `bulk_add` : 20 participants par requête. */
export const BULK_LIMIT = 20;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Lignes d'un fichier : une ligne = un nom ; lignes vides et commentaires `#` ignorés. */
export function namesFromLines(text: string): string[] {
  return stripBom(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** Liste en ligne `a,b,c` (ou une par ligne si elle contient des retours à la ligne). */
export function namesFromInline(text: string): string[] {
  const parts = text.includes("\n") ? namesFromLines(text) : text.split(",").map((s) => s.trim());
  return parts.filter(Boolean);
}

export function assertUnique(names: readonly string[]): void {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) duplicates.push(name);
    else seen.set(key, name);
  }
  if (duplicates.length) {
    throw new UsageError(
      `Noms en double (insensible à la casse) : ${duplicates.join(", ")}. Ajoutez un suffixe pour les distinguer.`,
    );
  }
}

async function readIfFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG") return undefined;
    if (code === "EISDIR")
      throw new UsageError(`${path} est un dossier : indiquez un fichier de noms.`);
    throw new UsageError(`Impossible de lire ${path} : ${(error as Error).message}`);
  }
}

/** `--participants` : chemin d'un fichier (un nom par ligne) ou liste `"a,b,c"`. */
export async function readParticipants(source: string): Promise<string[]> {
  const fileText = await readIfFile(source);
  const names = fileText === undefined ? namesFromInline(source) : namesFromLines(fileText);
  assertUnique(names);
  return names;
}

interface SeedLine {
  name: string;
  score?: number;
}

function parseSeedLine(line: string): SeedLine {
  const match = /^(.*?)[\t;,]\s*(-?\d+(?:[.,]\d+)?)$/.exec(line);
  if (!match) return { name: line };
  return { name: match[1]!.trim(), score: Number(match[2]!.replace(",", ".")) };
}

/**
 * Fichier `--seed-by` : « nom » par ligne (du meilleur au moins bon) ou « nom;note » / « nom,note » / « nom<TAB>note »
 * (note la plus haute = tête de série 1). Les deux formes ne se mélangent pas.
 */
export function readSeedFile(text: string): string[] {
  const lines = namesFromLines(text).map(parseSeedLine);
  const withScore = lines.filter((l) => l.score !== undefined).length;
  if (withScore !== 0 && withScore !== lines.length) {
    throw new UsageError(
      "Fichier --seed-by : mélange de lignes avec et sans note ; utilisez une seule forme.",
    );
  }
  const ordered = withScore
    ? lines
        .map((l, index) => ({ ...l, index }))
        .toSorted((a, b) => b.score! - a.score! || a.index - b.index)
    : lines;
  return ordered.map((l) => l.name);
}

export interface SeedResult {
  entries: SeedEntry[];
  /** Noms du fichier de seeding absents de la liste des participants (probables fautes de frappe). */
  unknown: string[];
}

/** Applique l'ordre du fichier de seeding ; les participants non listés passent après, dans leur ordre d'origine. */
export function seedBy(names: readonly string[], ranking: readonly string[]): SeedResult {
  const byKey = new Map(names.map((n) => [n.toLocaleLowerCase(), n]));
  const ordered: string[] = [];
  const unknown: string[] = [];
  const used = new Set<string>();
  for (const entry of ranking) {
    const key = entry.toLocaleLowerCase();
    const real = byKey.get(key);
    if (!real) unknown.push(entry);
    else if (!used.has(key)) {
      used.add(key);
      ordered.push(real);
    }
  }
  for (const name of names) if (!used.has(name.toLocaleLowerCase())) ordered.push(name);
  return { entries: ordered.map((name, index) => ({ name, seed: index + 1 })), unknown };
}

/** Mélange de Fisher-Yates (le générateur est injectable pour des tests déterministes). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Tirage au sort côté client : graines 1..n explicites (aucune requête `randomize` nécessaire). */
export function shuffleSeeds(
  names: readonly string[],
  random: () => number = Math.random,
): SeedEntry[] {
  return shuffle(names, random).map((name, index) => ({ name, seed: index + 1 }));
}
