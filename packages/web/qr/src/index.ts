// SPDX-License-Identifier: Apache-2.0
// First-party QR Code encoder (ISO/IEC 18004, model 2) and canvas renderer.
//
// Algorithms and tables follow qrcode 1.5.4 (MIT, Copyright (c) 2012 Ryan Day, itself derived from
// Kazuhiko Arase's QRCode for JavaScript, MIT) and dijkstrajs 1.0.3 (MIT, Wyatt Baldwin) so that
// symbols are module-for-module identical; test/parity.test.ts checks that against fixtures
// generated from the npm package. Kanji mode is not implemented (qrcode enables it only when a
// Shift JIS converter is supplied, which the browser build never does).

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export type QrOptions = {
  errorCorrectionLevel?: ErrorCorrectionLevel | "low" | "medium" | "quartile" | "high";
  /** Force a version (1-40); throws when the data does not fit. */
  version?: number;
  /** Force a mask pattern (0-7). */
  maskPattern?: number;
};

type ModeId = "numeric" | "alphanumeric" | "byte";

export type QrSymbol = {
  modules: { size: number; data: Uint8Array };
  version: number;
  errorCorrectionLevel: ErrorCorrectionLevel;
  maskPattern: number;
  segments: { mode: ModeId; length: number }[];
};

type Mode = { id: ModeId; bit: number; ccBits: [number, number, number] };

const NUMERIC: Mode = { id: "numeric", bit: 1, ccBits: [10, 12, 14] };
const ALPHANUMERIC: Mode = { id: "alphanumeric", bit: 2, ccBits: [9, 11, 13] };
const BYTE: Mode = { id: "byte", bit: 4, ccBits: [8, 16, 16] };

const EC_BIT: Record<ErrorCorrectionLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
const EC_INDEX: Record<ErrorCorrectionLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Rows are versions 1..40, columns L M Q H.
const EC_BLOCKS = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4, 2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6, 2,
  5, 8, 8, 4, 5, 8, 8, 4, 5, 8, 11, 4, 8, 10, 11, 4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18, 6, 10,
  17, 16, 6, 11, 16, 19, 6, 13, 18, 21, 7, 14, 21, 25, 8, 16, 20, 25, 8, 17, 23, 25, 9, 17, 23, 34,
  9, 18, 25, 30, 10, 20, 27, 32, 12, 21, 29, 35, 12, 23, 34, 37, 12, 25, 34, 40, 13, 26, 35, 42, 14,
  28, 38, 45, 15, 29, 40, 48, 16, 31, 43, 51, 17, 33, 45, 54, 18, 35, 48, 57, 19, 37, 51, 60, 19,
  38, 53, 63, 20, 40, 56, 66, 21, 43, 59, 70, 22, 45, 62, 74, 24, 47, 65, 77, 25, 49, 68, 81,
];

const EC_CODEWORDS = [
  7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64, 26, 48, 72, 88, 36, 64, 96, 112,
  40, 72, 108, 130, 48, 88, 132, 156, 60, 110, 160, 192, 72, 130, 192, 224, 80, 150, 224, 264, 96,
  176, 260, 308, 104, 198, 288, 352, 120, 216, 320, 384, 132, 240, 360, 432, 144, 280, 408, 480,
  168, 308, 448, 532, 180, 338, 504, 588, 196, 364, 546, 650, 224, 416, 600, 700, 224, 442, 644,
  750, 252, 476, 690, 816, 270, 504, 750, 900, 300, 560, 810, 960, 312, 588, 870, 1050, 336, 644,
  952, 1110, 360, 700, 1020, 1200, 390, 728, 1050, 1260, 420, 784, 1140, 1350, 450, 812, 1200, 1440,
  480, 868, 1290, 1530, 510, 924, 1350, 1620, 540, 980, 1440, 1710, 570, 1036, 1530, 1800, 570,
  1064, 1590, 1890, 600, 1120, 1680, 1980, 630, 1204, 1770, 2100, 660, 1260, 1860, 2220, 720, 1316,
  1950, 2310, 750, 1372, 2040, 2430,
];

