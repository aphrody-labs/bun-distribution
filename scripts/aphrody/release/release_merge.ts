#!/usr/bin/env bun
/**
 * Merges the per-target release directories produced by `scripts/release/release.ts` (one CI job per OS)
 * into one release directory and regenerates `SHA256SUMS` and `release.json` over all assets.
 *
 *   bun run scripts/release/release_merge.ts <out-dir> <dir>...
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [outArg, ...inputs] = Bun.argv.slice(2);
if (outArg === undefined || inputs.length === 0) {
  console.error("usage: release_merge.ts <out-dir> <dir>...");
  process.exit(1);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const targets: string[] = [];
let version = "";
for (const input of inputs) {
  const meta = JSON.parse(
    readFileSync(join(input, "release.json"), "utf8"),
  ) as {
    version: string;
    target: string;
  };
  if (version !== "" && meta.version !== version)
    throw new Error(`version mismatch: ${meta.version} vs ${version}`);
  version = meta.version;
  targets.push(meta.target);
  for (const file of readdirSync(input)) {
    if (file === "SHA256SUMS" || file === "release.json") continue;
    if (
      existsSync(join(out, file)) &&
      !file.startsWith("install.") &&
      !file.includes("-crates.")
    ) {
      throw new Error(`duplicate asset ${file}`);
    }
    cpSync(join(input, file), join(out, file));
  }
}

const sha256 = (path: string): string =>
  new Bun.CryptoHasher("sha256")
    .update(new Uint8Array(readFileSync(path)))
    .digest("hex");
const files = readdirSync(out)
  .filter((f) => f !== "SHA256SUMS" && f !== "release.json")
  .toSorted();
writeFileSync(
  join(out, "SHA256SUMS"),
  `${files.map((f) => `${sha256(join(out, f))}  ${f}`).join("\n")}\n`,
);
writeFileSync(
  join(out, "release.json"),
  `${JSON.stringify({ name: "yolo", version, targets: targets.toSorted(), assets: files }, null, 2)}\n`,
);
console.log(
  `Merged ${targets.length} target(s) for ${version} into ${out}: ${targets.join(", ")}`,
);
