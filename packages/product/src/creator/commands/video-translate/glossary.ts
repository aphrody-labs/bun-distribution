/** Term glossaries: matching in source text, prompt rendering and post-checks on the English output. */
import { UsageError } from "../../../shared/args.ts";
import artStreams from "../../../../resources/creator/glossaries/art-streams.json" with { type: "json" };
import fgcCommon from "../../../../resources/creator/glossaries/fgc-common.json" with { type: "json" };
import guiltyGear from "../../../../resources/creator/glossaries/guilty-gear.json" with { type: "json" };

export type Confidence = "verified" | "partial" | "unverified";

export interface GlossaryEntry {
  id: string;
  /** Source-language surface forms (Japanese, French, Korean, Spanish or English slang). */
  src: string[];
  /** Extra regular sources (JS syntax, `iu` flags) for forms that need lookbehinds. */
  re?: string[];
  /** Preferred English rendering, used verbatim. */
  en: string;
  /** Other acceptable English renderings. */
  alt?: string[];
  /** Literal or wrong English renderings that must not appear when the term was matched. */
  avoid?: string[];
  /** Meaning and usage note shown to the model. */
  note?: string;
  kind?: string;
  game?: string;
  /** Only a name when the context clearly points to it (short katakana names, common words). */
  ambiguous?: boolean;
  confidence: Confidence;
  /** Key(s) into the file-level `sources`, joined with "+". */
  ref?: string;
  /** Source forms (subset of `src`) that were not cross-checked against a primary source. */
  unverifiedSrc?: string[];
}

export interface GlossarySource {
  title: string;
  url: string;
  retrieved?: string;
}

export interface GlossaryFile {
  name: string;
  description: string;
  sources: Record<string, GlossarySource>;
  entries: GlossaryEntry[];
}

const KATAKANA = String.raw`\p{Script=Katakana}ー`;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Hangul}]/u;
const KATA = /\p{Script=Katakana}/u;
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\s.'\-/&♯#!?+:_,]+$/u;

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function latinBody(term: string): string {
  return escapeRegex(term)
    .split(/[\s-]+/)
    .filter(Boolean)
    .join(String.raw`[\s\-]?`);
}

