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
    uiDist: join(workspaceRoot, "apps/aphrody-app/ui-dist"),
    publicAssets: join(workspaceRoot, "tools/aphrody/config/public-assets.json"),
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
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: checkoutRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.exitCode !== 0) throw new Error("Canonical Bun Git source qualification failed");
    return result.stdout;
  };
  if (git("rev-parse", "HEAD").toString().trim() !== revision)
    throw new Error("Canonical Bun checkout revision mismatch");
  const tracked = (path: string) => {
    const file = ownedFile(path);
    const object = `${revision}:${path}`;
    const size = Number(git("cat-file", "-s", object).toString().trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 * 1024)
      throw new Error("Canonical Bun source exceeds the build input bound");
    const bytes = readFileSync(file);
    const sha256 = sha(git("cat-file", "blob", object));
    if (bytes.length !== size || sha(bytes) !== sha256)
      throw new Error("Canonical Bun build input differs from its pinned Git blob");
    return {
      file,
      path,
      sha256,
      gitBlob: git("rev-parse", object).toString().trim(),
    };
  };
  const receiptInput = tracked("packages/web/rust/transfer-receipt.json");
  const receiptFile = receiptInput.file;
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as {
    schemaVersion: number;
    sourceCommit: string;
    files: { source: string; destination: string; sha256: string }[];
  };
  const entry = receipt.files.find(file => file.source === "crates/web/site/data/docs.json");
  if (
    receipt.schemaVersion !== 1 ||
    !entry ||
    !["packages/bun-aphrody-web/crates/site/data/docs.json", "packages/web/rust/crates/site/data/docs.json"].includes(
      entry.destination,
    ) ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !/^[a-f0-9]{40}$/.test(receipt.sourceCommit)
  )
    throw new Error("Canonical Bun documentation transfer receipt required");
  const docs = tracked("packages/web/rust/crates/site/data/docs.json");
  const search = tracked("packages/bun-google/src/search.ts");
  return {
    revision,
    transferSourceCommit: receipt.sourceCommit,
    transferSha256: receiptInput.sha256,
    transferDocs: { path: entry.destination, sha256: entry.sha256 },
    docs: { path: docs.path, sha256: docs.sha256, gitBlob: docs.gitBlob },
    search: {
      path: search.path,
      sha256: search.sha256,
      gitBlob: search.gitBlob,
    },
    docsFile: docs.file,
    searchFile: search.file,
  };
}
