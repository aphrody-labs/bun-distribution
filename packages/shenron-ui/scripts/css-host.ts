import { existsSync, statSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";

export interface CssHost {
  directory: string;
  stylesheet: string;
  repository: string;
  gitPath: string;
  packageGitPath: string;
}

/** Host parity is explicit and separate from portable package qualification. */
export function resolveCssHost(argument: string, environmentName: string, segments: string[]): CssHost {
  const argv = Bun.argv.slice(2);
  const index = argv.indexOf(argument);
  const configured = index >= 0 ? argv[index + 1] : Bun.env[environmentName];
  if (!configured?.trim() || configured.startsWith("--")) {
    throw new Error(`External host qualification requires ${argument} <existing host directory> or ${environmentName}`);
  }
  const directory = resolve(configured);
  const stylesheet = join(directory, ...segments);
  if (!existsSync(stylesheet) || !statSync(stylesheet).isFile())
    throw new Error(`Host stylesheet missing: ${stylesheet}`);
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10000,
    windowsHide: true,
  });
  if (result.exitCode !== 0) throw new Error("The explicit host must belong to an initialized Git owner");
  const repository = result.stdout.toString().trim();
  const gitPath = relative(repository, stylesheet).replaceAll("\\", "/");
  if (isAbsolute(gitPath) || gitPath.startsWith("../")) throw new Error("Host stylesheet escapes its Git owner");
  const packageIndex = argv.indexOf("--package-git-path");
  const packageGitPath = packageIndex >= 0 ? argv[packageIndex + 1] : "packages/shenron-ui/src/styles.css";
  if (
    !packageGitPath ||
    !packageGitPath.endsWith(".css") ||
    packageGitPath.startsWith("--") ||
    packageGitPath.includes("\\") ||
    isAbsolute(packageGitPath) ||
    packageGitPath.split("/").includes("..")
  ) {
    throw new Error("--package-git-path must name a relative stylesheet in the explicit host Git history");
  }
  return { directory, stylesheet, repository, gitPath, packageGitPath };
}
