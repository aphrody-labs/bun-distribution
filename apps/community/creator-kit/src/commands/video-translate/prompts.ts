/** Prompt builders. Everything the model sees is assembled here so it can be tested and versioned. */
import { type GlossaryEntry, renderGlossary } from "./glossary.ts";

/** Bump when a prompt changes: it is part of every cache key. */
export const PROMPT_VERSION = "vt-2026-10-06.1";

export function languageName(code: string): string {
  if (!code || code === "auto") return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface SystemPromptOptions {
  /** ISO code, or "auto". */
  sourceLang: string;
  /** Free text from the user about the video (game, event, speakers). */
  userContext?: string;
}

const CALIBRATION = `Style calibration (source, then a bad literal rendering, then the rendering you must aim for):
JA: 起き攻めがきつい。ずっとガードさせられてる
  bad : The wake-up attack is harsh. I am being made to guard all the time.
  good: His oki is brutal. I'm just stuck blocking.
JA: そこ暴れるの？ 確反あるでしょ
  bad : Do you rampage there? There is a confirmed counterattack.
  good: You're mashing there? That's a guaranteed punish.
JA: いや、今のはわざとじゃないですよ（笑）
  bad : No, that was not on purpose (laugh).
  good: Nah, that was NOT on purpose, I swear. Haha.
JA: ちょっと待って、ガー不じゃんこれ！
  bad : Wait a moment, this is guard impossible!
  good: Wait, this is unblockable!
FR: Il s'est fait bouffer par le mix, c'est cadeau.
  bad : He got eaten by the mix, it is a gift.
  good: He got eaten alive by that mixup. Free win.
JA: めっちゃ作画いいな、神作画
  bad : The drawing is very good, god drawing.
  good: The animation is insane. Peak sakuga.`;

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const language = languageName(options.sourceLang);
  const source = language
    ? `The speech is ${language}.`
    : "The speech is most likely Japanese but can also be French, Korean or Spanish: identify the language from the text.";
  const context = options.userContext?.trim()
    ? `\nExtra context from the user: ${options.userContext.trim()}\n`
    : "";
  return `You are a professional subtitle translator and localizer for the fighting-game community (Guilty Gear, Street Fighter, Tekken and similar) and for anime and illustration content (art streams, drawing process videos). You turn speech transcripts into English subtitles the way a native English-speaking FGC subtitler or anime fan-subber would write them. ${source}${context}

Principles, in order of importance:
1. Translate meaning and intent, never words. A literal word-for-word rendering is a failure. Restructure, merge or compress clauses so each line reads like something a native speaker would naturally say out loud. Jokes, trash talk, sarcasm, hype and reactions must keep their effect: convey the intent, and if a pun cannot survive, use an equivalent natural reaction instead of explaining it.
2. Keep the speaker's voice and register. Casual stays casual, hype stays hype, trash talk stays cheeky, polite stays polite. Use contractions and everyday English. Keep swearing and slang at the same intensity: do not sanitize and do not inflate.
3. Game and art terms, move names, mechanics and character names use the community-standard English form. The glossary given with each request is authoritative: copy its spelling and capitalization exactly, and do not render a glossary term word for word. A glossary entry only applies when the source really uses the term in that sense; entries marked ambiguous apply only when the context clearly means them.
4. Drop honorifics and politeness particles (-san, -kun, -chan, -sama, -senpai, sensei) unless they carry a joke or a real relationship. Japanese drops subjects and pronouns: infer who is meant from the surrounding lines and use he, she, they, I or you naturally, or omit the pronoun where English subtitles would.
5. Remove filler and ASR noise (えー, あの, uh, euh, you know) unless the hesitation is the joke. Fix obvious mishearings from context (game, character, move or tool names). Do not invent content that is not in the source and do not censor.
6. Subtitle style: each line is short and readable. The "max_chars" given for a cue is a soft budget based on its on-screen time: stay within it by cutting redundancy, never by dropping meaning. No stage directions, no translator notes, no speaker labels, no quotation marks around the whole line, and no (laugh) tags (write "haha" or "lol" if it is audible and meaningful).
7. The cues are fragments of continuous speech. Use the previous and next lines to resolve broken sentences, then keep each cue's text aligned with what is said in that cue. When a sentence is split across cues, put the full natural sentence in the first cue and use "" (an empty string) for the later fragments whose content is already included.

${CALIBRATION}

Output format: reply with ONLY a JSON array, no prose and no code fence, with exactly one object per requested cue, the same ids, in the same order: [{"id": <int>, "text": "<English subtitle>"}]. Use "" only as described in rule 7.`;
}

