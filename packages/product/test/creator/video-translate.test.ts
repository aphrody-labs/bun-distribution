import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageError } from "../../src/shared/args.ts";
import { Cache } from "../../src/creator/commands/video-translate/cache.ts";
import {
  BUILTIN_NAMES,
  Glossary,
  builtinGlossary,
  loadGlossaries,
  renderGlossary,
  surfaceRegex,
  validateGlossary,
} from "../../src/creator/commands/video-translate/glossary.ts";
import {
  DEFAULT_LAYOUT,
  cps,
  layoutCues,
  splitText,
  wrapLines,
} from "../../src/creator/commands/video-translate/layout.ts";
import {
  LlmClient,
  LlmError,
  isLocalHost,
  normalizeBaseUrl,
  stripThinking,
} from "../../src/creator/commands/video-translate/llm.ts";
import { parseConfig } from "../../src/creator/commands/video-translate/options.ts";
import { runPipeline } from "../../src/creator/commands/video-translate/pipeline.ts";
import {
  type Cue,
  formatTimestamp,
  parseSubtitles,
  parseTimestamp,
  serialize,
  toAss,
  toSrt,
  toVtt,
} from "../../src/creator/commands/video-translate/subtitles.ts";
import {
  extractJson,
  toItems,
  translateCues,
  validateItems,
} from "../../src/creator/commands/video-translate/translate.ts";

// ---------------------------------------------------------------------------------------------
// fake OpenAI-compatible server
// ---------------------------------------------------------------------------------------------

interface Seen {
  kind: "summary" | "window" | "fix" | "review" | "other";
  messages: { role: string; content: string }[];
  /** Ids requested in the window prompt. */
  ids: number[];
  src: Record<number, string>;
}

type Handler = (seen: Seen, call: number) => string | undefined;

/** Latin-only stand-in for a translation, so the validator sees no leftover source characters. */
const english = (src: string): string =>
  `EN:${[...src]
    .map((c) => (c.codePointAt(0) ?? 0).toString(36))
    .join("")
    .slice(0, 24)}`;

function fakeLlm(handler?: Handler) {
  const seen: Seen[] = [];
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/models")
        return Response.json({ data: [{ id: "fake-model" }] });
      if (url.pathname !== "/v1/chat/completions")
        return new Response("not found", { status: 404 });
      const body = (await request.json()) as {
        messages: { role: string; content: string }[];
      };
      const first =
        body.messages.find((message) => message.role === "user")?.content ?? "";
      const kind: Seen["kind"] = first.includes("TRANSCRIPT:")
        ? "summary"
        : first.includes("TRANSLATE THESE CUES")
          ? "window"
          : first.startsWith("In these English subtitles")
            ? "fix"
            : first.includes("bilingual QA reviewer")
              ? "review"
              : "other";
      const src: Record<number, string> = {};
      let ids: number[] = [];
      if (kind === "window") {
        const line =
          /TRANSLATE THESE CUES[^\n]*\n(.*)\n/.exec(first)?.[1] ?? "[]";
        const items = JSON.parse(line) as { id: number; src: string }[];
        ids = items.map((item) => item.id);
        for (const item of items) src[item.id] = item.src;
      }
      const entry: Seen = { kind, messages: body.messages, ids, src };
      seen.push(entry);
      calls += 1;
      let content = handler?.(entry, calls);
      if (content === undefined) {
        if (kind === "summary")
          content = "A Guilty Gear Strive commentary about okizeme.";
        else if (kind === "window")
          content = JSON.stringify(
            ids.map((id) => ({ id, text: english(src[id] ?? "") })),
          );
        else if (kind === "review") content = "[]";
        else content = "[]";
      }
      return Response.json({
        choices: [{ message: { role: "assistant", content } }],
      });
    },
  });
  return {
    seen,
    url: `http://127.0.0.1:${server.port}/v1`,
    get calls() {
      return calls;
    },
    stop: () => server.stop(true),
  };
}

const client = (
  url: string,
  extra: Partial<ConstructorParameters<typeof LlmClient>[0]> = {},
) =>
  new LlmClient({
    baseUrl: url,
    model: "fake-model",
    temperature: 0,
    timeoutMs: 5000,
    retryDelayMs: 1,
    ...extra,
  });

const cue = (id: number, start: number, end: number, text: string): Cue => ({
  id,
  start,
  end,
  text,
});

let work: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "vt-test-"));
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// subtitles
// ---------------------------------------------------------------------------------------------

