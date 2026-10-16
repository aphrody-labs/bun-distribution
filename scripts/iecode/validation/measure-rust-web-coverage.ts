/** Measure which Rust workspace packages feed the model-server and WebAssembly roots. */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type CargoTarget = { kind: string[] };
type CargoPackage = {
  id: string;
  name: string;
  manifest_path: string;
  targets: CargoTarget[];
  version: string;
};
type CargoMetadata = {
  packages: CargoPackage[];
  workspace_members: string[];
};

const repositoryRootPath = fileURLToPath(new URL("../../../", import.meta.url));

async function cargoOutput(args: string[]): Promise<string> {
  const process = Bun.spawn(["cargo", ...args], {
    cwd: repositoryRootPath,
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(process.stdout).text();
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`cargo ${args[0]} exited with code ${exitCode}`);
  return output;
}

const metadata = JSON.parse(
  await cargoOutput(["metadata", "--format-version", "1", "--no-deps"]),
) as CargoMetadata;

const workspaceIds = new Set(metadata.workspace_members);
const packagesById = new Map(metadata.packages.map((entry) => [entry.id, entry]));

async function targetPackages(
  rootName: string,
  target?: string,
  noDefaultFeatures = false,
): Promise<Set<string>> {
  const args = ["tree", "-p", rootName, "-e", "normal", "--prefix", "none", "--format", "{p}"];
  if (target !== undefined) args.push("--target", target);
  if (noDefaultFeatures) args.push("--no-default-features");
  const lines = (await cargoOutput(args)).replaceAll("\\", "/").split(/\r?\n/);
  return new Set(
    metadata.packages
      .filter((entry) => workspaceIds.has(entry.id))
      .filter((entry) => {
        const packageDirectory = dirname(entry.manifest_path).replaceAll("\\", "/");
        const prefix = `${entry.name} v${entry.version} (${packageDirectory})`;
        return lines.some((line) => line === prefix || line.startsWith(`${prefix} (`));
      })
      .map((entry) => entry.id),
  );
}

const [modelServePackages, wasmPackages] = await Promise.all([
  targetPackages("aphrody-nie-model-serve"),
  targetPackages("aphrody-nie-wasm", "wasm32-unknown-unknown", true),
]);
const repositoryRoot = repositoryRootPath.replaceAll("\\", "/").replace(/\/$/, "");

const packages = metadata.workspace_members
  .map((id) => {
    const entry = packagesById.get(id);
    if (entry === undefined) throw new Error(`workspace package ${id} is absent from metadata`);
    const targetKinds = [...new Set(entry.targets.flatMap((target) => target.kind))].toSorted();
    const linkable = targetKinds.some((kind) => kind === "lib" || kind === "rlib");
    return {
      name: entry.name,
      manifestPath: entry.manifest_path.replaceAll("\\", "/").replace(`${repositoryRoot}/`, ""),
      targetKinds,
      linkable,
      modelServe: modelServePackages.has(id),
      wasm: wasmPackages.has(id),
    };
  })
  .toSorted((left, right) => left.name.localeCompare(right.name));

const report = {
  measuredAt: new Date().toISOString(),
  workspacePackageCount: packages.length,
  modelServeReachableCount: packages.filter((entry) => entry.modelServe).length,
  wasmReachableCount: packages.filter((entry) => entry.wasm).length,
  eitherReachableCount: packages.filter((entry) => entry.modelServe || entry.wasm).length,
  unconnectedLinkableCount: packages.filter(
    (entry) => entry.linkable && !entry.modelServe && !entry.wasm,
  ).length,
  bindingOnlyCount: packages.filter((entry) => !entry.linkable).length,
  packages,
};

if (Bun.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `Rust web coverage: model server ${report.modelServeReachableCount}/${report.workspacePackageCount}, ` +
      `wasm ${report.wasmReachableCount}/${report.workspacePackageCount}, ` +
      `either ${report.eitherReachableCount}/${report.workspacePackageCount}`,
  );
  console.log(
    `Remaining: ${report.unconnectedLinkableCount} linkable packages, ` +
      `${report.bindingOnlyCount} binding-only packages requiring extraction or an adapter`,
  );
  for (const entry of packages.filter((candidate) => !candidate.modelServe && !candidate.wasm)) {
    console.log(`${entry.linkable ? "library" : "binding"}\t${entry.name}\t${entry.manifestPath}`);
  }
}
