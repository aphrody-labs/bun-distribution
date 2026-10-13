// SPDX-License-Identifier: Apache-2.0
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { checkoutRoot as resolveCheckoutRoot, findWorkspaceRoot } from "@aphrody/paths";
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Resolve product inputs from the selected execution context, independent of UI package location. */
export function productBuildContext(env: NodeJS.ProcessEnv = process.env) {
  const workspaceRoot = findWorkspaceRoot(undefined, env);
  return {
    workspaceRoot,
    bunCheckout: resolveCheckoutRoot("bun", env),
    uiDist: join(workspaceRoot, "crates/ui/app/ui-dist"),
    publicAssets: join(workspaceRoot, "tools/config/public-assets.json"),
  };
}

export function canonicalBunInputs(checkout: string, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact Bun source revision required");
  const checkoutRoot = realpathSync(checkout);
  const ownedFile = (path: string) => {
    const file = join(checkoutRoot, path);
    const inside = relative(checkoutRoot, realpathSync(file));
    if (inside.startsWith(".." + sep) || isAbsolute(inside) || !lstatSync(file).isFile())
      throw new Error("Canonical Bun source file escapes the checkout");
    return file;
  };
  const receiptFile = ownedFile("packages/web/rust/transfer-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as {
    schemaVersion: number;
    sourceCommit: string;
    files: { source: string; destination: string; sha256: string }[];
  };
  const entry = receipt.files.find((file) => file.source === "crates/web/site/data/docs.json");
  if (
    receipt.schemaVersion !== 1 ||
    !entry ||
    entry.destination !== "packages/web/rust/crates/site/data/docs.json" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !/^[a-f0-9]{40}$/.test(receipt.sourceCommit)
  )
    throw new Error("Canonical Bun documentation transfer receipt required");
  const docs = ownedFile("packages/web/rust/crates/site/data/docs.json");
  if (sha(readFileSync(docs)) !== entry.sha256)
    throw new Error("Bun documentation transfer checksum mismatch");
  const search = ownedFile("packages/bun-google/src/search.ts");
  return {
    revision,
    transferSourceCommit: receipt.sourceCommit,
    transferSha256: sha(readFileSync(receiptFile)),
    docs: { path: entry.destination, sha256: entry.sha256 },
    search: { path: "packages/bun-google/src/search.ts", sha256: sha(readFileSync(search)) },
    docsFile: docs,
    searchFile: search,
  };
}
