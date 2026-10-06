// SPDX-License-Identifier: Apache-2.0
// First-party Bitap fuzzy search. Scoring, field-length norm, key weights, chunking of long
// patterns and tie-breaking follow fuse.js 7.1.0 (Apache-2.0, Copyright 2023 Kiro Risk) so that
// the results and scores are identical; test/parity.test.ts checks that against fixtures generated
// from the npm package. Not implemented: extended search, logical queries, diacritic folding and
// index serialisation (none are used by Aphrody).

export type FuzzyKey =
  | string
  | readonly string[]
  | { name: string | readonly string[]; weight?: number };

export type FuzzyOptions<T> = {
  keys?: readonly FuzzyKey[];
  /** Case-sensitive matching. Default false. */
  isCaseSensitive?: boolean;
  /** Attach the score to every result. Default false. */
  includeScore?: boolean;
  /** Attach the matched character ranges to every result. Default false. */
  includeMatches?: boolean;
  /** Sort by ascending score then index. Default true. */
  shouldSort?: boolean;
  /** Default 0. */
  location?: number;
  /** 0 requires a perfect match, 1 matches anything. Default 0.6. */
  threshold?: number;
  /** Default 100. */
  distance?: number;
  /** Ignore location and distance. Default false. */
  ignoreLocation?: boolean;
  /** Default 1. */
  minMatchCharLength?: number;
  /** Default false. */
  findAllMatches?: boolean;
  /** Ignore the field-length norm. Default false. */
  ignoreFieldNorm?: boolean;
  /** Default 1. */
  fieldNormWeight?: number;
  /** Custom accessor for a key's value(s). */
  getFn?: (item: T, path: string[]) => string | string[] | undefined;
};

export type FuzzyMatch = {
  key?: string;
  value: string;
  refIndex?: number;
  indices: [number, number][];
};

export type FuzzyResult<T> = {
  item: T;
  refIndex: number;
  score?: number;
  matches?: FuzzyMatch[];
};

type Resolved = Required<
  Pick<
    FuzzyOptions<unknown>,
    | "isCaseSensitive"
    | "includeScore"
    | "includeMatches"
    | "shouldSort"
    | "location"
    | "threshold"
    | "distance"
    | "ignoreLocation"
    | "minMatchCharLength"
    | "findAllMatches"
    | "ignoreFieldNorm"
    | "fieldNormWeight"
  >
>;

const DEFAULTS: Resolved = {
  isCaseSensitive: false,
  includeScore: false,
  includeMatches: false,
  shouldSort: true,
  location: 0,
  threshold: 0.6,
  distance: 100,
  ignoreLocation: false,
  minMatchCharLength: 1,
  findAllMatches: false,
  ignoreFieldNorm: false,
  fieldNormWeight: 1,
};

const MAX_BITS = 32;
const SPACE = /[^ ]+/g;

type Match = {
  score: number;
  key?: Key;
  value: string;
  idx?: number;
  norm: number;
  indices: [number, number][];
};

type Key = { path: string[]; id: string; weight: number };
type SubRecord = { v: string; i?: number; n: number };
type Record_ = { i: number; $: (SubRecord | SubRecord[] | undefined)[] };

const isDefined = (value: unknown) => value !== undefined && value !== null;
const isBlank = (value: string) => !value.trim().length;

function accessor(item: unknown, path: string[]): string | string[] | undefined {
  const list: string[] = [];
  let isArray = false;
  const deepGet = (obj: unknown, index: number) => {
    if (!isDefined(obj)) return;
    const segment = path[index];
    if (!segment) {
      list.push(obj as string);
      return;
    }
    const value = (obj as Record<string, unknown>)[segment];
    if (!isDefined(value)) return;
    if (
      index === path.length - 1 &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    ) {
      list.push(typeof value === "string" ? value : Object.is(value, -0) ? "-0" : `${value}`);
    } else if (Array.isArray(value)) {
      isArray = true;
      for (const entry of value) deepGet(entry, index + 1);
    } else if (path.length) {
      deepGet(value, index + 1);
    }
  };
  deepGet(item, 0);
  return isArray ? list : list[0];
}