const CODEWORDS = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
  1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876,
  3034, 3196, 3362, 3532, 3706,
];

const symbolSize = (version: number) => version * 4 + 17;
const bchDigit = (value: number) => 32 - Math.clz32(value);
const ecBlocks = (version: number, level: ErrorCorrectionLevel) =>
  EC_BLOCKS[(version - 1) * 4 + EC_INDEX[level]]!;
const ecCodewords = (version: number, level: ErrorCorrectionLevel) =>
  EC_CODEWORDS[(version - 1) * 4 + EC_INDEX[level]]!;

const charCountBits = (mode: Mode, version: number) =>
  version < 10 ? mode.ccBits[0] : version < 27 ? mode.ccBits[1] : mode.ccBits[2];

// ---- Galois field and Reed-Solomon ------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gfMul = (x: number, y: number) => (x === 0 || y === 0 ? 0 : EXP[LOG[x]! + LOG[y]!]!);

function polyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const coeff = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) coeff[i + j]! ^= gfMul(p1[i]!, p2[j]!);
  }
  return coeff;
}

function polyMod(dividend: Uint8Array, divisor: Uint8Array): Uint8Array {
  let result = new Uint8Array(dividend);
  while (result.length - divisor.length >= 0) {
    const coeff = result[0]!;
    for (let i = 0; i < divisor.length; i++) result[i]! ^= gfMul(divisor[i]!, coeff);
    let offset = 0;
    while (offset < result.length && result[offset] === 0) offset++;
    result = result.slice(offset);
  }
  return result;
}

function generatorPolynomial(degree: number): Uint8Array {
  let poly: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) poly = polyMul(poly, new Uint8Array([1, EXP[i]!]));
  return poly;
}

function rsEncode(data: Uint8Array, degree: number): Uint8Array {
  const padded = new Uint8Array(data.length + degree);
  padded.set(data);
  const remainder = polyMod(padded, generatorPolynomial(degree));
  const start = degree - remainder.length;
  if (start > 0) {
    const out = new Uint8Array(degree);
    out.set(remainder, start);
    return out;
  }
  return remainder;
}

// ---- Bit buffer and data segments -------------------------------------------------------------

class BitBuffer {
  buffer: number[] = [];
  length = 0;
  putBit(bit: boolean) {
    const index = Math.floor(this.length / 8);
    if (this.buffer.length <= index) this.buffer.push(0);
    if (bit) this.buffer[index]! |= 0x80 >>> (this.length % 8);
    this.length++;
  }
  put(num: number, length: number) {
    for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
  }
}

type Segment = { mode: Mode; length: number; bitsLength: number; write(buffer: BitBuffer): void };

const ALPHA_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const encoder = new TextEncoder();
const utf8Length = (text: string) => encoder.encode(text).length;

const numericBits = (length: number) =>
  10 * Math.floor(length / 3) + (length % 3 ? (length % 3) * 3 + 1 : 0);
const alphanumericBits = (length: number) => 11 * Math.floor(length / 2) + 6 * (length % 2);
const byteBits = (length: number) => length * 8;

function segmentBits(length: number, mode: Mode): number {
  return mode === NUMERIC
    ? numericBits(length)
    : mode === ALPHANUMERIC
      ? alphanumericBits(length)
      : byteBits(length);
}

function makeSegment(data: string, mode: Mode): Segment {
  if (mode === NUMERIC) {
    return {
      mode,
      length: data.length,
      bitsLength: numericBits(data.length),
      write(buffer) {
        let i = 0;
        for (; i + 3 <= data.length; i += 3) {
          buffer.put(Number.parseInt(data.slice(i, i + 3), 10), 10);
        }
        const rest = data.length - i;
        if (rest > 0) buffer.put(Number.parseInt(data.slice(i), 10), rest * 3 + 1);
      },
    };
  }
  if (mode === ALPHANUMERIC) {
    return {
      mode,
      length: data.length,
      bitsLength: alphanumericBits(data.length),
      write(buffer) {
        let i = 0;
        for (; i + 2 <= data.length; i += 2) {
          buffer.put(ALPHA_CHARS.indexOf(data[i]!) * 45 + ALPHA_CHARS.indexOf(data[i + 1]!), 11);
        }
        if (data.length % 2) buffer.put(ALPHA_CHARS.indexOf(data[i]!), 6);
      },
    };
  }
  const bytes = encoder.encode(data);
  return {
    mode,
    length: bytes.length,
    bitsLength: byteBits(bytes.length),
    write(buffer) {
      for (const byte of bytes) buffer.put(byte, 8);
    },
  };
}

