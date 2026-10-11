// SPDX-License-Identifier: Apache-2.0
// Regenerates test/fixtures/qrcode-1.5.4.json from the npm package used as the parity oracle.
//   QRCODE_ORACLE=/path/to/node_modules/qrcode bun scripts/gen-fixtures.ts
// The oracle is a build-time input only; nothing in src/ or test/ imports it.
import { join } from "node:path";

const oracleDir = process.env.QRCODE_ORACLE;
if (!oracleDir) throw new Error("QRCODE_ORACLE must point at the qrcode 1.5.4 package directory");
const oracle = (await import(join(oracleDir, "lib", "core", "qrcode.js"))) as {
  default: {
    create(
      text: string,
      options?: Record<string, unknown>,
    ): {
      modules: { size: number; data: Uint8Array };
      version: number;
      maskPattern: number;
      errorCorrectionLevel: { bit: number };
    };
  };
};
const create = oracle.default.create;

let seed = 0x9e3779b9;
const random = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
};
const pick = (alphabet: string) => {
  const chars = Array.from(alphabet);
  return chars[Math.floor(random() * chars.length)]!;
};
const text = (alphabet: string, length: number) =>
  Array.from({ length }, () => pick(alphabet)).join("");

const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:0123456789";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const MIXED = `${LOWER}${DIGITS}${UPPER}{}":,_/ `;
const UNICODE = "aé€漢字😀ÜñЖ0123 ";

type Case = { text: string; options: Record<string, unknown> };
const cases: Case[] = [];
const levels = ["L", "M", "Q", "H", "low", "medium", "quartile", "high"];

cases.push({ text: "A", options: {} });
cases.push({ text: "https://aphrody.com/", options: { errorCorrectionLevel: "M" } });
cases.push({
  text: JSON.stringify({
    v: 1,
    host: "192.168.1.10",
    port: 8787,
    token: "k3Jx9-2Qa",
    ts: 1759766400,
  }),
  options: { errorCorrectionLevel: "M" },
});
for (const alphabet of [DIGITS, UPPER, LOWER, MIXED, UNICODE]) {
  for (const length of [1, 5, 17, 40, 120, 300]) {
    for (const level of levels.slice(0, 4)) {
      cases.push({ text: text(alphabet, length), options: { errorCorrectionLevel: level } });
    }
  }
}
for (const length of [900, 1500, 2300]) {
  cases.push({ text: text(MIXED, length), options: { errorCorrectionLevel: "L" } });
  cases.push({
    text: text(DIGITS, Math.min(length, 1700)),
    options: { errorCorrectionLevel: "H" },
  });
}
for (let i = 0; i < 60; i += 1) {
  const run = `${text(LOWER, 1 + Math.floor(random() * 6))}${text(DIGITS, Math.floor(random() * 20))}${text(UPPER, Math.floor(random() * 25))}`;
  cases.push({
    text: run + text(MIXED, Math.floor(random() * 30)),
    options: { errorCorrectionLevel: pick("LMQH") },
  });
}
for (const level of levels.slice(4))
  cases.push({ text: "named level", options: { errorCorrectionLevel: level } });
for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) {
  cases.push({ text: "mask me", options: { maskPattern: mask, errorCorrectionLevel: "Q" } });
}
for (const version of [1, 5, 7, 10, 20, 27, 40]) {
  cases.push({ text: "forced version", options: { version, errorCorrectionLevel: "M" } });
}

const packBits = (data: Uint8Array) => {
  const out = new Uint8Array(Math.ceil(data.length / 8));
  data.forEach((bit, i) => {
    if (bit) out[i >> 3]! |= 0x80 >> (i & 7);
  });
  return Buffer.from(out).toString("base64");
};

const fixtures = cases.map(({ text: input, options }) => {
  const symbol = create(input, options);
  return {
    text: input,
    options,
    version: symbol.version,
    maskPattern: symbol.maskPattern,
    size: symbol.modules.size,
    bits: packBits(symbol.modules.data),
  };
});

const target = new URL("../test/fixtures/qrcode-1.5.4.json", import.meta.url);
await Bun.write(target, `${JSON.stringify({ oracle: "qrcode@1.5.4", cases: fixtures })}\n`);
console.log(`wrote ${fixtures.length} fixtures (${Bun.file(target).size} bytes)`);
