// SPDX-License-Identifier: Apache-2.0
import { lstat, realpath, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function assertContained(base: string, path: string): void {
  const offset = relative(base, path);
  if (offset === ".." || offset.startsWith("../") || isAbsolute(offset)) {
    throw new Error("artifact path escapes its declared store");
  }
}

async function assertNoEscape(base: string, path: string): Promise<void> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error("artifact path cannot traverse a symlink");
    assertContained(base, await realpath(path));
    return;
  }
  const parent = dirname(path);
  if (parent === path) throw new Error("artifact store does not exist");
  return assertNoEscape(base, parent);
}

/** Factory stores stay outside sources; legacy callers keep relative outputs. */
export async function artifactStore(
  repo: string,
  env: Record<string, string | undefined> = process.env,
  revision?: string,
): Promise<string> {
  const requested = env.APHRODY_ARTIFACT_ROOT?.trim();
  if (env.APHRODY_BUILD_HOST !== "vps") {
    if (requested) throw new Error("external artifact stores require the declared VPS factory");
    return resolve(repo);
  }
  const config = await Bun.file(resolve(repo, "config/build-factory.json")).json();
  if (
    config.enabled !== true ||
    config.target !== "vps" ||
    !isAbsolute(config.artifactRoot ?? "")
  ) {
    throw new Error("missing declared factory artifact store");
  }
  const declared = resolve(config.artifactRoot);
  let store = requested ? resolve(requested) : declared;
  if (store === declared) {
    if (!revision || !/^[a-f0-9]{40}$/.test(revision))
      throw new Error("factory artifact namespace requires a full source revision");
    store = resolve(declared, `shenron-${revision}`);
  }
  if (requested && !isAbsolute(requested))
    throw new Error("factory artifact root must be absolute");
  assertContained(declared, store);
  // The configured root is provisioned by Infra before execution.
  if ((await realpath(declared)) !== declared)
    throw new Error("declared artifact root is not canonical");
  await assertNoEscape(declared, store);
  if (!relative(resolve(repo), store).startsWith("../")) {
    throw new Error("factory artifacts must stay outside the source checkout");
  }
  await mkdir(store, { recursive: true });
  return store;
}

export async function artifactPath(store: string, argument: string): Promise<string> {
  if (
    !argument ||
    isAbsolute(argument) ||
    argument.split("/").includes("..") ||
    /[\\\r\n]/.test(argument)
  ) {
    throw new Error("artifact output must be a contained relative path");
  }
  const path = resolve(store, argument);
  assertContained(store, path);
  await assertNoEscape(store, path);
  return path;
}
