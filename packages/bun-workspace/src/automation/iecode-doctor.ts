import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function resolveBunMembers(root: string, declarations: string[], failures: string[]): string[] {
  const members = new Set<string>();
  for (const declaration of declarations) {
    const matches = [
      ...new Bun.Glob(`${declaration}/package.json`).scanSync({
        cwd: root,
        onlyFiles: true,
      }),
    ];
    if (!matches.length) failures.push(`missing Bun workspace member: ${declaration}/package.json`);
    for (const match of matches) members.add(match.replaceAll("\\", "/").replace(/\/package\.json$/, ""));
  }
  return [...members].toSorted();
}

const describe = (paths: string[]) =>
  `${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` (+${paths.length - 3} more)` : ""}`;

export async function runIecodeDoctor(args: string[]): Promise<number> {
  let root = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops iecode-doctor [--root <iecode>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires an iecode repository path");
  root = resolve(root);
  const manifestPath = join(root, "workspace.manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    rust: { members: string[]; packagePrefix: string };
    bun: { members: string[] };
    python: { workspace: string; lockfile: string };
    dotnet: { solution: string; centralPackages: string; sdk: string };
    native: { presets: string; dependencies: string };
  };

  const failures: string[] = [];
  const file = (path: string) => {
    if (!existsSync(join(root, path))) failures.push(`missing file: ${path}`);
  };

  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "bun.lock",
    manifest.python.workspace,
    manifest.python.lockfile,
    manifest.dotnet.solution,
    manifest.dotnet.centralPackages,
    manifest.dotnet.sdk,
    manifest.native.presets,
    manifest.native.dependencies,
  ])
    file(path);
  for (const member of manifest.rust.members) file(join(member, "Cargo.toml"));
  const bunMembers = resolveBunMembers(root, manifest.bun.members, failures);

  const cargo = readFileSync(join(root, "Cargo.toml"), "utf8");
  if (cargo.includes("src/iecode/") || cargo.includes("src/niers/")) failures.push("stale nested Rust workspace root");
  for (const member of manifest.rust.members) {
    const text = readFileSync(join(root, member, "Cargo.toml"), "utf8");
    const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (!name?.startsWith(manifest.rust.packagePrefix)) failures.push(`Rust prefix violation: ${member}`);
  }

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    packageManager?: string;
    workspaces?: { packages?: string[] };
  };
  if (!packageJson.packageManager?.startsWith("bun@")) failures.push("package.json must pin Bun with packageManager");
  if (
    JSON.stringify(resolveBunMembers(root, packageJson.workspaces?.packages ?? [], failures)) !==
    JSON.stringify(bunMembers)
  ) {
    failures.push("package.json and workspace.manifest.json Bun members differ");
  }
  if (readdirSync(join(root, "src")).includes("iecode")) failures.push("stale redundant src/iecode directory");

  // Ownership rules apply to the source tree Git would publish: tracked files plus untracked files
  // that are not ignored. Disposable build output (bin/obj, __pycache__, node_modules) produced by
  // the other gates is ignored and therefore never trips the doctor, while a stray commit of it
  // does. Git is used instead of `find` so the checks behave identically on every host.
  const gitList = (gitArgs: string[]) => {
    const result = Bun.spawnSync(["git", ...gitArgs], {
      windowsHide: true,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      failures.push(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
      return [];
    }
    return result.stdout.toString().split("\0").filter(Boolean);
  };
  const sourceFiles = gitList(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src"]);
  const forbiddenSourceDirectories = ["bin", "obj", "node_modules", ".turbo", "__pycache__"];
  for (const directory of forbiddenSourceDirectories) {
    const offenders = sourceFiles.filter(path => path.split("/").slice(0, -1).includes(directory));
    if (offenders.length) {
      failures.push(`generated directory under src: ${directory}: ${describe(offenders)}`);
    }
  }

  const declaredSubmodules = new Set(
    existsSync(join(root, ".gitmodules"))
      ? [...readFileSync(join(root, ".gitmodules"), "utf8").matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map(m => m[1])
      : [],
  );
  const gitlinks = gitList(["ls-files", "-z", "--stage", "--", "src"])
    .filter(entry => entry.startsWith("160000 "))
    .map(entry => entry.slice(entry.indexOf("\t") + 1));
  const nestedRepositories = [
    ...gitlinks.filter(path => !declaredSubmodules.has(path)),
    ...sourceFiles.filter(path => path.endsWith("/")),
  ];
  if (nestedRepositories.length) {
    failures.push(`undeclared nested repository under src: ${describe(nestedRepositories)}`);
  }

  const nativeEmulatorRoots = ["src/iecode-cpp/emulation/melonds/"];
  const managedInNative = sourceFiles.filter(
    path => nativeEmulatorRoots.some(rootPath => path.startsWith(rootPath)) && path.endsWith(".cs"),
  );
  if (managedInNative.length) {
    failures.push(
      `managed C# source must live under src/IECODE, not a native emulator tree: ${describe(managedInNative)}`,
    );
  }

  const nativeInManaged = sourceFiles.filter(
    path => path.startsWith("src/IECODE/") && /\.(?:c|cc|cpp|cxx)$/i.test(path),
  );
  if (nativeInManaged.length) {
    failures.push(`native C/C++ source must live under src/iecode-cpp, not src/IECODE: ${describe(nativeInManaged)}`);
  }

  for (const needle of ["../rg", "../iecode/src", "src/iecode/nie-"]) {
    const result = Bun.spawnSync(["rg", "-n", "--fixed-strings", needle, "src", "Cargo.toml", "package.json"], {
      windowsHide: true,
      cwd: root,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode === 0) failures.push(`forbidden source reference: ${needle}`);
  }

  if (failures.length) {
    console.error(failures.map(failure => `FAIL ${failure}`).join("\n"));
    return 1;
  }
  console.log(
    `IECODE workspace OK: ${manifest.rust.members.length} Rust, ${bunMembers.length} Bun, ${relative(root, manifestPath)}`,
  );
  return 0;
}

if (import.meta.main) process.exit(await runIecodeDoctor(process.argv.slice(2)));