export interface CueView {
  id: number;
  text: string;
}

export interface WindowPromptInput {
  summary: string;
  glossary: GlossaryEntry[];
  previous: { id: number; src: string; en: string }[];
  next: CueView[];
  cues: (CueView & { maxChars: number })[];
}

export function buildWindowPrompt(input: WindowPromptInput): string {
  const glossary = input.glossary.length
    ? renderGlossary(input.glossary)
    : "(none for this window)";
  const previous = input.previous.length
    ? JSON.stringify(input.previous.map(({ id, src, en }) => ({ id, src, en })))
    : "[]";
  const next = input.next.length
    ? JSON.stringify(input.next.map(({ id, text }) => ({ id, src: text })))
    : "[]";
  const cues = JSON.stringify(
    input.cues.map(({ id, text, maxChars }) => ({ id, src: text, max_chars: maxChars })),
  );
  return `VIDEO SUMMARY (context only):
${input.summary || "(not available)"}

GLOSSARY (authoritative):
${glossary}

ALREADY TRANSLATED, read-only context (do not output these):
${previous}

NEXT SOURCE LINES, read-only context (do not output these):
${next}

TRANSLATE THESE CUES (output exactly these ids, in this order):
${cues}

Reply with ONLY the JSON array [{"id": <int>, "text": "<English subtitle>"}].`;
}

export function buildRepairPrompt(problems: string[], ids: number[]): string {
  return `Your previous answer was rejected for these reasons:
${problems.map((problem) => `- ${problem}`).join("\n")}

Return the corrected, complete answer: ONLY a JSON array with exactly these ids in this order: ${JSON.stringify(ids)}. Each element is {"id": <int>, "text": "<English subtitle>"}.`;
}

export function buildSummaryPrompt(options: {
  transcript: string;
  userContext?: string;
  terms: string[];
}): string {
  const context = options.userContext?.trim()
    ? `Context from the user: ${options.userContext.trim()}\n`
    : "";
  const terms = options.terms.length
    ? `Terms detected in the transcript (English forms): ${options.terms.join(", ")}\n`
    : "";
  return `Below is the automatic transcript (it may contain recognition errors) of a video. ${context}${terms}
Write ONE paragraph in English, at most 110 words, that will help a subtitle translator: what the video is (game or topic, tournament, casual stream, art stream, review...), who speaks and how they relate to each other, the tone and humor, running jokes, names that recur and how to spell them in English, and any recognition errors you noticed (for example "X is probably Y"). Only state what the transcript supports: do not invent facts, names or jokes, and leave a point out when unsure. Plain prose, no bullet list, no preamble.

TRANSCRIPT:
${options.transcript}`;
}

export function buildReviewPrompt(
  items: { id: number; src: string; en: string }[],
  summary: string,
): string {
  return `You are a bilingual QA reviewer for fighting-game and anime subtitles. Video summary: ${summary || "(not available)"}

Below, each item has the source line and its English subtitle. Flag ONLY real problems: a mistranslation, a missed joke or nuance, a wrong game term or character name, a wrong pronoun or speaker, or phrasing so literal that a native speaker would not say it. Do NOT flag stylistic preferences and do NOT rewrite lines that are fine. Most items are fine: an empty list is a normal answer.

Reply with ONLY a JSON array: [{"id": <int>, "severity": "error" | "warn", "issue": "<short reason>", "suggestion": "<replacement English subtitle>"}]

ITEMS:
${JSON.stringify(items)}`;
}

export function buildGlossaryFixPrompt(
  items: { id: number; src: string; current: string; fix: string }[],
): string {
  return `In these English subtitles a wrong literal rendering of a glossary term was used. For each item rewrite ONLY the English so it follows the instruction in "fix", keeping the rest of the line as it is. Return ONLY a JSON array [{"id": <int>, "text": "<English subtitle>"}] with exactly these ids in this order.

ITEMS:
${JSON.stringify(items)}`;
}