/** Builds a case-insensitive matcher for one surface form with script-appropriate boundaries. */
export function surfaceRegex(surface: string, caseSensitive = false): RegExp {
  const term = surface.normalize("NFKC").trim();
  if (LATIN_ONLY.test(term)) {
    return new RegExp(
      String.raw`(?<![\p{L}\p{N}])${latinBody(term)}(?![\p{L}\p{N}])`,
      caseSensitive ? "u" : "iu",
    );
  }
  if (
    KATA.test(term) &&
    !CJK.test(term.replace(/[\p{Script=Katakana}ー・=\s\-.'♯A-Za-z0-9?]/gu, ""))
  ) {
    return new RegExp(
      String.raw`(?<![${KATAKANA}])${escapeRegex(term)}(?![${KATAKANA}])`,
      "u",
    );
  }
  return new RegExp(escapeRegex(term), "u");
}

interface Compiled {
  entry: GlossaryEntry;
  matchers: RegExp[];
  accept: RegExp[];
  avoid: RegExp[];
}

const english = (term: string): RegExp =>
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])${latinBody(term.normalize("NFKC"))}(?![\p{L}\p{N}])`,
    "iu",
  );

export class Glossary {
  private readonly compiled: Compiled[];

  constructor(public readonly entries: GlossaryEntry[]) {
    this.compiled = entries.map((entry) => ({
      entry,
      matchers: [
        ...entry.src.map((surface) =>
          surfaceRegex(
            surface,
            entry.ambiguous === true && /^\p{Lu}/u.test(surface),
          ),
        ),
        ...(entry.re ?? []).map((source) => new RegExp(source, "iu")),
      ],
      accept: [entry.en, ...(entry.alt ?? [])].map(english),
      avoid: (entry.avoid ?? []).map(english),
    }));
  }

  get size(): number {
    return this.entries.length;
  }

  /** Entries whose source forms occur in `text`. */
  match(text: string): GlossaryEntry[] {
    const haystack = text.normalize("NFKC");
    return this.compiled
      .filter((item) => item.matchers.some((re) => re.test(haystack)))
      .map((item) => item.entry);
  }

  /** Wrong literal renderings present in the English `output` for the entries matched in `source`. */
  violations(
    source: string,
    output: string,
  ): { entry: GlossaryEntry; bad: string }[] {
    const matched = new Set(this.match(source).map((entry) => entry.id));
    const found: { entry: GlossaryEntry; bad: string }[] = [];
    for (const item of this.compiled) {
      if (!matched.has(item.entry.id)) continue;
      item.avoid.forEach((re, index) => {
        if (re.test(output))
          found.push({
            entry: item.entry,
            bad: item.entry.avoid?.[index] ?? "",
          });
      });
    }
    return found;
  }

  /** Lower-case Latin words that appear in any preferred or accepted English rendering. */
  vocabulary(): Set<string> {
    const words = new Set<string>();
    for (const entry of this.entries) {
      for (const form of [entry.en, ...(entry.alt ?? [])]) {
        for (const word of form.toLowerCase().match(/\p{L}{2,}/gu) ?? [])
          words.add(word);
      }
    }
    return words;
  }

  /** Whether `output` contains the preferred or an accepted rendering of `entry`. */
  uses(entry: GlossaryEntry, output: string): boolean {
    const item = this.compiled.find(
      (candidate) => candidate.entry.id === entry.id,
    );
    return item ? item.accept.some((re) => re.test(output)) : false;
  }
}

/** Renders matched entries for the prompt, most specific (longest source form) first, capped. */
export function renderGlossary(entries: GlossaryEntry[], limit = 32): string {
  const ranked = [...entries].toSorted(
    (a, b) =>
      Math.max(...b.src.map((s) => s.length)) -
      Math.max(...a.src.map((s) => s.length)),
  );
  return ranked
    .slice(0, limit)
    .map((entry) => {
      const alt = entry.alt?.length
        ? ` (also fine: ${entry.alt.join(", ")})`
        : "";
      const avoid = entry.avoid?.length
        ? ` NEVER: ${entry.avoid.map((a) => `"${a}"`).join(", ")}.`
        : "";
      const amb = entry.ambiguous
        ? " Ambiguous: only when the context clearly means this."
        : "";
      const note = entry.note ? ` ${entry.note}` : "";
      return `- ${entry.src.slice(0, 3).join(" / ")} => "${entry.en}"${alt}.${note}${avoid}${amb}`.replace(
        /\s+/g,
        " ",
      );
    })
    .join("\n");
}

const BUILTIN: Record<string, GlossaryFile> = {
  "fgc-common": fgcCommon as unknown as GlossaryFile,
  "guilty-gear": guiltyGear as unknown as GlossaryFile,
  "art-streams": artStreams as unknown as GlossaryFile,
};

export const BUILTIN_NAMES = Object.keys(BUILTIN);

/** Structural validation with readable errors (used for built-ins in tests and for user files). */
export function validateGlossary(value: unknown, label: string): GlossaryFile {
  const file = value as Partial<GlossaryFile> | null;
  if (!file || typeof file !== "object" || !Array.isArray(file.entries)) {
    throw new UsageError(
      `${label}: glossaire invalide (champ "entries" manquant)`,
    );
  }
  const seen = new Set<string>();
  for (const [index, entry] of file.entries.entries()) {
    const where = `${label} entrée #${index + 1}`;
    if (!entry || typeof entry.id !== "string" || !entry.id)
      throw new UsageError(`${where}: "id" manquant`);
    if (seen.has(entry.id))
      throw new UsageError(`${label}: id en double "${entry.id}"`);
    seen.add(entry.id);
    if (typeof entry.en !== "string" || !entry.en)
      throw new UsageError(`${where} (${entry.id}): "en" manquant`);
    if (
      !Array.isArray(entry.src) ||
      (entry.src.length === 0 && !entry.re?.length)
    ) {
      throw new UsageError(`${where} (${entry.id}): "src" vide`);
    }
    const stray = (entry.unverifiedSrc ?? []).filter(
      (form) => !entry.src.includes(form),
    );
    if (stray.length)
      throw new UsageError(
        `${where} (${entry.id}): unverifiedSrc hors de src : ${stray.join(", ")}`,
      );
    if (!["verified", "partial", "unverified"].includes(entry.confidence)) {
      throw new UsageError(
        `${where} (${entry.id}): "confidence" doit valoir verified|partial|unverified`,
      );
    }
  }
  return {
    name: file.name ?? label,
    description: file.description ?? "",
    sources: file.sources ?? {},
    entries: file.entries,
  };
}

export function builtinGlossary(name: string): GlossaryFile {
  const file = BUILTIN[name];
  if (!file)
    throw new UsageError(
      `glossaire inconnu : ${name} (intégrés : ${BUILTIN_NAMES.join(", ")})`,
    );
  return validateGlossary(file, name);
}

/** Loads built-in names or JSON file paths; later entries override earlier ones with the same id. */
export async function loadGlossaries(
  specs: string[],
): Promise<{ glossary: Glossary; files: GlossaryFile[] }> {
  const files: GlossaryFile[] = [];
  for (const spec of specs) {
    if (spec in BUILTIN) {
      files.push(builtinGlossary(spec));
      continue;
    }
    const handle = Bun.file(spec);
    // oxlint-disable-next-line no-await-in-loop -- glossaires lus dans l'ordre fourni : la première erreur signalée doit être celle du premier fichier fautif
    if (!(await handle.exists()))
      throw new UsageError(`glossaire introuvable : ${spec}`);
    // oxlint-disable-next-line no-await-in-loop -- même lecture séquentielle ordonnée que ci-dessus
    files.push(validateGlossary(JSON.parse(await handle.text()), spec));
  }
  const byId = new Map<string, GlossaryEntry>();
  for (const file of files)
    for (const entry of file.entries) byId.set(entry.id, entry);
  return { glossary: new Glossary([...byId.values()]), files };
}
