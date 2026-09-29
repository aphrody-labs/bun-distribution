import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function output(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`command failed: ${command.join(" ")}`);
  return new TextDecoder().decode(result.stdout).trim();
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`command failed: ${command.join(" ")}`);
}

export async function runKoharuRelease(args: string[]): Promise<number> {
  let root = process.cwd();
  let version: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--version") version = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aphrody-ops koharu-release [--root <repository>] [--version <semver>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a value");
  root = resolve(root);
  version ??= output(["bun", "git-cliff", "--offline", "--unreleased", "--bumped-version"], root);
  if (!version) throw new Error("git-cliff did not return a bumped version");
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version))
    throw new Error(`invalid release version: ${version}`);

  const cargoTomlPath = join(root, "Cargo.toml");
  const cargoToml = await readFile(cargoTomlPath, "utf8");
  const pattern = /(\[workspace\.package\][\s\S]*?version\s*=\s*")([^"]+)(")/u;
  if (!pattern.test(cargoToml))
    throw new Error("Could not find [workspace.package] version in Cargo.toml");
  await writeFile(cargoTomlPath, cargoToml.replace(pattern, `$1${version}$3`));

  run(["cargo", "metadata", "--format-version", "1"], root);
  run(["git", "add", "Cargo.toml", "Cargo.lock"], root);
  run(["git", "commit", "-m", `chore(release): ${version}`], root);
  run(["git", "tag", version], root);
  run(["bun", "git-cliff", "--offline", "-o", "CHANGELOG.md"], root);
  run(["git", "add", "CHANGELOG.md"], root);
  run(["git", "commit", "--amend", "--no-edit"], root);
  run(["git", "tag", "-f", version], root);
  console.log(`Release commit and tag ${version} created.`);
  return 0;
}