function computeScore(
  pattern: string,
  errors: number,
  currentLocation: number,
  expectedLocation: number,
  distance: number,
  ignoreLocation: boolean,
): number {
  const accuracy = errors / pattern.length;
  if (ignoreLocation) return accuracy;
  const proximity = Math.abs(expectedLocation - currentLocation);
  if (!distance) return proximity ? 1 : accuracy;
  return accuracy + proximity / distance;
}

function convertMaskToIndices(mask: number[], minMatchCharLength: number): [number, number][] {
  const indices: [number, number][] = [];
  let start = -1;
  let i = 0;
  for (const len = mask.length; i < len; i += 1) {
    const match = mask[i];
    if (match && start === -1) {
      start = i;
    } else if (!match && start !== -1) {
      const end = i - 1;
      if (end - start + 1 >= minMatchCharLength) indices.push([start, end]);
      start = -1;
    }
  }
  if (mask[i - 1] && i - start >= minMatchCharLength) indices.push([start, i - 1]);
  return indices;
}

type SearchParams = {
  location: number;
  distance: number;
  threshold: number;
  findAllMatches: boolean;
  minMatchCharLength: number;
  includeMatches: boolean;
  ignoreLocation: boolean;
};

function bitap(
  text: string,
  pattern: string,
  alphabet: Map<string, number>,
  params: SearchParams,
): { isMatch: boolean; score: number; indices?: [number, number][] } {
  const { location, distance, threshold, findAllMatches, minMatchCharLength, ignoreLocation } =
    params;
  const patternLen = pattern.length;
  const textLen = text.length;
  const expectedLocation = Math.max(0, Math.min(location, textLen));
  let currentThreshold = threshold;
  let bestLocation = expectedLocation;
  const computeMatches = minMatchCharLength > 1 || params.includeMatches;
  const matchMask: number[] = computeMatches ? Array.from({ length: textLen }) : [];

  let index: number;
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    const score = computeScore(pattern, 0, index, expectedLocation, distance, ignoreLocation);
    currentThreshold = Math.min(score, currentThreshold);
    bestLocation = index + patternLen;
    if (computeMatches) {
      for (let i = 0; i < patternLen; i += 1) matchMask[index + i] = 1;
    }
  }

  bestLocation = -1;
  let lastBitArr: number[] = [];
  let finalScore = 1;
  let binMax = patternLen + textLen;
  const mask = 1 << (patternLen - 1);

  for (let i = 0; i < patternLen; i += 1) {
    let binMin = 0;
    let binMid = binMax;
    while (binMin < binMid) {
      const score = computeScore(
        pattern,
        i,
        expectedLocation + binMid,
        expectedLocation,
        distance,
        ignoreLocation,
      );
      if (score <= currentThreshold) binMin = binMid;
      else binMax = binMid;
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;

    let start = Math.max(1, expectedLocation - binMid + 1);
    const finish = findAllMatches
      ? textLen
      : Math.min(expectedLocation + binMid, textLen) + patternLen;
    const bitArr: number[] = Array.from({ length: finish + 2 });
    bitArr[finish + 1] = (1 << i) - 1;

    for (let j = finish; j >= start; j -= 1) {
      const currentLocation = j - 1;
      const charMatch = alphabet.get(text.charAt(currentLocation)) ?? 0;
      if (computeMatches) matchMask[currentLocation] = +!!charMatch;

      bitArr[j] = (((bitArr[j + 1] ?? 0) << 1) | 1) & charMatch;
      if (i) {
        bitArr[j]! |=
          (((lastBitArr[j + 1] ?? 0) | (lastBitArr[j] ?? 0)) << 1) | 1 | (lastBitArr[j + 1] ?? 0);
      }
      if (bitArr[j]! & mask) {
        finalScore = computeScore(
          pattern,
          i,
          currentLocation,
          expectedLocation,
          distance,
          ignoreLocation,
        );
        if (finalScore <= currentThreshold) {
          currentThreshold = finalScore;
          bestLocation = currentLocation;
          if (bestLocation <= expectedLocation) break;
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }

    const score = computeScore(
      pattern,
      i + 1,
      expectedLocation,
      expectedLocation,
      distance,
      ignoreLocation,
    );
    if (score > currentThreshold) break;
    lastBitArr = bitArr;
  }

  const result: { isMatch: boolean; score: number; indices?: [number, number][] } = {
    isMatch: bestLocation >= 0,
    score: Math.max(0.001, finalScore),
  };
  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength);
    if (!indices.length) result.isMatch = false;
    else if (params.includeMatches) result.indices = indices;
  }
  return result;
}

