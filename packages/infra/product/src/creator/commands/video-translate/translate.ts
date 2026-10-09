/** Context-aware translation: summary pass, sliding windows, strict JSON validation, repair, fallback, glossary checks, review. */
import { type Cache, keyOf } from "./cache.ts";
import type { Glossary, GlossaryEntry } from "./glossary.ts";
import type { ChatMessage } from "./llm.ts";
import {
  PROMPT_VERSION,
  buildGlossaryFixPrompt,
  buildRepairPrompt,
  buildReviewPrompt,
  buildSummaryPrompt,
  buildSystemPrompt,
  buildWindowPrompt,
} from "./prompts.ts";
import type { Cue } from "./subtitles.ts";

export interface Chat {
  chat(messages: ChatMessage[], options?: { maxTokens?: number }): Promise<string>;
}

export interface TranslateOptions {
  sourceLang: string;
  userContext?: string;
  windowSize: number;
  /** Already translated cues given as read-only context. */
  before: number;
  /** Following source cues given as read-only context. */
  after: number;
  /** Repair attempts per window before the per-cue fallback. */
  retries: number;
  maxCps: number;
  maxLine: number;
  maxLines: number;
  /** Characters of transcript sent to the summary pass. */
  summaryChars: number;
  review: boolean;
  reviewApply: boolean;
}

export const DEFAULT_TRANSLATE: TranslateOptions = {
  sourceLang: "auto",
  windowSize: 20,
  before: 5,
  after: 3,
  retries: 2,
  maxCps: 17,
  maxLine: 42,
  maxLines: 2,
  summaryChars: 12000,
  review: false,
  reviewApply: false,
};

export interface TranslateDeps {
  llm: Chat;
  /** Identity of the model settings, part of every cache key. */
  llmKey: string;
  glossary: Glossary;
  cache: Cache;
  log: (line: string) => void;
}

export interface ReviewIssue {
  id: number;
  severity: "error" | "warn";
  issue: string;
  suggestion?: string;
  applied?: boolean;
  /** Why a suggestion was not applied. */
  skipped?: string;
}

export interface GlossaryViolation {
  id: number;
  term: string;
  bad: string;
  fixed: boolean;
}

export interface TranslateStats {
  windows: number;
  cachedWindows: number;
  repairs: number;
  fallbackCues: number;
  untranslated: number[];
  emptied: number;
  softWarnings: string[];
  glossaryFixed: number;
  glossaryViolations: GlossaryViolation[];
}

export interface Consistency {
  term: string;
  src: string;
  used: number;
  total: number;
  missing: number[];
}

export interface TranslateResult {
  cues: Cue[];
  summary: string;
  stats: TranslateStats;
  consistency: Consistency[];
  review: ReviewIssue[];
}

// ---------------------------------------------------------------------------------------------
// JSON handling
// ---------------------------------------------------------------------------------------------

function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** Parses the model reply: whole text, first `[...]`, or first `{...}`, tolerating trailing commas. */
export function extractJson(raw: string): unknown {
  const text = stripFence(raw);
  const attempts: string[] = [text];
  const open = text.indexOf("[");
  const close = text.lastIndexOf("]");
  if (open >= 0 && close > open) attempts.push(text.slice(open, close + 1));
  const brace = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (brace >= 0 && braceEnd > brace) attempts.push(text.slice(brace, braceEnd + 1));
  for (const attempt of attempts) {
    for (const candidate of [attempt, attempt.replace(/,\s*([\]}])/g, "$1")]) {
      try {
        return JSON.parse(candidate);
      } catch {
        // next candidate
      }
    }
  }
  throw new Error("la réponse n'est pas du JSON valide");
}

export interface Item {
  id: number;
  text: unknown;
}

const ARRAY_KEYS = [
  "translations",
  "cues",
  "subtitles",
  "result",
  "results",
  "items",
  "data",
  "output",
];

