// SPDX-License-Identifier: Apache-2.0
// Regenerates test/fixtures/fuse-7.1.0.json from the npm package used as the parity oracle.
//   FUSE_ORACLE=/path/to/node_modules/fuse.js bun scripts/gen-fixtures.ts
// The oracle is a build-time input only; nothing in src/ or test/ imports it.
import { join } from "node:path";

const oracleDir = process.env.FUSE_ORACLE;
if (!oracleDir) throw new Error("FUSE_ORACLE must point at the fuse.js 7.1.0 package directory");
type Oracle = new (
  docs: unknown[],
  options: Record<string, unknown>,
) => { search(query: string, options?: { limit?: number }): unknown[] };
const Fuse = ((await import(join(oracleDir, "dist", "fuse.mjs"))) as { default: Oracle }).default;

let seed = 0x2545f491;
const random = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
};
const int = (max: number) => Math.floor(random() * max);
const pick = <T>(list: readonly T[]) => list[int(list.length)]!;

const WORDS = [
  "gemma",
  "llama",
  "qwen",
  "mistral",
  "phi",
  "deepseek",
  "coder",
  "instruct",
  "chat",
  "base",
  "vision",
  "embed",
  "rerank",
  "small",
  "large",
  "tiny",
  "e2b",
  "e4b",
  "7b",
  "13b",
  "70b",
  "q4",
  "q8",
  "gguf",
  "onnx",
  "hf",
  "model",
  "text",
  "audio",
  "whisper",
  "stable",
  "diffusion",
  "bge",
  "nomic",
  "code",
  "math",
  "reasoning",
  "distill",
  "moe",
  "turbo",
  "pro",
  "lite",
  "é",
  "ü",
];
const phrase = (min: number, max: number) =>
  Array.from({ length: min + int(max - min + 1) }, () => pick(WORDS)).join(pick([" ", "-", "/"]));

type Doc = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  nested: { names: string[] };
};
const docs: Doc[] = Array.from({ length: 50 }, (_, i) => ({
  id: `${pick(WORDS)}-${i}`,
  title: phrase(1, 4),
  summary: phrase(4, 16),
  tags: Array.from({ length: int(4) }, () => phrase(1, 2)),
  nested: { names: Array.from({ length: 1 + int(3) }, () => phrase(1, 3)) },
}));
const strings = docs.map((doc) => doc.title);

const typo = (text: string) => {
  const chars = Array.from(text);
  if (chars.length < 3) return text;
  const at = int(chars.length);
  const kind = int(3);
  if (kind === 0) chars.splice(at, 1);
  else if (kind === 1) chars.splice(at, 0, pick(Array.from("abcdefgh")));
  else chars[at] = pick(Array.from("xyz"));
  return chars.join("");
};

const queries = (): string[] => {
  const out: string[] = ["", "a", "zzzzzz", "GEMMA", "gemma e2b", " llama "];
  for (let i = 0; i < 18; i += 1) {
    const doc = pick(docs);
    const source = pick([doc.title, doc.summary, doc.id, ...doc.tags, ...doc.nested.names]);
    const start = int(Math.max(1, source.length - 3));
    const slice = source.slice(start, start + 2 + int(12));
    out.push(random() < 0.5 ? slice : typo(slice));
  }
  out.push(phrase(8, 12)); // longer than 32 characters: exercises chunking
  out.push(docs[0]!.summary + docs[1]!.summary);
  return out;
};

const optionSets: Record<string, unknown>[] = [
  {},
  { includeScore: true, threshold: 0.3, ignoreLocation: true, keys: ["title"] },
  { includeScore: true, threshold: 0.3, ignoreLocation: true, keys: ["id", "title", "summary"] },
  {
    includeScore: true,
    threshold: 0.3,
    ignoreLocation: true,
    keys: ["tags", "nested.names", "summary"],
  },
  {
    includeScore: true,
    threshold: 0.4,
    keys: [
      { name: "title", weight: 3 },
      { name: "summary", weight: 1 },
    ],
  },
  { includeScore: true, threshold: 0.6, location: 10, distance: 50, keys: ["title", "tags"] },
  {
    includeScore: true,
    threshold: 0.2,
    minMatchCharLength: 3,
    includeMatches: true,
    keys: ["title", "summary"],
  },
  {
    includeScore: true,
    threshold: 0.5,
    findAllMatches: true,
    isCaseSensitive: true,
    keys: ["id", "title"],
  },
  {
    includeScore: true,
    threshold: 0.35,
    ignoreFieldNorm: true,
    fieldNormWeight: 2,
    keys: ["summary"],
  },
  {
    includeScore: true,
    includeMatches: true,
    threshold: 0.3,
    ignoreLocation: true,
    keys: ["nested.names"],
  },
  { includeScore: true, shouldSort: false, threshold: 0.3, keys: ["title"] },
];

const cases: unknown[] = [];
const batch = queries();
for (const options of optionSets) {
  const subject = options.keys ? docs : strings;
  const keyed = Boolean(options.keys);
  const fuse = new Fuse(subject, options);
  for (const query of batch) {
    const limit = random() < 0.2 ? 5 : undefined;
    const results = fuse.search(query, limit ? { limit } : undefined);
    cases.push({ keyed, options, query, limit, results });
  }
}
// string list without options at all
const plain = new Fuse(strings, { includeScore: true });
for (const query of batch) {
  cases.push({
    keyed: false,
    options: { includeScore: true },
    query,
    results: plain.search(query),
  });
}

const target = new URL("../test/fixtures/fuse-7.1.0.json", import.meta.url);
await Bun.write(target, `${JSON.stringify({ oracle: "fuse.js@7.1.0", docs, strings, cases })}\n`);
console.log(`wrote ${cases.length} cases (${Bun.file(target).size} bytes)`);