type RawSegment = { data: string; mode: Mode; length: number };

function rawSegments(text: string): RawSegment[] {
  const collect = (pattern: RegExp, mode: Mode) => {
    const out: (RawSegment & { index: number })[] = [];
    for (const match of text.matchAll(pattern)) {
      out.push({ data: match[0], index: match.index, mode, length: match[0].length });
    }
    return out;
  };
  const all = [
    ...collect(/[0-9]+/g, NUMERIC),
    ...collect(/[A-Z $%*+\-./:]+/g, ALPHANUMERIC),
    ...collect(/[^A-Z0-9 $%*+\-./:]+/g, BYTE),
  ];
  return all
    .toSorted((a, b) => a.index - b.index)
    .map(({ data, mode, length }) => ({ data, mode, length }));
}

function buildNodes(segments: RawSegment[]): RawSegment[][] {
  return segments.map((seg) => {
    if (seg.mode === NUMERIC) {
      return [
        seg,
        { data: seg.data, mode: ALPHANUMERIC, length: seg.length },
        { data: seg.data, mode: BYTE, length: seg.length },
      ];
    }
    if (seg.mode === ALPHANUMERIC) {
      return [seg, { data: seg.data, mode: BYTE, length: seg.length }];
    }
    return [{ data: seg.data, mode: BYTE, length: utf8Length(seg.data) }];
  });
}

type Graph = Record<string, Record<string, number>>;

function buildGraph(nodes: RawSegment[][], version: number) {
  const table: Record<string, { node: RawSegment; lastCount: number }> = {};
  const graph: Graph = { start: {} };
  let previous = ["start"];
  nodes.forEach((group, i) => {
    const current: string[] = [];
    group.forEach((node, j) => {
      const key = `${i}${j}`;
      current.push(key);
      table[key] = { node, lastCount: 0 };
      graph[key] = {};
      for (const prevId of previous) {
        const prev = table[prevId];
        if (prev && prev.node.mode === node.mode) {
          graph[prevId]![key] =
            segmentBits(prev.lastCount + node.length, node.mode) -
            segmentBits(prev.lastCount, node.mode);
          prev.lastCount += node.length;
        } else {
          if (prev) prev.lastCount = node.length;
          graph[prevId]![key] =
            segmentBits(node.length, node.mode) + 4 + charCountBits(node.mode, version);
        }
      }
    });
    previous = current;
  });
  for (const id of previous) graph[id]!.end = 0;
  return { map: graph, table };
}

/** dijkstrajs 1.0.3 find_path: stable-sorted queue, strict improvement, same tie-breaking. */
function findPath(graph: Graph, source: string, destination: string): string[] {
  const predecessors: Record<string, string> = {};
  const costs: Record<string, number> = { [source]: 0 };
  let queue: { value: string; cost: number }[] = [{ value: source, cost: 0 }];
  while (queue.length > 0) {
    const closest = queue.shift()!;
    const adjacent = graph[closest.value] ?? {};
    for (const v in adjacent) {
      const total = closest.cost + adjacent[v]!;
      const known = costs[v];
      if (known === undefined || known > total) {
        costs[v] = total;
        queue.push({ value: v, cost: total });
        queue = queue.toSorted((a, b) => a.cost - b.cost);
        predecessors[v] = closest.value;
      }
    }
  }
  if (costs[destination] === undefined) throw new Error(`No path from ${source} to ${destination}`);
  const nodes: string[] = [];
  let u: string | undefined = destination;
  while (u) {
    nodes.push(u);
    u = predecessors[u];
  }
  return nodes.toReversed();
}