/** Normalises the parsed reply to `{id, text}` items, or returns a problem string. */
export function toItems(parsed: unknown): Item[] | string {
  let list: unknown = parsed;
  if (!Array.isArray(list) && list && typeof list === "object") {
    const record = list as Record<string, unknown>;
    const key = ARRAY_KEYS.find((candidate) => Array.isArray(record[candidate]));
    list = key ? record[key] : undefined;
  }
  if (!Array.isArray(list)) return "the reply must be a JSON array of {id, text} objects";
  const items: Item[] = [];
  for (const [index, raw] of list.entries()) {
    if (!raw || typeof raw !== "object") return `element ${index + 1} is not an object`;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? Number(record.id) : record.id;
    if (typeof id !== "number" || !Number.isInteger(id))
      return `element ${index + 1} has no integer "id"`;
    items.push({ id, text: record.text ?? record.en ?? record.translation ?? record.subtitle });
  }
  return items;
}

const SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export interface Validation {
  texts: Map<number, string>;
  hard: string[];
  soft: string[];
}

/** Audible-laughter stage directions the model sometimes keeps: (laugh), [laughs], *chuckles*. */
const LAUGH = String.raw`\s*[([*]\s*(?:laugh(?:s|ter|ing)?|chuckle[sd]?|giggle[sd]?|lol)\s*[)\]*]`;
const LAUGH_END = new RegExp(`${LAUGH}[.!?]*\\s*$`, "i");
const LAUGH_MID = new RegExp(LAUGH, "gi");

export function squash(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const tail = LAUGH_END.exec(flat);
  let out = flat;
  if (tail) {
    const head = flat.slice(0, tail.index).trimEnd();
    out = !head ? "Haha." : /[.!?…]$/.test(head) ? `${head} Haha.` : `${head}, haha.`;
  }
  return out.replace(LAUGH_MID, ", haha,").replace(/\s+/g, " ").trim();
}