class Searcher {
  readonly pattern: string;
  private chunks: { pattern: string; alphabet: Map<string, number>; startIndex: number }[] = [];

  constructor(
    pattern: string,
    private readonly options: Resolved,
  ) {
    this.pattern = options.isCaseSensitive ? pattern : pattern.toLowerCase();
    if (!this.pattern.length) return;
    const len = this.pattern.length;
    if (len > MAX_BITS) {
      let i = 0;
      const remainder = len % MAX_BITS;
      const end = len - remainder;
      while (i < end) {
        this.addChunk(this.pattern.slice(i, i + MAX_BITS), i);
        i += MAX_BITS;
      }
      if (remainder) {
        const startIndex = len - MAX_BITS;
        this.addChunk(this.pattern.slice(startIndex), startIndex);
      }
    } else {
      this.addChunk(this.pattern, 0);
    }
  }

  private addChunk(pattern: string, startIndex: number) {
    const alphabet = new Map<string, number>();
    for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern.charAt(i);
      alphabet.set(char, (alphabet.get(char) ?? 0) | (1 << (pattern.length - i - 1)));
    }
    this.chunks.push({ pattern, alphabet, startIndex });
  }

  searchIn(input: string): { isMatch: boolean; score: number; indices: [number, number][] } {
    const text = this.options.isCaseSensitive ? input : input.toLowerCase();
    if (this.pattern === text) {
      return {
        isMatch: true,
        score: 0,
        indices: this.options.includeMatches ? [[0, text.length - 1]] : [],
      };
    }
    let allIndices: [number, number][] = [];
    let totalScore = 0;
    let hasMatches = false;
    for (const { pattern, alphabet, startIndex } of this.chunks) {
      const { isMatch, score, indices } = bitap(text, pattern, alphabet, {
        location: this.options.location + startIndex,
        distance: this.options.distance,
        threshold: this.options.threshold,
        findAllMatches: this.options.findAllMatches,
        minMatchCharLength: this.options.minMatchCharLength,
        includeMatches: this.options.includeMatches,
        ignoreLocation: this.options.ignoreLocation,
      });
      if (isMatch) hasMatches = true;
      totalScore += score;
      if (isMatch && indices) allIndices = [...allIndices, ...indices];
    }
    return {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1,
      indices: hasMatches && this.options.includeMatches ? allIndices : [],
    };
  }
}

/** Fuzzy index over a list of strings or objects (`keys` select the searched fields). */
export class FuzzySearch<T> {
  private readonly options: Resolved;
  private readonly keys: Key[];
  private readonly getFn: NonNullable<FuzzyOptions<T>["getFn"]>;
  private readonly records: Record_[] = [];
  private readonly stringRecords: { v: string; i: number; n: number }[] = [];
  private readonly normCache = new Map<number, number>();
  private docs: T[];

  constructor(docs: readonly T[], options: FuzzyOptions<T> = {}) {
    this.options = { ...DEFAULTS };
    for (const name of Object.keys(DEFAULTS) as (keyof Resolved)[]) {
      const value = options[name];
      if (value !== undefined) (this.options as Record<string, unknown>)[name] = value;
    }
    this.getFn = options.getFn ?? ((item, path) => accessor(item, path));
    this.docs = [...docs];
    this.keys = (options.keys ?? []).map((key) => createKey(key));
    this.index();
  }

  private norm(value: string): number {
    const tokens = value.match(SPACE)!.length;
    const cached = this.normCache.get(tokens);
    if (cached !== undefined) return cached;
    const m = 1000;
    const n = Math.round((1 / Math.pow(tokens, 0.5 * this.options.fieldNormWeight)) * m) / m;
    this.normCache.set(tokens, n);
    return n;
  }

  private index() {
    if (!this.docs.length) return;
    if (typeof this.docs[0] === "string") {
      this.docs.forEach((doc, i) => {
        const text = doc as string;
        if (!isDefined(text) || isBlank(text)) return;
        this.stringRecords.push({ v: text, i, n: this.norm(text) });
      });
    } else {
      this.docs.forEach((doc, i) => this.addObject(doc, i));
    }
    this.normCache.clear();
  }