function mergeSegments(segments: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const current of segments) {
    const previous = out.at(-1);
    if (previous && previous.mode === current.mode) {
      out[out.length - 1] = { ...previous, data: previous.data + current.data };
    } else {
      out.push({ ...current });
    }
  }
  return out;
}

const toSegments = (raw: RawSegment[]): Segment[] =>
  raw.map((seg) => makeSegment(seg.data, seg.mode));

function optimizedSegments(text: string, version: number): Segment[] {
  const graph = buildGraph(buildNodes(rawSegments(text)), version);
  const path = findPath(graph.map, "start", "end");
  const optimized: RawSegment[] = [];
  for (let i = 1; i < path.length - 1; i++) optimized.push(graph.table[path[i]!]!.node);
  return toSegments(mergeSegments(optimized));
}

// ---- Versions ---------------------------------------------------------------------------------

function totalBits(segments: Segment[], version: number): number {
  let bits = 0;
  for (const seg of segments) bits += charCountBits(seg.mode, version) + 4 + seg.bitsLength;
  return bits;
}

const dataCapacityBits = (version: number, level: ErrorCorrectionLevel) =>
  (CODEWORDS[version]! - ecCodewords(version, level)) * 8;

function capacity(version: number, level: ErrorCorrectionLevel, mode: Mode): number {
  const usable = dataCapacityBits(version, level) - (charCountBits(mode, version) + 4);
  if (mode === NUMERIC) return Math.floor((usable / 10) * 3);
  if (mode === ALPHANUMERIC) return Math.floor((usable / 11) * 2);
  return Math.floor(usable / 8);
}

function bestVersion(segments: Segment[], level: ErrorCorrectionLevel): number | undefined {
  if (segments.length === 0) return 1;
  for (let version = 1; version <= 40; version++) {
    if (segments.length > 1) {
      if (totalBits(segments, version) <= dataCapacityBits(version, level)) return version;
    } else if (segments[0]!.length <= capacity(version, level, segments[0]!.mode)) {
      return version;
    }
  }
  return undefined;
}

const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | 1;
const G18_BCH = bchDigit(G18);

function versionBits(version: number): number {
  let d = version << 12;
  while (bchDigit(d) - G18_BCH >= 0) d ^= G18 << (bchDigit(d) - G18_BCH);
  return (version << 12) | d;
}

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | 1;
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
const G15_BCH = bchDigit(G15);

function formatBits(level: ErrorCorrectionLevel, mask: number): number {
  const data = (EC_BIT[level] << 3) | mask;
  let d = data << 10;
  while (bchDigit(d) - G15_BCH >= 0) d ^= G15 << (bchDigit(d) - G15_BCH);
  return ((data << 10) | d) ^ G15_MASK;
}

// ---- Matrix -----------------------------------------------------------------------------------

class BitMatrix {
  data: Uint8Array;
  reserved: Uint8Array;
  constructor(readonly size: number) {
    this.data = new Uint8Array(size * size);
    this.reserved = new Uint8Array(size * size);
  }
  set(row: number, col: number, value: boolean | number, reserved = false) {
    const index = row * this.size + col;
    this.data[index] = Number(value);
    if (reserved) this.reserved[index] = 1;
  }
  get(row: number, col: number) {
    return this.data[row * this.size + col]!;
  }
  xor(row: number, col: number, value: boolean) {
    this.data[row * this.size + col]! ^= Number(value);
  }
  isReserved(row: number, col: number) {
    return this.reserved[row * this.size + col] === 1;
  }
}

function setupFinder(matrix: BitMatrix) {
  const size = matrix.size;
  for (const [row, col] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || size <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || size <= col + c) continue;
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix.set(row + r, col + c, dark, true);
      }
    }
  }
}

function setupTiming(matrix: BitMatrix) {
  for (let r = 8; r < matrix.size - 8; r++) {
    const value = r % 2 === 0;
    matrix.set(r, 6, value, true);
    matrix.set(6, r, value, true);
  }
}

function alignmentCoords(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = symbolSize(version);
  const interval = size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
  const positions = [size - 7];
  for (let i = 1; i < count - 1; i++) positions[i] = positions[i - 1]! - interval;
  positions.push(6);
  return positions.toReversed();
}

