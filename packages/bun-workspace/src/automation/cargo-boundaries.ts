import { resolve } from "node:path";

type CargoPackage = {
  name: string;
  version: string;
  source: string | null;
  manifest_path: string;
};
type CargoMetadata = { workspace_root: string; packages: CargoPackage[] };

function inside(root: string, path: string): boolean {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedPath = path.replaceAll("\\", "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

export async function runCargoBoundaries(args: string[]): Promise<number> {
  let root = process.cwd();
  let metadataPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--metadata") metadataPath = args[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops cargo-boundaries [--root <workspace>] [--metadata <cargo-metadata.json>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a workspace path");
  root = resolve(root);
  const raw = metadataPath
    ? await Bun.file(resolve(root, metadataPath)).text()
    : (() => {
        const result = Bun.spawnSync(
          [
            "cargo",
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--all-features",
            "--manifest-path",
            `${root}/Cargo.toml`,
          ],
          { windowsHide: true, stdout: "pipe", stderr: "pipe" },
        );
        if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || "cargo metadata failed");
        return result.stdout.toString();
      })();
  const metadata = JSON.parse(raw) as CargoMetadata;
  const local = metadata.packages.filter(pkg => pkg.source === null);
  const outside = local.filter(pkg => !inside(metadata.workspace_root, pkg.manifest_path));
  if (outside.length) {
    console.error(`error: path dependencies outside ${metadata.workspace_root}:`);
    for (const pkg of outside) console.error(`  ${pkg.name} ${pkg.version} ${pkg.manifest_path}`);
    return 1;
  }
  console.log(`workspace boundaries ok: ${local.length} path packages, all inside ${metadata.workspace_root}`);
  return 0;
}

if (import.meta.main) process.exit(await runCargoBoundaries(process.argv.slice(2)));
