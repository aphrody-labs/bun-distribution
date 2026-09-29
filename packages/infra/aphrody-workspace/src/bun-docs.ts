// SPDX-License-Identifier: Apache-2.0
/** Refresh the checked-in official Bun documentation used by the audit launcher. */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const BUN_REFERENCE_FILES = [
  { path: "llms.txt", url: "https://bun.com/llms.txt" },
  { path: "pm/workspaces.md", url: "https://bun.com/docs/pm/workspaces.md" },
  { path: "pm/catalogs.md", url: "https://bun.com/docs/pm/catalogs.md" },
  { path: "pm/install.md", url: "https://bun.com/docs/pm/cli/install.md" },
  { path: "pm/isolated-installs.md", url: "https://bun.com/docs/pm/isolated-installs.md" },
  { path: "pm/filter.md", url: "https://bun.com/docs/pm/filter.md" },
  { path: "pm/lockfile.md", url: "https://bun.com/docs/pm/lockfile.md" },
  { path: "bundler/executables.md", url: "https://bun.com/docs/bundler/executables.md" },
  { path: "runtime/child-process.md", url: "https://bun.com/docs/runtime/child-process.md" },
  { path: "runtime/bun-apis.md", url: "https://bun.com/docs/runtime/bun-apis.md" },
  { path: "runtime/toml.md", url: "https://bun.com/docs/runtime/toml.md" },
] as const;

interface ReferenceEntry {
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export async function fetchBunReference(
  outputRoot: string,
  checkOnly = false,
): Promise<ReferenceEntry[]> {
  const references = await Promise.all(
    BUN_REFERENCE_FILES.map(async ({ path, url }): Promise<ReferenceEntry> => {
      const response = await fetch(url, {
        headers: { "user-agent": "aphrody-workspace-bun-reference-fetcher" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
      const content = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      if (!content.trim() || contentType.includes("text/html"))
        throw new Error(`${url}: expected Markdown/text, received an empty or HTML response`);

      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(content);
      const entry = { path, url, bytes: Buffer.byteLength(content), sha256: hasher.digest("hex") };
      const destination = resolve(outputRoot, path);
      if (checkOnly) {
        const existing = await Bun.file(destination)
          .text()
          .catch(() => "");
        if (existing !== content) throw new Error(`${path}: differs from the official source`);
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await Bun.write(destination, content);
      }
      return entry;
    }),
  );

  const manifestPath = resolve(outputRoot, "manifest.json");
  const manifest = {
    source: "https://bun.com/llms.txt",
    bunVersion: Bun.version,
    fetchedAt: new Date().toISOString(),
    files: references,
  };
  if (checkOnly) {
    const current = await Bun.file(manifestPath)
      .json()
      .catch(() => null);
    if (!current || JSON.stringify(current.files) !== JSON.stringify(references))
      throw new Error("manifest.json does not match the fetched documentation checksums");
  } else {
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return references;
}

export async function runBunDocs(args: string[]): Promise<number> {
  const checkOnly = args.includes("--check");
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const outputRoot = resolve(import.meta.dir, "../docs/bun");
  if (!checkOnly) await mkdir(outputRoot, { recursive: true });
  try {
    const references = await fetchBunReference(outputRoot, checkOnly);
    console.log(
      `${checkOnly ? "Verified" : "Fetched"} ${references.length} official Bun documents (${references.reduce((total, item) => total + item.bytes, 0)} bytes)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(await runBunDocs(process.argv.slice(2)));