function setupAlignment(matrix: BitMatrix, version: number) {
  const pos = alignmentCoords(version);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      const row = pos[i]!;
      const col = pos[j]!;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          matrix.set(row + r, col + c, dark, true);
        }
      }
    }
  }
}

function setupVersionInfo(matrix: BitMatrix, version: number) {
  const size = matrix.size;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const row = Math.floor(i / 3);
    const col = (i % 3) + size - 8 - 3;
    const mod = ((bits >> i) & 1) === 1;
    matrix.set(row, col, mod, true);
    matrix.set(col, row, mod, true);
  }
}

function setupFormatInfo(matrix: BitMatrix, level: ErrorCorrectionLevel, mask: number) {
  const size = matrix.size;
  const bits = formatBits(level, mask);
  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 6) matrix.set(i, 8, mod, true);
    else if (i < 8) matrix.set(i + 1, 8, mod, true);
    else matrix.set(size - 15 + i, 8, mod, true);
    if (i < 8) matrix.set(8, size - i - 1, mod, true);
    else if (i < 9) matrix.set(8, 15 - i - 1 + 1, mod, true);
    else matrix.set(8, 15 - i - 1, mod, true);
  }
  matrix.set(size - 8, 8, 1, true);
}

function setupData(matrix: BitMatrix, data: Uint8Array) {
  const size = matrix.size;
  let inc = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (!matrix.isReserved(row, col - c)) {
          let dark = false;
          if (byteIndex < data.length) dark = ((data[byteIndex]! >>> bitIndex) & 1) === 1;
          matrix.set(row, col - c, dark);
          bitIndex--;
          if (bitIndex === -1) {
            byteIndex++;
            bitIndex = 7;
          }
        }
      }
      row += inc;
      if (row < 0 || size <= row) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

// ---- Masks ------------------------------------------------------------------------------------

function maskAt(pattern: number, i: number, j: number): boolean {
  switch (pattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7:
      return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    default:
      throw new Error(`bad maskPattern: ${pattern}`);
  }
}

function applyMask(pattern: number, matrix: BitMatrix) {
  const size = matrix.size;
  for (let col = 0; col < size; col++) {
    for (let row = 0; row < size; row++) {
      if (!matrix.isReserved(row, col)) matrix.xor(row, col, maskAt(pattern, row, col));
    }
  }
}

function penaltyN1(m: BitMatrix): number {
  const size = m.size;
  let points = 0;
  for (let row = 0; row < size; row++) {
    let sameCol = 0;
    let sameRow = 0;
    let lastCol: number | null = null;
    let lastRow: number | null = null;
    for (let col = 0; col < size; col++) {
      let module = m.get(row, col);
      if (module === lastCol) sameCol++;
      else {
        if (sameCol >= 5) points += 3 + (sameCol - 5);
        lastCol = module;
        sameCol = 1;
      }
      module = m.get(col, row);
      if (module === lastRow) sameRow++;
      else {
        if (sameRow >= 5) points += 3 + (sameRow - 5);
        lastRow = module;
        sameRow = 1;
      }
    }
    if (sameCol >= 5) points += 3 + (sameCol - 5);
    if (sameRow >= 5) points += 3 + (sameRow - 5);
  }
  return points;
}

function penaltyN2(m: BitMatrix): number {
  let points = 0;
  for (let row = 0; row < m.size - 1; row++) {
    for (let col = 0; col < m.size - 1; col++) {
      const last =
        m.get(row, col) + m.get(row, col + 1) + m.get(row + 1, col) + m.get(row + 1, col + 1);
      if (last === 4 || last === 0) points++;
    }
  }
  return points * 3;
}

function penaltyN3(m: BitMatrix): number {
  let points = 0;
  for (let row = 0; row < m.size; row++) {
    let bitsCol = 0;
    let bitsRow = 0;
    for (let col = 0; col < m.size; col++) {
      bitsCol = ((bitsCol << 1) & 0x7ff) | m.get(row, col);
      if (col >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) points++;
      bitsRow = ((bitsRow << 1) & 0x7ff) | m.get(col, row);
      if (col >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) points++;
    }
  }
  return points * 40;
}

