/** Ensure package source can be installed without the host application. */
import { resolve } from "node:path";
import { uiAssetPaths } from "../src/assets";

const root = resolve(import.meta.dir, "..");
const forbidden = /^(?:next(?:\/|$)|@shenron\/|@\/|server-only$)/;
const failures: string[] = [];

for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan({
  cwd: resolve(root, "src"),
})) {
  const file = resolve(root, "src", path);
  const source = await Bun.file(file).text();
  const imports = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"']+)["']/g,
  );
  for (const match of imports) {
    if (forbidden.test(match[1])) failures.push(`${path}: ${match[1]}`);
  }
}

const manifest = await Bun.file(resolve(root, "package.json")).json();
for (const [key, target] of Object.entries(
  manifest.exports as Record<string, string>,
)) {
  if (key.includes("*") || target.includes("*")) continue;
  if (!(await Bun.file(resolve(root, target)).exists()))
    failures.push(`missing export ${key}: ${target}`);
}
for (const section of ["dependencies", "peerDependencies"] as const) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    if (forbidden.test(name)) failures.push(`package.json ${section}: ${name}`);
  }
}

const declaredAssets = new Set<string>(uiAssetPaths);
for (const asset of declaredAssets) {
  if (!(await Bun.file(resolve(root, "assets", asset)).exists()))
    failures.push(`missing asset: ${asset}`);
}
for await (const asset of new Bun.Glob("**/*.{svg,png,ico}").scan({
  cwd: resolve(root, "assets"),
})) {
  if (!declaredAssets.has(asset.replaceAll("\\", "/")))
    failures.push(`unlisted asset: ${asset}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Portable UI: no Next.js or Shenron runtime imports; exports and ${declaredAssets.size} assets resolve`,
  );
}
