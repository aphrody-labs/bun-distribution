// SPDX-License-Identifier: Apache-2.0
/**
 * Build the Bun OS image's central, path-attributed license bundle.
 *
 * Source license and notice files remain in their owning trees. This bundle is
 * a distribution convenience; it does not replace upstream attribution or
 * change the terms applicable to any component.
 */
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const output = resolve(root, "factory/usr/overlay/usr/share/licenses/bun-os/LICENSE");
const listing = Bun.spawnSync(["rg", "--files", "-i"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
if (listing.exitCode !== 0) {
  throw new Error(new TextDecoder().decode(listing.stderr));
}

const outputRelative = output.slice(root.length + 1).replaceAll("\\", "/");
const isLicenseMaterial = (path: string) => {
  const normalized = path.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    /^(?:license|licence|copying|notice|copyright|authors|patents)(?:[-_.].*|$)/i.test(basename) ||
    /^third[._ -]?party.*(?:license|licen[cs]e|notice)/i.test(basename) ||
    /^attribution(?:[-_.].*|$)/i.test(basename)
  );
};

const paths = new TextDecoder()
  .decode(listing.stdout)
  .split(/\r?\n/)
  .map(path => path.trim())
  .filter(path => path && path.replaceAll("\\", "/") !== outputRelative)
  .filter(isLicenseMaterial)
  .map(path => path.replaceAll("\\", "/"))
  .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const entries = new Map<string, { paths: string[]; body: string }>();
for (const path of paths) {
  const bytes = await Bun.file(resolve(root, path)).bytes();
  let digestBytes = bytes;
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    body = body.replaceAll("\r\n", "\n");
    digestBytes = new TextEncoder().encode(body);
  } catch {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    body = `Base64-encoded non-UTF-8 source file follows:\n${btoa(binary)}`;
  }
  const digest = new Bun.CryptoHasher("sha256").update(digestBytes).digest("hex");
  const entry = entries.get(digest);
  if (entry) entry.paths.push(path);
  else entries.set(digest, { paths: [path], body });
}

const sections: string[] = [
  "BUN OS — CONSOLIDATED LICENSES, NOTICES AND ATTRIBUTIONS",
  "",
  "This bundle collects license, notice, copyright, author and attribution files present in this source checkout. Identical source files are included once; text line endings are normalized to LF and each index hash covers that UTF-8 text (binary inputs are hashed byte-for-byte). The index maps every original path to its text hash. The applicable terms belong to the component named by that path; this collection does not relicense imported, vendored, submodule or first-party work under one common license.",
  "",
  "Original source files and component-specific notices remain with their owners. Text entries are indented by four spaces so their contents render as plain text; remove exactly four leading spaces from each line to recover the indexed text. This bundle is provided for convenient distribution and review.",
  "",
  "INDEX: original path<TAB>sha256 of normalized source text",
];

for (const [digest, entry] of entries) {
  for (const path of entry.paths) sections.push(`${path}\t${digest}`);
}

sections.push("", "TEXTS: unique license and notice contents", "");
for (const [digest, entry] of entries) {
  const indentedBody = entry.body
    .split("\n")
    .map(line => `    ${line}`)
    .join("\n");
  sections.push(
    `--------------------------------------------------------------------------------\nSHA256: ${digest}\n--------------------------------------------------------------------------------\n${indentedBody}`,
  );
}

const contents = `${sections.join("\n")}\n`;
await Bun.write(output, contents);
console.log(
  `Wrote ${outputRelative}: ${paths.length} source files, ${entries.size} unique texts, ${new TextEncoder().encode(contents).byteLength} bytes.`,
);