  private addObject(doc: T, docIndex: number) {
    const record: Record_ = { i: docIndex, $: [] };
    this.keys.forEach((key, keyIndex) => {
      const value = this.getFn(doc, key.path);
      if (!isDefined(value)) return;
      if (Array.isArray(value)) {
        const subRecords: SubRecord[] = [];
        const stack: { nestedArrIndex: number; value: unknown }[] = [{ nestedArrIndex: -1, value }];
        while (stack.length) {
          const { nestedArrIndex, value: entry } = stack.pop()!;
          if (!isDefined(entry)) continue;
          if (typeof entry === "string" && !isBlank(entry)) {
            subRecords.push({ v: entry, i: nestedArrIndex, n: this.norm(entry) });
          } else if (Array.isArray(entry)) {
            entry.forEach((item, k) => stack.push({ nestedArrIndex: k, value: item }));
          }
        }
        record.$[keyIndex] = subRecords;
      } else if (typeof value === "string" && !isBlank(value)) {
        record.$[keyIndex] = { v: value, n: this.norm(value) };
      }
    });
    this.records.push(record);
  }

  search(query: string, { limit = -1 }: { limit?: number } = {}): FuzzyResult<T>[] {
    const searcher = new Searcher(query, this.options);
    const stringList = typeof this.docs[0] === "string";
    const raw: { idx: number; matches: Match[]; score: number }[] = [];

    if (stringList) {
      for (const { v, i, n } of this.stringRecords) {
        const { isMatch, score, indices } = searcher.searchIn(v);
        if (isMatch)
          raw.push({ idx: i, score: 0, matches: [{ score, value: v, norm: n, indices }] });
      }
    } else {
      for (const { $: item, i } of this.records) {
        const matches: Match[] = [];
        this.keys.forEach((key, keyIndex) => {
          const value = item[keyIndex];
          if (!isDefined(value)) return;
          if (Array.isArray(value)) {
            for (const { v, i: idx, n } of value) {
              const { isMatch, score, indices } = searcher.searchIn(v);
              if (isMatch) matches.push({ score, key, value: v, idx, norm: n, indices });
            }
          } else {
            const { v, n } = value;
            const { isMatch, score, indices } = searcher.searchIn(v);
            if (isMatch) matches.push({ score, key, value: v, norm: n, indices });
          }
        });
        if (matches.length) raw.push({ idx: i, score: 0, matches });
      }
    }

    for (const result of raw) {
      let total = 1;
      for (const { key, norm, score } of result.matches) {
        const weight = key ? key.weight : null;
        total *= Math.pow(
          score === 0 && weight ? Number.EPSILON : score,
          (weight || 1) * (this.options.ignoreFieldNorm ? 1 : norm),
        );
      }
      result.score = total;
    }

    if (this.options.shouldSort) {
      raw.sort((a, b) =>
        a.score === b.score ? (a.idx < b.idx ? -1 : 1) : a.score < b.score ? -1 : 1,
      );
    }
    const limited = limit > -1 ? raw.slice(0, limit) : raw;

    return limited.map((result) => {
      const out: FuzzyResult<T> = { item: this.docs[result.idx]!, refIndex: result.idx };
      if (this.options.includeMatches) {
        out.matches = result.matches
          .filter((match) => match.indices.length)
          .map((match) => ({
            indices: match.indices,
            value: match.value,
            ...(match.key ? { key: match.key.id } : {}),
            ...(match.idx !== undefined ? { refIndex: match.idx } : {}),
          }));
      }
      if (this.options.includeScore) out.score = result.score;
      return out;
    });
  }
}

function createKey(key: FuzzyKey): Key {
  if (typeof key === "string" || Array.isArray(key)) {
    const path = typeof key === "string" ? key.split(".") : [...(key as readonly string[])];
    return { path, id: path.join("."), weight: 1 };
  }
  const named = key as { name: string | readonly string[]; weight?: number };
  const weight = named.weight ?? 1;
  if (weight <= 0)
    throw new Error(`Property 'weight' in key '${named.name}' must be a positive integer`);
  const path = typeof named.name === "string" ? named.name.split(".") : [...named.name];
  return { path, id: path.join("."), weight };
}