export function validateItems(
  items: Item[],
  cues: { id: number; text: string; maxChars: number }[],
): Validation {
  const hard: string[] = [];
  const soft: string[] = [];
  const texts = new Map<number, string>();
  const expected = new Set(cues.map((cue) => cue.id));
  if (items.length !== cues.length)
    hard.push(`expected ${cues.length} items but got ${items.length}`);
  const seen = new Set<number>();
  for (const item of items) {
    if (!expected.has(item.id)) {
      hard.push(`unexpected id ${item.id}`);
      continue;
    }
    if (seen.has(item.id)) {
      hard.push(`duplicate id ${item.id}`);
      continue;
    }
    seen.add(item.id);
    if (typeof item.text !== "string") {
      hard.push(`id ${item.id} has no string "text"`);
      continue;
    }
    texts.set(item.id, squash(item.text));
  }
  const missing = cues.filter((cue) => !seen.has(cue.id)).map((cue) => cue.id);
  if (missing.length) hard.push(`missing ids: ${missing.slice(0, 8).join(", ")}`);
  let empties = 0;
  for (const cue of cues) {
    const text = texts.get(cue.id);
    if (text === undefined) continue;
    if (!text) {
      empties += 1;
      continue;
    }
    if (SCRIPT.test(text) && SCRIPT.test(cue.text))
      soft.push(`id ${cue.id} still contains source-language characters`);
    else if (text.length > Math.max(30, cue.maxChars * 1.6)) {
      soft.push(
        `id ${cue.id} is too long for its on-screen time (${text.length} chars, budget ${cue.maxChars}): condense it`,
      );
    }
  }
  if (cues.length >= 5 && empties > cues.length * 0.4)
    soft.push(
      `${empties} of ${cues.length} cues were left empty: use "" only for fragments absorbed by the previous cue`,
    );
  return { texts, hard, soft };
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

export const budgetFor = (cue: Cue, maxCps: number, maxLine: number, maxLines: number): number =>
  Math.min(maxLine * maxLines, Math.max(16, Math.floor(((cue.end - cue.start) / 1000) * maxCps)));

const tokensFor = (count: number): number => Math.min(8192, Math.max(512, count * 120 + 400));

interface WindowInput {
  cues: Cue[];
  previous: { id: number; src: string; en: string }[];
  next: Cue[];
}

interface BatchOutcome {
  texts: Map<number, string>;
  repairs: number;
  /** True when the model answered validly (hard-error free). */
  ok: boolean;
  warnings: string[];
}

class Translator {
  readonly system: string;
  summary = "";
  stats: TranslateStats = {
    windows: 0,
    cachedWindows: 0,
    repairs: 0,
    fallbackCues: 0,
    untranslated: [],
    emptied: 0,
    softWarnings: [],
    glossaryFixed: 0,
    glossaryViolations: [],
  };

  constructor(
    private readonly deps: TranslateDeps,
    private readonly options: TranslateOptions,
  ) {
    this.system = buildSystemPrompt({
      sourceLang: options.sourceLang,
      userContext: options.userContext,
    });
  }

  private budgets(cues: Cue[]): { id: number; text: string; maxChars: number }[] {
    const { maxCps, maxLine, maxLines } = this.options;
    return cues.map((cue) => ({
      id: cue.id,
      text: cue.text,
      maxChars: budgetFor(cue, maxCps, maxLine, maxLines),
    }));
  }

  /** One model conversation for a set of cues: ask, validate, repair up to `retries` times. */
  private async batch(input: WindowInput, retries: number): Promise<BatchOutcome> {
    const { glossary } = this.deps;
    const entries = glossary.match(
      [...input.cues, ...input.next].map((cue) => cue.text).join("\n"),
    );
    const previousText = input.previous.map((p) => `${p.src}\n${p.en}`).join("\n");
    const recent = glossary
      .match(previousText)
      .filter((entry) => !entries.some((e) => e.id === entry.id));
    const budgets = this.budgets(input.cues);
    const prompt = buildWindowPrompt({
      summary: this.summary,
      glossary: [...entries, ...recent.slice(0, 4)],
      previous: input.previous,
      next: input.next.map((cue) => ({ id: cue.id, text: cue.text })),
      cues: budgets,
    });
    const messages: ChatMessage[] = [
      { role: "system", content: this.system },
      { role: "user", content: prompt },
    ];
    const maxTokens = tokensFor(input.cues.length);
    let repairs = 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // transport-level failures were already retried by the client and propagate
      // oxlint-disable-next-line no-await-in-loop -- retries are sequential: each attempt follows the previous failed reply, and LLM calls are rate-limited
      const raw = await this.deps.llm.chat(messages, { maxTokens });
      let problems: string[];
      let validation: Validation | undefined;
      try {
        const items = toItems(extractJson(raw));
        if (typeof items === "string") {
          problems = [items];
        } else {
          validation = validateItems(items, budgets);
          problems = [...validation.hard, ...validation.soft];
        }
      } catch (error) {
        problems = [error instanceof Error ? error.message : String(error)];
      }
      if (validation && validation.hard.length === 0 && validation.soft.length === 0) {
        return { texts: validation.texts, repairs, ok: true, warnings: [] };
      }
      if (attempt === retries) {
        if (validation && validation.hard.length === 0) {
          return { texts: validation.texts, repairs, ok: true, warnings: validation.soft };
        }
        return { texts: new Map(), repairs, ok: false, warnings: problems };
      }
      repairs += 1;
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: buildRepairPrompt(
            problems,
            input.cues.map((cue) => cue.id),
          ),
        },
      );
    }
    return { texts: new Map(), repairs, ok: false, warnings: [] };
  }

  /** Per-cue fallback: each cue alone with the same context. */
  private async singles(
    input: WindowInput,
    previous: { id: number; src: string; en: string }[],
  ): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const rolling = [...previous];
    for (const [index, cue] of input.cues.entries()) {
      const next = [...input.cues.slice(index + 1), ...input.next].slice(0, this.options.after);
      // oxlint-disable-next-line no-await-in-loop -- cue windows roll: each batch's context is the previous batch's output
      const result = await this.batch(
        { cues: [cue], previous: rolling.slice(-this.options.before), next },
        1,
      );
      const text = result.texts.get(cue.id);
      if (result.ok && text !== undefined) {
        out.set(cue.id, text);
        rolling.push({ id: cue.id, src: cue.text, en: text });
      } else {
        this.stats.untranslated.push(cue.id);
        out.set(cue.id, cue.text);
        rolling.push({ id: cue.id, src: cue.text, en: cue.text });
      }
      this.stats.fallbackCues += 1;
    }
    return out;
  }

  async summarize(cues: Cue[]): Promise<void> {
    const { glossary, cache, llmKey } = this.deps;
    const lines = cues.map((cue) => cue.text);
    const total = lines.reduce((sum, line) => sum + line.length + 3, 0);
    let transcript: string;
    if (total <= this.options.summaryChars) {
      transcript = lines.map((line) => `- ${line}`).join("\n");
    } else {
      const stride = Math.ceil(total / this.options.summaryChars);
      transcript = lines
        .filter((_, index) => index % stride === 0)
        .map((line) => `- ${line}`)
        .join("\n")
        .slice(0, this.options.summaryChars);
    }
    const terms = glossary
      .match(lines.join("\n"))
      .filter((entry) => !entry.ambiguous)
      .map((entry) => entry.en)
      .slice(0, 40);
    const prompt = buildSummaryPrompt({ transcript, userContext: this.options.userContext, terms });
    const key = keyOf(PROMPT_VERSION, "summary", llmKey, prompt);
    const cached = await cache.get<string>("summary", key);
    if (cached !== undefined) {
      this.summary = cached;
      return;
    }
    try {
      const reply = await this.deps.llm.chat(
        [
          {
            role: "system",
            content:
              "You prepare concise context notes for a subtitle translator. You write in English.",
          },
          { role: "user", content: prompt },
        ],
        { maxTokens: 700 },
      );
      this.summary = squash(reply);
      await cache.set("summary", key, this.summary);
    } catch (error) {
      this.deps.log(
        `résumé indisponible, on continue sans (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  async translate(cues: Cue[]): Promise<Map<number, string>> {
    const { cache, llmKey, log } = this.deps;
    const { windowSize, before, after } = this.options;
    const out = new Map<number, string>();
    const history: { id: number; src: string; en: string }[] = [];
    const total = Math.ceil(cues.length / windowSize);
    for (let start = 0, index = 1; start < cues.length; start += windowSize, index += 1) {
      const slice = cues.slice(start, start + windowSize);
      const input: WindowInput = {
        cues: slice,
        previous: history.slice(-before),
        next: cues.slice(start + windowSize, start + windowSize + after),
      };
      const matched = this.deps.glossary
        .match([...slice, ...input.next].map((cue) => cue.text).join("\n"))
        .map((entry) => entry.id);
      const key = keyOf(
        PROMPT_VERSION,
        "window",
        llmKey,
        this.options.sourceLang,
        this.options.userContext ?? "",
        this.options.maxCps,
        this.summary,
        matched,
        slice.map((cue) => [cue.id, cue.text, cue.end - cue.start]),
        input.previous,
        input.next.map((cue) => [cue.id, cue.text]),
      );
      this.stats.windows += 1;
      // oxlint-disable-next-line no-await-in-loop -- window translation is sequential: each window depends on the previous output and on the cache state
      let texts = await cache.get<Record<string, string>>("window", key);
      if (texts) {
        this.stats.cachedWindows += 1;
        log(`[${index}/${total}] ${slice.length} cues (cache)`);
      } else {
        // oxlint-disable-next-line no-await-in-loop -- window translation is sequential: each window depends on the previous output and on the cache state
        const result = await this.batch(input, this.options.retries);
        this.stats.repairs += result.repairs;
        let map = result.texts;
        if (result.ok) {
          for (const warning of result.warnings)
            this.stats.softWarnings.push(`fenêtre ${index}: ${warning}`);
        } else {
          log(
            `[${index}/${total}] réponse invalide (${result.warnings.slice(0, 2).join("; ")}), repli cue par cue`,
          );
          // oxlint-disable-next-line no-await-in-loop -- window translation is sequential: each window depends on the previous output and on the cache state
          map = await this.singles(input, history);
        }
        // oxlint-disable-next-line no-await-in-loop -- window translation is sequential: each window depends on the previous output and on the cache state
        map = await this.fixGlossary(slice, map);
        texts = Object.fromEntries([...map.entries()].map(([id, text]) => [String(id), text]));
        // oxlint-disable-next-line no-await-in-loop -- window translation is sequential: each window depends on the previous output and on the cache state
        await cache.set("window", key, texts);
        log(
          `[${index}/${total}] ${slice.length} cues${result.repairs ? ` (${result.repairs} réparation${result.repairs > 1 ? "s" : ""})` : ""}`,
        );
      }
      for (const cue of slice) {
        const text = texts[String(cue.id)] ?? cue.text;
        out.set(cue.id, text);
        history.push({ id: cue.id, src: cue.text, en: text });
      }
    }
    return out;
  }

  /** One targeted rewrite for cues that contain a banned literal rendering; records what stayed wrong. */
  private async fixGlossary(
    slice: Cue[],
    texts: Map<number, string>,
  ): Promise<Map<number, string>> {
    const { glossary } = this.deps;
    const bad: { cue: Cue; entries: { entry: GlossaryEntry; bad: string }[] }[] = [];
    for (const cue of slice) {
      const text = texts.get(cue.id);
      if (!text) continue;
      const found = glossary.violations(cue.text, text);
      if (found.length) bad.push({ cue, entries: found });
    }
    if (!bad.length) return texts;
    const items = bad.map(({ cue, entries }) => ({
      id: cue.id,
      src: cue.text,
      current: texts.get(cue.id) ?? "",
      fix: entries
        .map(
          ({ entry, bad: word }) =>
            `use "${entry.en}" (or ${
              entry.alt
                ?.slice(0, 3)
                .map((a) => `"${a}"`)
                .join(", ") || "a natural equivalent"
            }) instead of "${word}"`,
        )
        .join("; "),
    }));
    const next = new Map(texts);
    try {
      const reply = await this.deps.llm.chat(
        [
          { role: "system", content: this.system },
          { role: "user", content: buildGlossaryFixPrompt(items) },
        ],
        { maxTokens: tokensFor(items.length) },
      );
      const parsed = toItems(extractJson(reply));
      if (typeof parsed !== "string") {
        for (const item of parsed) {
          if (
            typeof item.text === "string" &&
            next.has(item.id) &&
            squash(item.text) &&
            !SCRIPT.test(squash(item.text))
          ) {
            next.set(item.id, squash(item.text));
          }
        }
      }
    } catch {
      // keep the original text; the violation is reported below
    }
    for (const { cue, entries } of bad) {
      const still = glossary.violations(cue.text, next.get(cue.id) ?? "");
      for (const { entry, bad: word } of entries) {
        const fixed = !still.some((v) => v.entry.id === entry.id && v.bad === word);
        if (fixed) this.stats.glossaryFixed += 1;
        this.stats.glossaryViolations.push({ id: cue.id, term: entry.id, bad: word, fixed });
      }
    }
    return next;
  }

  async review(source: Cue[], texts: Map<number, string>): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    const size = Math.max(10, this.options.windowSize);
    for (let start = 0; start < source.length; start += size) {
      const items = source
        .slice(start, start + size)
        .map((cue) => ({ id: cue.id, src: cue.text, en: texts.get(cue.id) ?? "" }));
      try {
        // oxlint-disable-next-line no-await-in-loop -- chunks are sent one at a time: LLM calls are rate-limited and replies are applied in order
        const reply = await this.deps.llm.chat(
          [
            {
              role: "system",
              content:
                "You are a meticulous bilingual subtitle QA reviewer. You answer with JSON only.",
            },
            { role: "user", content: buildReviewPrompt(items, this.summary) },
          ],
          { maxTokens: 1500 },
        );
        const parsed = extractJson(reply);
        const list = Array.isArray(parsed) ? parsed : [];
        const ids = new Set(items.map((item) => item.id));
        for (const raw of list as Record<string, unknown>[]) {
          const id = typeof raw?.id === "number" ? raw.id : Number(raw?.id);
          if (!ids.has(id) || typeof raw.issue !== "string") continue;
          issues.push({
            id,
            severity: raw.severity === "error" ? "error" : "warn",
            issue: squash(raw.issue),
            suggestion: typeof raw.suggestion === "string" ? squash(raw.suggestion) : undefined,
          });
        }
      } catch (error) {
        this.deps.log(
          `relecture ${start + 1}-${start + items.length} ignorée (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    return issues;
  }
}

/** Per-term usage report: how often the preferred or an accepted rendering appears where the source term occurs. */
export function consistencyReport(
  source: Cue[],
  texts: Map<number, string>,
  glossary: Glossary,
): Consistency[] {
  const rows = new Map<string, Consistency>();
  for (const cue of source) {
    const text = texts.get(cue.id) ?? "";
    for (const entry of glossary.match(cue.text)) {
      if (entry.ambiguous) continue;
      const row = rows.get(entry.id) ?? {
        term: entry.en,
        src: entry.src[0] ?? "",
        used: 0,
        total: 0,
        missing: [],
      };
      row.total += 1;
      if (glossary.uses(entry, text)) row.used += 1;
      else row.missing.push(cue.id);
      rows.set(entry.id, row);
    }
  }
  return [...rows.values()]
    .filter((row) => row.total >= 2 && row.used < row.total)
    .toSorted((a, b) => b.total - b.used - (a.total - a.used));
}

/** Capitalised words (not sentence-initial) that neither the current line nor the glossary knows. */
export function introducedNames(suggestion: string, current: string, glossary: Glossary): string[] {
  const known = glossary.vocabulary();
  const seen = new Set(current.toLowerCase().match(/\p{L}{2,}/gu) ?? []);
  const names: string[] = [];
  for (const match of suggestion.matchAll(/(?<![.!?]\s)(?<!^)\b(\p{Lu}\p{L}{2,})\b/gu)) {
    const word = match[1] ?? "";
    if (!known.has(word.toLowerCase()) && !seen.has(word.toLowerCase())) names.push(word);
  }
  return names;
}

export async function translateCues(
  input: Cue[],
  deps: TranslateDeps,
  partial: Partial<TranslateOptions> = {},
): Promise<TranslateResult> {
  const options = { ...DEFAULT_TRANSLATE, ...partial };
  const source = input.map((cue, index) => ({ ...cue, id: index + 1 }));
  const translator = new Translator(deps, options);
  await translator.summarize(source);
  const texts = await translator.translate(source);
  let review: ReviewIssue[] = [];
  if (options.review) {
    review = await translator.review(source, texts);
    if (options.reviewApply) {
      for (const issue of review) {
        if (issue.severity !== "error" || !issue.suggestion) continue;
        const invented = introducedNames(
          issue.suggestion,
          texts.get(issue.id) ?? "",
          deps.glossary,
        );
        if (SCRIPT.test(issue.suggestion))
          issue.skipped = "suggestion contains source-language characters";
        else if (invented.length)
          issue.skipped = `suggestion introduces unknown names: ${invented.join(", ")}`;
        else {
          texts.set(issue.id, issue.suggestion);
          issue.applied = true;
        }
      }
    }
  }
  const cues = source.map((cue) => ({
    ...cue,
    orig: cue.text,
    text: texts.get(cue.id) ?? cue.text,
  }));
  translator.stats.emptied = cues.filter((cue) => !cue.text).length;
  return {
    cues,
    summary: translator.summary,
    stats: translator.stats,
    consistency: consistencyReport(source, texts, deps.glossary),
    review,
  };
}