describe("subtitles", () => {
  test("timestamps", () => {
    expect(formatTimestamp(3_723_456, "srt")).toBe("01:02:03,456");
    expect(formatTimestamp(3_723_456, "vtt")).toBe("01:02:03.456");
    expect(formatTimestamp(3_723_456, "ass")).toBe("1:02:03.45");
    expect(parseTimestamp("00:01:02,500")).toBe(62_500);
    expect(parseTimestamp("01:02.250")).toBe(62_250);
    expect(parseTimestamp("0:00:03.50")).toBe(3500);
  });

  test("parses SRT with BOM, CRLF and markup", () => {
    const text =
      "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Top line\r\n";
    const cues = parseSubtitles(text);
    expect(cues).toEqual([
      { id: 1, start: 1000, end: 2500, text: "Hello world" },
      { id: 2, start: 3000, end: 4000, text: "Top line" },
    ]);
  });

  test("parses WebVTT (header, NOTE, settings, tags)", () => {
    const text =
      "WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:02.000 align:start position:0%\n<c.yellow>Salut</c> &amp; hi\n\n";
    expect(parseSubtitles(text)).toEqual([
      { id: 1, start: 1000, end: 2000, text: "Salut & hi" },
    ]);
  });

  test("parses ASS with commas in the text, override tags and \\N", () => {
    const text = [
      "[Script Info]",
      "Title: x",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:02.00,0:00:03.50,Default,,0,0,0,,{\\i1}Well, you know,\\Nit is fine{\\i0}",
      "Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ignored",
      "Dialogue: 0,0:00:00.50,0:00:01.50,Default,,0,0,0,,First",
    ].join("\n");
    const cues = parseSubtitles(text);
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [500, 1500, "First"],
      [2000, 3500, "Well, you know, it is fine"],
    ]);
  });

  test("writers: SRT round trip, VTT header, ASS events, bilingual", () => {
    const cues: Cue[] = [
      {
        id: 1,
        start: 1000,
        end: 2500,
        text: "Line one\nLine two",
        orig: "原文",
      },
      { id: 2, start: 3000, end: 4000, text: "A --> B {x}" },
    ];
    const srt = toSrt(cues);
    expect(parseSubtitles(srt).map((c) => [c.start, c.end, c.text])).toEqual([
      [1000, 2500, "Line one Line two"],
      [3000, 4000, "A -> B"],
    ]);
    expect(toSrt(cues, { bilingual: true }).split("\n").slice(0, 4)).toEqual([
      "1",
      "00:00:01,000 --> 00:00:02,500",
      "原文",
      "Line one",
    ]);
    expect(
      toVtt(cues).startsWith("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500"),
    ).toBe(true);
    const ass = toAss(cues, { bilingual: true });
    expect(ass).toContain("[Events]");
    expect(ass).toContain(
      "Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\rOrig}原文\\N{\\rDefault}Line one\\NLine two",
    );
    expect(ass).toContain("A --> B (x)");
    expect(serialize(cues, "srt")).toBe(toSrt(cues));
  });
});

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------