function penaltyN4(m: BitMatrix): number {
  let dark = 0;
  for (const value of m.data) dark += value;
  const k = Math.abs(Math.ceil((dark * 100) / m.data.length / 5) - 10);
  return k * 10;
}

function bestMask(matrix: BitMatrix, level: ErrorCorrectionLevel): number {
  let best = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (let p = 0; p < 8; p++) {
    setupFormatInfo(matrix, level, p);
    applyMask(p, matrix);
    const penalty = penaltyN1(matrix) + penaltyN2(matrix) + penaltyN3(matrix) + penaltyN4(matrix);
    applyMask(p, matrix);
    if (penalty < lowest) {
      lowest = penalty;
      best = p;
    }
  }
  return best;
}

// ---- Codewords --------------------------------------------------------------------------------

function createCodewords(buffer: BitBuffer, version: number, level: ErrorCorrectionLevel) {
  const total = CODEWORDS[version]!;
  const dataTotal = total - ecCodewords(version, level);
  const blocks = ecBlocks(version, level);
  const group2 = total % blocks;
  const group1 = blocks - group2;
  const dataInGroup1 = Math.floor(dataTotal / blocks);
  const dataInGroup2 = dataInGroup1 + 1;
  const ecCount = Math.floor(total / blocks) - dataInGroup1;
  const bytes = new Uint8Array(buffer.buffer);
  const dc: Uint8Array[] = [];
  const ec: Uint8Array[] = [];
  let offset = 0;
  let maxData = 0;
  for (let b = 0; b < blocks; b++) {
    const size = b < group1 ? dataInGroup1 : dataInGroup2;
    dc[b] = bytes.slice(offset, offset + size);
    ec[b] = rsEncode(dc[b]!, ecCount);
    offset += size;
    maxData = Math.max(maxData, size);
  }
  const out = new Uint8Array(total);
  let index = 0;
  for (let i = 0; i < maxData; i++) {
    for (let r = 0; r < blocks; r++) if (i < dc[r]!.length) out[index++] = dc[r]![i]!;
  }
  for (let i = 0; i < ecCount; i++) {
    for (let r = 0; r < blocks; r++) out[index++] = ec[r]![i]!;
  }
  return out;
}

function createData(segments: Segment[], version: number, level: ErrorCorrectionLevel) {
  const buffer = new BitBuffer();
  for (const seg of segments) {
    buffer.put(seg.mode.bit, 4);
    buffer.put(seg.length, charCountBits(seg.mode, version));
    seg.write(buffer);
  }
  const capacityBits = dataCapacityBits(version, level);
  if (buffer.length + 4 <= capacityBits) buffer.put(0, 4);
  while (buffer.length % 8 !== 0) buffer.putBit(false);
  const remaining = (capacityBits - buffer.length) / 8;
  for (let i = 0; i < remaining; i++) buffer.put(i % 2 ? 0x11 : 0xec, 8);
  return createCodewords(buffer, version, level);
}

// ---- Public API -------------------------------------------------------------------------------

function normalizeLevel(value: QrOptions["errorCorrectionLevel"]): ErrorCorrectionLevel {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "l":
    case "low":
      return "L";
    case "q":
    case "quartile":
      return "Q";
    case "h":
    case "high":
      return "H";
    default:
      return "M";
  }
}

