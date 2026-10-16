import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const json = (path: string) => JSON.parse(read(path));
const toml = (path: string) => Bun.TOML.parse(read(path)) as any;

/** Resolve actual workspace manifests, including overlapping declaration patterns. */
export function workspacePackageManifests(directory: string, patterns: string[]): string[] {
  const manifests = new Set<string>();
  for (const pattern of patterns) {
    for (const manifest of new Bun.Glob(`${pattern}/package.json`).scanSync({
      cwd: directory,
      onlyFiles: true,
    })) {
      manifests.add(manifest.replaceAll("\\", "/"));
    }
  }
  return [...manifests].sort();
}

/** Reusable source-backed Markdown inventory. No network, credentials or build outputs. */
export function renderReadmeInventory(): string {
  const result = Bun.spawnSync(["cargo", "metadata", "--no-deps", "--format-version", "1", "--locked"], { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  const cargo = JSON.parse(result.stdout.toString());
  const members = new Set(cargo.workspace_members);
  const packages = cargo.packages.filter((p: { id: string }) => members.has(p.id));
  const bun = json("package.json");
  const python = toml("pyproject.toml");
  const sdk = json("global.json").sdk;
  const cmake = read("CMakeLists.txt");
  const native = read("src/iecode-cpp/CMakeLists.txt");
  const capture = (text: string, pattern: RegExp) => {
    const value = text.match(pattern)?.[1];
    if (!value) throw new Error(`Missing source fact: ${pattern}`);
    return value;
  };
  const table = (header: string[], rows: string[][]) =>
    [header, header.map(() => "---"), ...rows]
      .map(row => `| ${row.map(cell => cell.replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`)
      .join("\n");
  const tools = table(
    ["Surface", "Manifest contract", "Owner"],
    [
      [
        "Rust",
        `${toml("rust-toolchain.toml").toolchain.channel}; ${packages.length} resolved workspace members`,
        "[Cargo.toml](Cargo.toml)",
      ],
      [
        "Bun / TypeScript",
        `${bun.packageManager}; TypeScript ${bun.workspaces.catalog.typescript}`,
        "[package.json](package.json)",
      ],
      [
        "Python / uv",
        `Python ${python.project["requires-python"]}; uv ${python.tool.uv["required-version"]}`,
        "[pyproject.toml](pyproject.toml)",
      ],
      [
        ".NET",
        `SDK ${sdk.version}, ${sdk.rollForward}; package version ${capture(read("Directory.Build.props"), /<Version>([^<]+)<\/Version>/)}`,
        "[IECODE.sln](IECODE.sln)",
      ],
      [
        "C++ / C",
        `C++${capture(native, /set\(CMAKE_CXX_STANDARD\s+(\d+)/)} / C${capture(native, /set\(CMAKE_C_STANDARD\s+(\d+)/)}; CMake >=${capture(cmake, /cmake_minimum_required\(VERSION\s+([\d.]+)/)}`,
        "[CMakePresets.json](CMakePresets.json)",
      ],
    ],
  );
  const npm = workspacePackageManifests(root, bun.workspaces.packages)
    .map((path: string) => json(path))
    .filter((p: { private?: boolean }) => !p.private)
    .map((p: { name: string; version: string }) => [
      `[${p.name}](https://www.npmjs.com/package/${p.name})`,
      p.version,
      "npm",
    ]);
  const py = python.tool.uv.workspace.members
    .map((path: string) => toml(`${path}/pyproject.toml`).project)
    .map((p: { name: string; version: string }) => [
      `[${p.name}](https://pypi.org/project/${p.name}/)`,
      p.version,
      "PyPI",
    ]);
  const rust = packages
    .filter((p: { publish: string[] | null }) => p.publish === null || p.publish.length > 0)
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
    .map((p: { name: string; version: string }) => [
      `[${p.name}](https://crates.io/crates/${p.name})`,
      p.version,
      "crates.io",
    ]);
  return `${tools}\n\nPublic package manifests (versions below are source declarations; publication evidence is in [PLAN.md](PLAN.md)):\n\n${table(["Package", "Version", "Registry"], [...npm, ...py, ...rust])}`;
}

export function checkReadmeInventory(write = false): void {
  const path = resolve(root, "README.md");
  const original = read("README.md");
  if (!original.includes(json("package.json").description))
    throw new Error("README description differs from package.json");
  const pattern = /<!-- source-inventory:start -->[\s\S]*?<!-- source-inventory:end -->/;
  if (!pattern.test(original)) throw new Error("README source inventory markers are missing");
  const updated = original.replace(
    pattern,
    `<!-- source-inventory:start -->\n${renderReadmeInventory()}\n<!-- source-inventory:end -->`,
  );
  if (write) writeFileSync(path, updated);
  else if (updated !== original)
    throw new Error("README manifest facts are stale. Run bun scripts/iecode/tools/readme.ts --write");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--write", "--description"].includes(arg)))
    throw new Error("Usage: bun scripts/iecode/tools/readme.ts [--write | --description]");
  if (args.includes("--description")) console.log(json("package.json").description);
  else {
    checkReadmeInventory(args.includes("--write"));
    console.log("README source inventory verified.");
  }
}