describe("layout", () => {
  test("wrapLines balances two lines under the limit", () => {
    expect(wrapLines("short", 42)).toEqual(["short"]);
    const text =
      "I can't believe he just threw that out on wakeup, what a read";
    const lines = wrapLines(text, 42);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 42)).toBe(true);
    expect(lines.join(" ")).toBe(text);
  });

  test("splitText keeps pieces under the limit and loses nothing", () => {
    const text =
      "This is the first sentence of the clip. Here comes the second one, which is a bit longer than the first. And a third.";
    const pieces = splitText(text, 60);
    expect(pieces.every((piece) => piece.length <= 60)).toBe(true);
    expect(pieces.join(" ")).toBe(text);
  });

  test("extends a fast cue into the silence but never past the next cue", () => {
    const { cues } = layoutCues([
      cue(1, 0, 1000, "Hello there my friend how are you"),
      cue(2, 5000, 6000, "Fine, thanks and you today"),
    ]);
    expect(cues[0]?.end).toBe(1942);
    expect(cues[0]?.end).toBeLessThanOrEqual(cues[1]?.start ?? 0);
    const tight = layoutCues([
      cue(1, 0, 1000, "Hello there my friend how are you"),
      cue(2, 1600, 4000, "Fine, thanks and you today"),
    ]);
    expect(tight.cues[0]?.end).toBe(1600);
  });

  test("never overlaps, even when the input does", () => {
    const { cues } = layoutCues([
      cue(1, 0, 3000, "First one is long enough to show"),
      cue(2, 2000, 4000, "Second one overlaps with it"),
    ]);
    for (let i = 1; i < cues.length; i += 1)
      expect(cues[i]?.start ?? 0).toBeGreaterThanOrEqual(cues[i - 1]?.end ?? 0);
  });

  test("merges starved fragments", () => {
    const { cues, stats } = layoutCues([
      cue(1, 0, 500, "Wait,"),
      cue(2, 600, 1400, "what?!"),
    ]);
    expect(stats.merged).toBe(1);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      start: 0,
      end: 1400,
      text: "Wait, what?!",
    });
  });

  test("splits a long cue over its original time span", () => {
    const sentence =
      "He ran out of meter right after the burst bait and had to block the whole thing.";
    const text = Array.from({ length: 3 }, () => sentence).join(" ");
    const { cues, stats } = layoutCues([cue(1, 1000, 11_000, text)]);
    expect(stats.split).toBeGreaterThanOrEqual(2);
    expect(cues[0]?.start).toBe(1000);
    expect(cues.at(-1)?.end).toBeGreaterThanOrEqual(11_000);
    for (const piece of cues) {
      const lines = piece.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.every((line) => line.length <= 42)).toBe(true);
    }
  });

  test("empty cues are dropped and extend the previous contiguous cue", () => {
    const { cues, stats } = layoutCues([
      cue(1, 0, 2000, "A full sentence here."),
      cue(2, 2000, 3500, ""),
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.end).toBe(3500);
    expect(stats.dropped).toBe(1);
  });

  test("reports what cannot be made readable and caps long extensions", () => {
    const hard = layoutCues([
      cue(1, 0, 1000, "x".repeat(60)),
      cue(2, 1000, 3000, "next"),
    ]);
    expect(hard.stats.overCps).toContain(1);
    const long = layoutCues([cue(1, 0, 500, "word ".repeat(40).trim())], {
      maxCps: 8,
    });
    expect(
      (long.cues.at(-1)?.end ?? 0) - (long.cues[0]?.start ?? 0),
    ).toBeLessThanOrEqual(DEFAULT_LAYOUT.maxDuration + 1);
  });

  test("output respects 2 lines x 42 chars on arbitrary input", () => {
    const words =
      "oki mixup frame trap anti-air punish okizeme meaty reversal cross-up neutral footsies".split(
        " ",
      );
    const input: Cue[] = [];
    let t = 0;
    for (let i = 0; i < 40; i += 1) {
      const n = 3 + ((i * 7) % 30);
      const text = Array.from(
        { length: n },
        (_, k) => words[(i + k) % words.length],
      ).join(" ");
      input.push(cue(i + 1, t, t + 700 + ((i * 331) % 3000), text));
      t += 900 + ((i * 211) % 2500);
    }
    const { cues } = layoutCues(input);
    for (const [index, out] of cues.entries()) {
      const lines = out.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.every((line) => line.length <= 42)).toBe(true);
      expect(out.end).toBeGreaterThan(out.start);
      if (index > 0)
        expect(out.start).toBeGreaterThanOrEqual(cues[index - 1]?.end ?? 0);
      expect(Number.isFinite(cps(out))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// glossary
// ---------------------------------------------------------------------------------------------

describe("glossary", () => {
  test("built-in files are valid, sourced and labelled", () => {
    expect(BUILTIN_NAMES.toSorted()).toEqual([
      "art-streams",
      "fgc-common",
      "guilty-gear",
    ]);
    const ids = new Set<string>();
    for (const name of BUILTIN_NAMES) {
      const file = builtinGlossary(name);
      expect(file.entries.length).toBeGreaterThan(40);
      expect(file.description).toMatch(/verified/);
      for (const entry of file.entries) {
        expect(ids.has(entry.id)).toBe(false);
        ids.add(entry.id);
        for (const key of (entry.ref ?? "").split("+").filter(Boolean)) {
          expect(Object.keys(file.sources)).toContain(key);
        }
        for (const source of Object.values(file.sources))
          expect(source.url).toMatch(/^https:\/\//);
        for (const avoid of entry.avoid ?? [])
          expect(avoid.toLowerCase()).not.toBe(entry.en.toLowerCase());
        if (entry.confidence !== "unverified" && !entry.ref)
          throw new Error(`${entry.id}: verified/partial entry without ref`);
        for (const unverified of entry.unverifiedSrc ?? [])
          expect(entry.src).toContain(unverified);
      }
    }
  });

  test("covers the required FGC terms and GG roster", async () => {
    const { glossary } = await loadGlossaries(BUILTIN_NAMES);
    const wanted = [
      "oki",
      "frame trap",
      "mixup",
      "tech",
      "neutral",
      "footsies",
      "meaty",
      "reversal",
      "cross-up",
      "anti-air",
      "Burst",
      "Roman Cancel",
    ];
    const all = glossary.entries.map((entry) => entry.en);
    for (const term of wanted) expect(all).toContain(term);
    expect(
      glossary.entries.filter((entry) => entry.kind === "character"),
    ).toHaveLength(34);
  });

  test("script-aware matching: katakana boundaries, Latin words, ambiguous names", async () => {
    const { glossary } = await loadGlossaries(BUILTIN_NAMES);
    const ids = (text: string) => glossary.match(text).map((entry) => entry.id);
    expect(ids("今日はソルの起き攻めがきつい")).toEqual(
      expect.arrayContaining(["char-sol", "okizeme"]),
    );
    expect(ids("シンプルなメインのルール")).not.toContain("char-sin");
    expect(ids("シンプルなメインのルール")).not.toContain("char-may");
    expect(ids("ソルトを入れる")).not.toContain("char-sol");
    expect(ids("May dodged the throw")).toContain("char-may");
    expect(ids("it may be strong")).not.toContain("char-may");
    expect(ids("he uses a Frame-Trap and a frametrap")).toContain("frame-trap");
    expect(ids("確反あるでしょ")).toContain("punish");
    expect(ids("乗算で影を塗る")).toContain("csp-blend-multiply");
    expect(ids("ガンフレイムからヴォルカニックヴァイパー")).toEqual(
      expect.arrayContaining(["mv-sol-gun-flame", "mv-sol-volcanic-viper"]),
    );
    expect(surfaceRegex("A.B.A").test("A.B.A is back")).toBe(true);
  });

  test("detects banned literal renderings only when the source term is present", async () => {
    const { glossary } = await loadGlossaries(["fgc-common"]);
    expect(
      glossary
        .violations("そこ暴れる？", "You rampage there?")
        .map((v) => v.bad),
    ).toEqual(["rampage"]);
    expect(
      glossary.violations("そこ暴れる？", "You're mashing there?"),
    ).toEqual([]);
    expect(glossary.violations("今日は晴れ", "He went on a rampage")).toEqual(
      [],
    );
    const entry = glossary.entries.find(
      (candidate) => candidate.id === "abare",
    );
    expect(entry && glossary.uses(entry, "He keeps mashing")).toBe(true);
  });

  test("renders a bounded, readable prompt block", async () => {
    const { glossary } = await loadGlossaries(["fgc-common"]);
    const block = renderGlossary(glossary.match("暴れ 確反 起き攻め"));
    expect(block).toContain('=> "mash"');
    expect(block).toContain('NEVER: "rampage"');
    expect(block.split("\n").length).toBeLessThanOrEqual(32);
  });

  test("user files are validated and override built-ins by id", async () => {
    expect(() =>
      validateGlossary(
        { entries: [{ id: "x", src: [], en: "x", confidence: "verified" }] },
        "t",
      ),
    ).toThrow(UsageError);
    expect(() =>
      validateGlossary(
        { entries: [{ id: "x", src: ["a"], en: "x", confidence: "sure" }] },
        "t",
      ),
    ).toThrow(/confidence/);
    const file = join(work, "mine.json");
    await writeFile(
      file,
      JSON.stringify({
        name: "mine",
        entries: [
          {
            id: "okizeme",
            src: ["起き攻め"],
            en: "oki game",
            confidence: "unverified",
          },
        ],
      }),
    );
    const { glossary } = await loadGlossaries(["fgc-common", file]);
    expect(glossary.entries.find((entry) => entry.id === "okizeme")?.en).toBe(
      "oki game",
    );
    await expect(
      loadGlossaries(["/nonexistent/g.json"]),
    ).rejects.toBeInstanceOf(UsageError);
    expect(new Glossary([]).match("anything")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// JSON handling and LLM client
// ---------------------------------------------------------------------------------------------

describe("json replies", () => {
  test("extractJson tolerates fences, prose, trailing commas and wrapper objects", () => {
    expect(extractJson('```json\n[{"id":1,"text":"a"}]\n```')).toEqual([
      { id: 1, text: "a" },
    ]);
    expect(
      extractJson('Sure! Here it is: [{"id":1,"text":"a"},] Hope that helps'),
    ).toEqual([{ id: 1, text: "a" }]);
    expect(
      toItems(extractJson('{"translations":[{"id":"2","en":"b"}]}')),
    ).toEqual([{ id: 2, text: "b" }]);
    expect(() => extractJson("no json here")).toThrow(/JSON/);
    expect(typeof toItems({ foo: 1 })).toBe("string");
    expect(typeof toItems([{ text: "x" }])).toBe("string");
  });

  test("validateItems reports hard and soft problems", () => {
    const cues = [
      { id: 1, text: "こんにちは", maxChars: 30 },
      { id: 2, text: "さようなら", maxChars: 30 },
    ];
    const ok = validateItems(
      [
        { id: 2, text: " Bye. " },
        { id: 1, text: "Hello." },
      ],
      cues,
    );
    expect(ok.hard).toEqual([]);
    expect(ok.texts.get(2)).toBe("Bye.");
    const bad = validateItems([{ id: 1, text: "Hello" }], cues);
    expect(bad.hard.join(" ")).toMatch(/expected 2 items/);
    expect(bad.hard.join(" ")).toMatch(/missing ids: 2/);
    const dup = validateItems(
      [
        { id: 1, text: "a" },
        { id: 1, text: "b" },
      ],
      cues,
    );
    expect(dup.hard.join(" ")).toMatch(/duplicate id 1/);
    const soft = validateItems(
      [
        { id: 1, text: "こんにちは!" },
        { id: 2, text: "x".repeat(80) },
      ],
      cues,
    );
    expect(soft.hard).toEqual([]);
    expect(soft.soft.join(" ")).toMatch(/source-language characters/);
    expect(soft.soft.join(" ")).toMatch(/too long/);
  });
});

describe("llm client", () => {
  test("url helpers", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8795")).toBe(
      "http://127.0.0.1:8795/v1",
    );
    expect(normalizeBaseUrl("http://127.0.0.1:8080/v1/chat/completions")).toBe(
      "http://127.0.0.1:8080/v1",
    );
    expect(isLocalHost("http://127.0.0.1:1/v1")).toBe(true);
    expect(isLocalHost("http://192.168.1.4/v1")).toBe(true);
    expect(isLocalHost("https://api.openai.com/v1")).toBe(false);
    expect(stripThinking("<think>hmm</think>\nanswer")).toBe("answer");
    expect(stripThinking("hmm</think>answer")).toBe("answer");
  });

  test("retries 5xx, sends seed and key, drops seed when refused", async () => {
    let attempt = 0;
    const bodies: Record<string, unknown>[] = [];
    const headers: (string | null)[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        attempt += 1;
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        headers.push(request.headers.get("authorization"));
        if (attempt === 1) return new Response("busy", { status: 503 });
        if (attempt === 2)
          return new Response("unknown field seed", { status: 400 });
        return Response.json({
          choices: [{ message: { content: "<think>x</think>done" } }],
        });
      },
    });
    try {
      const llm = client(`http://127.0.0.1:${server.port}/v1`, {
        seed: 7,
        apiKey: "sekret",
        extra: { foo: 1 },
      });
      expect(await llm.chat([{ role: "user", content: "hi" }])).toBe("done");
      expect(bodies[0]).toMatchObject({
        seed: 7,
        foo: 1,
        temperature: 0,
        model: "fake-model",
      });
      expect(bodies[2]?.seed).toBeUndefined();
      expect(headers[0]).toBe("Bearer sekret");
    } finally {
      server.stop(true);
    }
  });

  test("auth errors are not retried and unreachable endpoints explain themselves", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => (hits++, new Response("no", { status: 401 })),
    });
    try {
      await expect(
        client(`http://127.0.0.1:${server.port}/v1`).chat([
          { role: "user", content: "x" },
        ]),
      ).rejects.toThrow(/authentification/);
      expect(hits).toBe(1);
    } finally {
      server.stop(true);
    }
    const dead = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = dead.port;
    dead.stop(true);
    await expect(
      client(`http://127.0.0.1:${port}/v1`, { maxAttempts: 2 }).chat([
        { role: "user", content: "x" },
      ]),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

// ---------------------------------------------------------------------------------------------
// translation
// ---------------------------------------------------------------------------------------------

const SOURCE: Cue[] = [
  cue(1, 0, 3000, "ここからソルの起き攻めですね"),
  cue(2, 3000, 6000, "そこ暴れますか？"),
  cue(3, 6000, 9000, "確反ありますよ"),
  cue(4, 9000, 12_000, "ポチョムキンは投げ抜けできない"),
  cue(5, 12_000, 15_000, "乗算で影を塗る"),
  cue(6, 15_000, 18_000, "さあ、始まりました"),
];

async function glossaryAll(): Promise<Glossary> {
  return (await loadGlossaries(BUILTIN_NAMES)).glossary;
}

const deps = async (
  llm: LlmClient,
  cache = new Cache(join(work, "unused-cache"), false, false),
) => ({
  llm,
  llmKey: "test",
  glossary: await glossaryAll(),
  cache,
  log: () => {},
});

describe("translation", () => {
  test("windows carry the summary, previous translations, next source lines and only matching glossary entries", async () => {
    const server = fakeLlm();
    try {
      const result = await translateCues(
        SOURCE,
        await deps(client(server.url)),
        {
          windowSize: 2,
          before: 2,
          after: 2,
          sourceLang: "ja",
        },
      );
      expect(result.cues.map((c) => c.text)).toEqual(
        SOURCE.map((c) => english(c.text)),
      );
      expect(result.cues.map((c) => c.orig)).toEqual(SOURCE.map((c) => c.text));
      const windows = server.seen.filter((s) => s.kind === "window");
      expect(windows).toHaveLength(3);
      expect(server.seen[0]?.kind).toBe("summary");
      const first = windows[0]?.messages[1]?.content ?? "";
      expect(first).toContain("A Guilty Gear Strive commentary about okizeme.");
      expect(first).toContain('=> "oki"');
      expect(first).toContain('=> "mash"');
      expect(first).not.toContain("Multiply");
      const second = windows[1]?.messages[1]?.content ?? "";
      expect(second).toContain(
        `"en":"${english("ここからソルの起き攻めですね")}"`,
      );
      expect(second).toContain(`"en":"${english("そこ暴れますか？")}"`);
      expect(second).toContain('"id":5,"src":"乗算で影を塗る"');
      expect(second).toContain('=> "guaranteed punish"');
      expect(second).toContain('=> "throw tech"');
      expect(windows[0]?.messages[0]?.content).toContain("never words");
      expect(windows[0]?.messages[1]?.content).toContain('"max_chars"');
      expect(result.stats.repairs).toBe(0);
    } finally {
      server.stop();
    }
  });

  test("a wrong count triggers a repair prompt that names the problem", async () => {
    let first = true;
    const server = fakeLlm((seen) => {
      if (seen.kind === "window" && first) {
        first = false;
        return JSON.stringify([{ id: seen.ids[0], text: "only one" }]);
      }
      return undefined;
    });
    try {
      const result = await translateCues(
        SOURCE.slice(0, 2),
        await deps(client(server.url)),
        {
          windowSize: 2,
        },
      );
      expect(result.stats.repairs).toBe(1);
      expect(result.stats.fallbackCues).toBe(0);
      expect(result.cues.map((c) => c.text)).toEqual(
        SOURCE.slice(0, 2).map((c) => english(c.text)),
      );
      const repair =
        server.seen.filter((s) => s.kind === "window")[1]?.messages.at(-1)
          ?.content ?? "";
      expect(repair).toMatch(/expected 2 items but got 1/);
      expect(repair).toMatch(/missing ids: 2/);
    } finally {
      server.stop();
    }
  });

  test("falls back cue by cue when the model keeps answering garbage for a window", async () => {
    const server = fakeLlm((seen) =>
      seen.kind === "window" && seen.ids.length > 1
        ? "I cannot do that, sorry."
        : undefined,
    );
    try {
      const result = await translateCues(
        SOURCE.slice(0, 3),
        await deps(client(server.url)),
        {
          windowSize: 3,
          retries: 1,
        },
      );
      expect(result.stats.fallbackCues).toBe(3);
      expect(result.stats.untranslated).toEqual([]);
      expect(result.cues.map((c) => c.text)).toEqual(
        SOURCE.slice(0, 3).map((c) => english(c.text)),
      );
    } finally {
      server.stop();
    }
  });

  test("a cue the model never translates keeps its source text and is reported", async () => {
    const server = fakeLlm((seen) =>
      seen.kind === "window" ? "nope" : undefined,
    );
    try {
      const result = await translateCues(
        SOURCE.slice(0, 2),
        await deps(client(server.url)),
        {
          windowSize: 2,
          retries: 0,
        },
      );
      expect(result.stats.untranslated).toEqual([1, 2]);
      expect(result.cues.map((c) => c.text)).toEqual(
        SOURCE.slice(0, 2).map((c) => c.text),
      );
    } finally {
      server.stop();
    }
  });

  test("a banned literal rendering is rewritten with a targeted fix", async () => {
    const server = fakeLlm((seen) => {
      if (seen.kind === "window")
        return JSON.stringify(
          seen.ids.map((id) => ({ id, text: "He goes on a rampage there." })),
        );
      if (seen.kind === "fix")
        return JSON.stringify([{ id: 1, text: "He keeps mashing there." }]);
      return undefined;
    });
    try {
      const result = await translateCues(
        [cue(1, 0, 3000, "そこ暴れますか？")],
        await deps(client(server.url)),
        { windowSize: 1 },
      );
      expect(result.cues[0]?.text).toBe("He keeps mashing there.");
      expect(result.stats.glossaryFixed).toBe(1);
      expect(result.stats.glossaryViolations).toEqual([
        { id: 1, term: "abare", bad: "rampage", fixed: true },
      ]);
      const fix =
        server.seen.find((s) => s.kind === "fix")?.messages[1]?.content ?? "";
      expect(fix).toContain('use \\"mash\\"');
    } finally {
      server.stop();
    }
  });

  test("an unfixable violation is kept and reported, not hidden", async () => {
    const server = fakeLlm((seen) =>
      seen.kind === "window" || seen.kind === "fix"
        ? JSON.stringify(
            seen.ids.length
              ? seen.ids.map((id) => ({ id, text: "A rampage!" }))
              : [{ id: 1, text: "Still a rampage" }],
          )
        : undefined,
    );
    try {
      const result = await translateCues(
        [cue(1, 0, 3000, "暴れ")],
        await deps(client(server.url)),
        { windowSize: 1 },
      );
      expect(result.stats.glossaryViolations[0]).toMatchObject({
        term: "abare",
        fixed: false,
      });
    } finally {
      server.stop();
    }
  });

  test("empty strings are allowed for absorbed fragments and survive layout", async () => {
    const server = fakeLlm((seen) =>
      seen.kind === "window"
        ? JSON.stringify([
            { id: 1, text: "Wait, are you really going to do that?" },
            { id: 2, text: "" },
          ])
        : undefined,
    );
    try {
      const source = [
        cue(1, 0, 1500, "ちょっと待って、"),
        cue(2, 1500, 3000, "本当にそれやるの？"),
      ];
      const result = await translateCues(
        source,
        await deps(client(server.url)),
        { windowSize: 2 },
      );
      expect(result.cues.map((c) => c.text)).toEqual([
        "Wait, are you really going to do that?",
        "",
      ]);
      const { cues } = layoutCues(result.cues);
      expect(cues).toHaveLength(1);
      expect(cues[0]).toMatchObject({ start: 0, end: 3000 });
    } finally {
      server.stop();
    }
  });

  test("review flags problems without rewriting, and applies only errors when asked", async () => {
    const server = fakeLlm((seen) =>
      seen.kind === "review"
        ? JSON.stringify([
            {
              id: 1,
              severity: "error",
              issue: "wrong term",
              suggestion: "His oki is brutal.",
            },
            {
              id: 2,
              severity: "warn",
              issue: "a bit stiff",
              suggestion: "Meh.",
            },
            { id: 99, severity: "error", issue: "unknown id" },
          ])
        : undefined,
    );
    try {
      const flag = await translateCues(
        SOURCE.slice(0, 2),
        await deps(client(server.url)),
        {
          windowSize: 2,
          review: true,
        },
      );
      expect(flag.review.map((i) => [i.id, i.severity])).toEqual([
        [1, "error"],
        [2, "warn"],
      ]);
      expect(flag.cues[0]?.text).toBe(english(SOURCE[0]?.text ?? ""));
      const apply = await translateCues(
        SOURCE.slice(0, 2),
        await deps(client(server.url)),
        {
          windowSize: 2,
          review: true,
          reviewApply: true,
        },
      );
      expect(apply.cues[0]?.text).toBe("His oki is brutal.");
      expect(apply.cues[1]?.text).toBe(english(SOURCE[1]?.text ?? ""));
      expect(apply.review[0]?.applied).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("review-apply refuses suggestions that invent names, and laughter tags become haha", async () => {
    const server = fakeLlm((seen) =>
      seen.kind === "review"
        ? JSON.stringify([
            {
              id: 1,
              severity: "error",
              issue: "term",
              suggestion: "First, setup with Banished Bringer.",
            },
          ])
        : seen.kind === "window"
          ? JSON.stringify(
              seen.ids.map((id) => ({ id, text: "That is sneaky (laugh)" })),
            )
          : undefined,
    );
    try {
      const result = await translateCues(
        SOURCE.slice(0, 1),
        await deps(client(server.url)),
        {
          windowSize: 1,
          review: true,
          reviewApply: true,
        },
      );
      expect(result.cues[0]?.text).toBe("That is sneaky, haha.");
      expect(result.review[0]?.applied).toBeUndefined();
      expect(result.review[0]?.skipped).toMatch(/unknown names: Banished/);
    } finally {
      server.stop();
    }
  });

  test("--resume reuses the cached summary and windows (no model call)", async () => {
    const dir = await mkdtemp(join(work, "cache-"));
    const server = fakeLlm();
    try {
      const options = { windowSize: 3 };
      const first = await translateCues(
        SOURCE,
        await deps(client(server.url), new Cache(dir, true)),
        options,
      );
      const callsAfterFirst = server.calls;
      expect(callsAfterFirst).toBeGreaterThan(0);
      expect((await readdir(dir)).length).toBeGreaterThanOrEqual(3);
      const second = await translateCues(
        SOURCE,
        await deps(client(server.url), new Cache(dir, true)),
        options,
      );
      expect(server.calls).toBe(callsAfterFirst);
      expect(second.stats.cachedWindows).toBe(2);
      expect(second.cues).toEqual(first.cues);
      const without = await translateCues(
        SOURCE,
        await deps(client(server.url), new Cache(dir, false)),
        options,
      );
      expect(server.calls).toBeGreaterThan(callsAfterFirst);
      expect(without.stats.cachedWindows).toBe(0);
    } finally {
      server.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// pipeline from subtitles (no media tools needed)
// ---------------------------------------------------------------------------------------------

const JA_SRT = SOURCE.map(
  (c, i) =>
    `${i + 1}\n${formatTimestamp(c.start, "srt")} --> ${formatTimestamp(c.end, "srt")}\n${c.text}\n`,
).join("\n");

const io = () => {
  const out: string[] = [];
  const log: string[] = [];
  return {
    out,
    log,
    io: {
      log: (line: string) => void log.push(line),
      out: (line: string) => void out.push(line),
    },
  };
};

async function fixture(name: string): Promise<{ dir: string; srt: string }> {
  const dir = await mkdtemp(join(work, `${name}-`));
  const srt = join(dir, "clip.ja.srt");
  await writeFile(srt, JA_SRT);
  return { dir, srt };
}

describe("pipeline from subtitles", () => {
  test("writes valid, readable English subtitles next to the source and never touches the source", async () => {
    const server = fakeLlm((seen) => {
      if (seen.kind !== "window") return undefined;
      return JSON.stringify(
        seen.ids.map((id) => ({
          id,
          text:
            id === 2
              ? "You're really going to mash there? That is a guaranteed punish, he will make you pay for it dearly."
              : `Line ${id}.`,
        })),
      );
    });
    try {
      const { dir, srt } = await fixture("subs");
      const { config } = parseConfig([
        "--subs-from",
        srt,
        "--llm-url",
        server.url,
        "--llm-model",
        "fake-model",
      ]);
      const sink = io();
      expect(
        await runPipeline(config as never, { env: process.env, io: sink.io }),
      ).toBe(0);
      const out = join(dir, "clip.ja.en.srt");
      expect(await readFile(srt, "utf8")).toBe(JA_SRT);
      const cues = parseSubtitles(await readFile(out, "utf8"));
      expect(cues.length).toBeGreaterThanOrEqual(6);
      for (const [index, c] of cues.entries()) {
        const lines = c.text.split(" ");
        expect(lines.length).toBeGreaterThan(0);
        if (index > 0)
          expect(c.start).toBeGreaterThanOrEqual(cues[index - 1]?.end ?? 0);
        expect(c.end).toBeGreaterThan(c.start);
      }
      expect(await readFile(out, "utf8")).toContain("guaranteed punish");
      expect(sink.out[0]).toContain(out);
      expect((await readdir(join(dir, ".vt-cache"))).length).toBeGreaterThan(0);
    } finally {
      server.stop();
    }
  });

  test("formats: vtt, ass, bilingual", async () => {
    const server = fakeLlm();
    try {
      const { dir, srt } = await fixture("formats");
      for (const format of ["vtt", "ass"]) {
        const { config } = parseConfig([
          "--subs-from",
          srt,
          "--llm-url",
          server.url,
          "--llm-model",
          "fake-model",
          "--format",
          format,
          "--out",
          join(dir, `o.${format}`),
        ]);
        // oxlint-disable-next-line no-await-in-loop -- exécutions séquentielles du pipeline : chaque format écrit son fichier de sortie et la boucle reste ordonnée
        await runPipeline(config as never, { env: process.env, io: io().io });
      }
      expect(
        (await readFile(join(dir, "o.vtt"), "utf8")).startsWith("WEBVTT"),
      ).toBe(true);
      expect(await readFile(join(dir, "o.ass"), "utf8")).toContain("Dialogue:");
      const { config } = parseConfig([
        "--subs-from",
        srt,
        "--llm-url",
        server.url,
        "--llm-model",
        "fake-model",
        "--bilingual",
        "--out",
        join(dir, "bi.srt"),
      ]);
      await runPipeline(config as never, { env: process.env, io: io().io });
      const bilingual = await readFile(join(dir, "bi.srt"), "utf8");
      expect(bilingual).toContain("ここからソルの起き攻めですね");
      expect(bilingual.indexOf("ここからソルの起き攻めですね")).toBeLessThan(
        bilingual.indexOf("EN:"),
      );
    } finally {
      server.stop();
    }
  });

  test("refuses to overwrite the source", async () => {
    const server = fakeLlm();
    try {
      const { srt } = await fixture("guard");
      const { config } = parseConfig([
        "--subs-from",
        srt,
        "--llm-url",
        server.url,
        "--llm-model",
        "fake-model",
        "--out",
        srt,
      ]);
      await expect(
        runPipeline(config as never, { env: process.env, io: io().io }),
      ).rejects.toBeInstanceOf(UsageError);
      expect(await readFile(srt, "utf8")).toBe(JA_SRT);
      expect(server.calls).toBe(0);
    } finally {
      server.stop();
    }
  });

  test("--dry-run prints the plan and writes nothing", async () => {
    const server = fakeLlm();
    try {
      const { dir, srt } = await fixture("dry");
      const { config } = parseConfig([
        "--subs-from",
        srt,
        "--llm-url",
        server.url,
        "--dry-run",
        "--bilingual",
        "--review",
      ]);
      const sink = io();
      expect(
        await runPipeline(config as never, { env: process.env, io: sink.io }),
      ).toBe(0);
      const plan = sink.out.join("\n");
      expect(plan).toContain("Plan (--dry-run");
      expect(plan).toContain("ASR            : ignoré (--subs-from, 6 cues)");
      expect(plan).toContain("modèle fake-model");
      expect(plan).toContain("joignable");
      expect(plan).toContain("439 entrées");
      expect(plan).toContain("clip.ja.en.srt");
      expect(plan).toContain("clip.ja.en.review.json");
      expect(await readdir(dir)).toEqual(["clip.ja.srt"]);
      expect(server.calls).toBe(0);
    } finally {
      server.stop();
    }
  });

  test("--resume does not call the model again", async () => {
    const server = fakeLlm();
    try {
      const { srt } = await fixture("resume");
      const args = [
        "--subs-from",
        srt,
        "--llm-url",
        server.url,
        "--llm-model",
        "fake-model",
      ];
      await runPipeline(parseConfig(args).config as never, {
        env: process.env,
        io: io().io,
      });
      const calls = server.calls;
      await runPipeline(parseConfig([...args, "--resume"]).config as never, {
        env: process.env,
        io: io().io,
      });
      expect(server.calls).toBe(calls);
    } finally {
      server.stop();
    }
  });

  test("an unreachable endpoint fails early with the exact way to start one", async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = dead.port;
    dead.stop(true);
    const { srt } = await fixture("dead");
    const { config } = parseConfig([
      "--subs-from",
      srt,
      "--llm-url",
      `http://127.0.0.1:${port}/v1`,
    ]);
    await expect(
      runPipeline(config as never, { env: process.env, io: io().io }),
    ).rejects.toThrow(/aphrody gateway serve/);
  });

  test("a remote endpoint is announced before any text is sent", async () => {
    const server = fakeLlm();
    try {
      const { srt } = await fixture("remote");
      const { config } = parseConfig([
        "--subs-from",
        srt,
        "--llm-url",
        server.url.replace("127.0.0.1", "localhost"),
        "--llm-model",
        "fake-model",
        "--dry-run",
      ]);
      const sink = io();
      await runPipeline(config as never, { env: process.env, io: sink.io });
      expect(sink.out.join("\n")).toContain("(local)");
    } finally {
      server.stop();
    }
  });
});

describe("options", () => {
  test("validates arguments", () => {
    expect(() => parseConfig([])).toThrow(UsageError);
    expect(() => parseConfig(["a.mp4", "b.mp4"])).toThrow(UsageError);
    expect(() => parseConfig(["a.mp4", "--format", "doc"])).toThrow(/--format/);
    expect(() => parseConfig(["a.mp4", "--from", "en"])).toThrow(
      /déjà en anglais/,
    );
    expect(() => parseConfig(["a.mp4", "--window", "2"])).toThrow(/--window/);
    expect(() => parseConfig(["a.mp4", "--asr", "endpoint"])).toThrow(
      /--asr-url/,
    );
    expect(() => parseConfig(["a.mp4", "--llm-extra", "[1]"])).toThrow(
      /--llm-extra/,
    );
    expect(() => parseConfig(["--subs-from", "a.srt", "--burn"])).toThrow(
      /vidéo source/,
    );
    expect(() =>
      parseConfig(["a.mp4", "--burn", "--mux", "--video-out", "x.mp4"]),
    ).toThrow(/--video-out/);
    expect(parseConfig(["--help"]).help).toBe(true);
  });

  test("a subtitle file as the positional argument means --subs-from; defaults are the documented ones", () => {
    const { config } = parseConfig(["talk.ja.srt"]);
    expect(config?.subsFrom).toBe("talk.ja.srt");
    expect(config?.input).toBeUndefined();
    expect(config?.glossaries).toEqual([
      "fgc-common",
      "guilty-gear",
      "art-streams",
    ]);
    expect(config?.translate).toMatchObject({
      windowSize: 20,
      before: 5,
      after: 3,
      retries: 2,
    });
    expect(config?.layout).toMatchObject({
      maxLine: 42,
      maxLines: 2,
      maxCps: 17,
    });
    expect(config?.temperature).toBe(0.2);
    expect(parseConfig(["x.mp4", "--no-glossary"]).config?.glossaries).toEqual(
      [],
    );
    expect(
      parseConfig([
        "x.mp4",
        "--glossary",
        "fgc-common",
        "--glossary",
        "my.json",
      ]).config?.glossaries,
    ).toEqual(["fgc-common", "my.json"]);
    expect(
      parseConfig(["x.mp4", "--review-apply"]).config?.translate.review,
    ).toBe(true);
  });
});