/** Encode `text` into a QR symbol (same version, segments and mask choice as qrcode 1.5.4). */
export function createQr(text: string, options: QrOptions = {}): QrSymbol {
  if (typeof text !== "string" || text === "") throw new Error("No input text");
  const level = normalizeLevel(options.errorCorrectionLevel);
  const requested = options.version;
  let version =
    Number.isInteger(requested) && requested! >= 1 && requested! <= 40 ? requested : undefined;
  const maskOption = options.maskPattern;
  const mask =
    Number.isInteger(maskOption) && maskOption! >= 0 && maskOption! <= 7 ? maskOption : undefined;

  const estimated = version ?? bestVersion(toSegments(rawSegments(text)), level);
  const segments = optimizedSegments(text, estimated ?? 40);
  const best = bestVersion(segments, level);
  if (!best) throw new Error("The amount of data is too big to be stored in a QR Code");
  if (!version) version = best;
  else if (version < best) {
    throw new Error(
      `The chosen QR Code version cannot contain this amount of data. Minimum version required: ${best}`,
    );
  }

  const dataBits = createData(segments, version, level);
  const modules = new BitMatrix(symbolSize(version));
  setupFinder(modules);
  setupTiming(modules);
  setupAlignment(modules, version);
  setupFormatInfo(modules, level, 0);
  if (version >= 7) setupVersionInfo(modules, version);
  setupData(modules, dataBits);

  const maskPattern = mask ?? bestMask(modules, level);
  applyMask(maskPattern, modules);
  setupFormatInfo(modules, level, maskPattern);

  return {
    modules: { size: modules.size, data: modules.data },
    version,
    errorCorrectionLevel: level,
    maskPattern,
    segments: segments.map((seg) => ({ mode: seg.mode.id, length: seg.length })),
  };
}

export type RenderOptions = {
  /** Output width in pixels; honoured when at least modules + 2 * margin. */
  width?: number;
  /** Pixels per module when no width applies. Default 4. */
  scale?: number;
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  color?: { dark?: string; light?: string };
};

type Rgba = { r: number; g: number; b: number; a: number };

function parseHex(value: string): Rgba {
  let hex = value.replace("#", "").split("");
  if (hex.length < 3 || hex.length === 5 || hex.length > 8) {
    throw new Error(`Invalid hex color: ${value}`);
  }
  if (hex.length === 3 || hex.length === 4) hex = hex.flatMap((c) => [c, c]);
  if (hex.length === 6) hex.push("F", "F");
  const n = Number.parseInt(hex.join(""), 16);
  return { r: (n >> 24) & 255, g: (n >> 16) & 255, b: (n >> 8) & 255, a: n & 255 };
}

function resolveRender(size: number, options: RenderOptions = {}) {
  const margin = options.margin == null || options.margin < 0 ? 4 : options.margin;
  const width = options.width && options.width >= 21 ? options.width : undefined;
  const scale = width ? 4 : options.scale || 4;
  const effective = width && width >= size + margin * 2 ? width / (size + margin * 2) : scale;
  return {
    margin,
    scale: effective,
    side: Math.floor((size + margin * 2) * effective),
    dark: parseHex(options.color?.dark ?? "#000000ff"),
    light: parseHex(options.color?.light ?? "#ffffffff"),
  };
}

/** RGBA pixels of the symbol, `side * side * 4` bytes. */
export function renderQrPixels(symbol: QrSymbol, options?: RenderOptions) {
  const { size, data } = symbol.modules;
  const { margin, scale, side, dark, light } = resolveRender(size, options);
  const pixels = new Uint8ClampedArray(side * side * 4);
  const scaledMargin = margin * scale;
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      let at = (i * side + j) * 4;
      let color = light;
      if (
        i >= scaledMargin &&
        j >= scaledMargin &&
        i < side - scaledMargin &&
        j < side - scaledMargin
      ) {
        const row = Math.floor((i - scaledMargin) / scale);
        const col = Math.floor((j - scaledMargin) / scale);
        color = data[row * size + col] ? dark : light;
      }
      pixels[at++] = color.r;
      pixels[at++] = color.g;
      pixels[at++] = color.b;
      pixels[at] = color.a;
    }
  }
  return { width: side, height: side, pixels };
}

export type QrCanvas = {
  width: number;
  height: number;
  style?: { width: string; height: string };
  getContext(type: "2d"): {
    clearRect(x: number, y: number, w: number, h: number): void;
    putImageData(image: ImageData, x: number, y: number): void;
  } | null;
};

/** Draw the symbol on a 2D canvas (browser or CEF), like `QRCode.toCanvas(canvas, text, options)`. */
export function drawQr(
  canvas: QrCanvas,
  text: string,
  options: RenderOptions & QrOptions = {},
): QrCanvas {
  const symbol = createQr(text, options);
  const { width, height, pixels } = renderQrPixels(symbol, options);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = width;
  canvas.height = height;
  if (canvas.style) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}
