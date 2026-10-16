#!/usr/bin/env bun
/** Collect private runtime evidence; never infer parser capabilities from source. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    out: { type: "string" },
    "game-dir": { type: "string" },
    source: { type: "string" },
    nie: { type: "string", default: "nie" },
    iecode: { type: "string", default: "iecode" },
    inagle: { type: "string", default: "inagle" },
    library: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: bun run analyze:cli --out /private/new-directory --game-dir /local/input/root [--source https://host/game-or-data] --library /path/to/libiecode.so [--nie /path/to/nie] [--iecode /path/to/iecode] [--inagle /path/to/inagle]",
  );
  console.log(
    "Uses the installed VFS directly. No game dump or database is required. Outputs and observed shapes remain private. Exit 1 means a probe or VFS count comparison failed.",
  );
  process.exit(0);
}
if (!values.out || !values["game-dir"])
  throw new Error("--out and --game-dir are required; see --help");

const root = realpathSync(resolve(import.meta.dir, "../../.."));
const out = resolve(values.out);
const game = realpathSync(values["game-dir"]);
const source = values.source ?? game;

function outsideRepository(path: string): boolean {
  const rel = relative(root, path);
  return rel.startsWith(`..${sep}`) || isAbsolute(rel);
}
// Resolve existing ancestors too, so a symlink cannot put private output in Git.
let ancestor = out;
while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..");
if (!outsideRepository(out) || !outsideRepository(realpathSync(ancestor)))
  throw new Error("Evidence output must be outside the repository");
for (const input of [game]) {
  const rel = relative(input, resolve(realpathSync(ancestor), relative(ancestor, out)));
  if (rel === "" || (!rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
    throw new Error("Evidence output must be outside the installation directory");
}
mkdirSync(out, { mode: 0o700, recursive: true });
chmodSync(out, 0o700);
if (readdirSync(out).length)
  throw new Error("Choose an empty output directory; existing files are not overwritten");
const save = (name: string, text: string) => writeFileSync(join(out, name), text, { mode: 0o600 });
const dataRoot = existsSync(join(game, "cpk_list.cfg.bin"))
  ? game
  : existsSync(join(game, "data/cpk_list.cfg.bin"))
    ? join(game, "data")
    : game;
function inputSnapshot() {
  const entries: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else entries.push(`${relative(dataRoot, path)}:${stat.size}:${stat.mtimeMs}:${stat.mode}`);
    }
  };
  walk(dataRoot);
  return {
    files: entries.length,
    metadataHash: Bun.CryptoHasher.hash("sha256", entries.join("\n"), "hex"),
  };
}
const inputsBefore = inputSnapshot();

function jsonOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const candidates: unknown[] = [];
    for (const line of text.split("\n")) {
      if (!/^(?:\{|\[)/.test(line.trim())) continue;
      try {
        candidates.push(JSON.parse(line));
      } catch {
        /* Log lines are retained. */
      }
    }
    if (candidates.length !== 1) throw new Error("No unambiguous JSON output");
    return candidates[0];
  }
}

type Shape = {
  type: string;
  properties?: Record<string, Shape>;
  items?: { anyOf: Shape[] };
  additionalProperties?: boolean;
};
function observedShape(value: unknown, depth = 0): Shape {
  if (depth > 12) return { type: "unknown" };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const shapes = value.slice(0, 32).map((item) => observedShape(item, depth + 1));
    return {
      type: "array",
      items: {
        anyOf: [...new Map(shapes.map((shape) => [JSON.stringify(shape), shape])).values()],
      },
    };
  }
  if (typeof value === "object")
    return {
      type: "object",
      additionalProperties: true,
      properties: Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, observedShape(item, depth + 1)]),
      ),
    };
  return { type: typeof value };
}
const tools = [
  { name: "nie", candidate: values.nie!, required: true },
  { name: "iecode", candidate: values.iecode!, required: true },
  { name: "inagle", candidate: values.inagle!, required: true },
  ...["iecode-cpp", "ievr-tools", "iecode-homebrew"].map((name) => ({
    name,
    candidate: name,
    required: false,
  })),
].map((tool) => ({ ...tool, executable: Bun.which(tool.candidate) }));
type Receipt = {
  id: string;
  tool: string;
  arguments: string[];
  exitCode: number | null;
  timedOut: boolean;
  seconds: number;
  jsonShape: string | null;
  domainCounts: Record<string, number> | null;
  discoveryMs: number | null;
  diagnostic: string | null;
};
const commands: Receipt[] = [];
const machineOutput = new Map<string, unknown>();
async function probe(toolName: string, id: string, args: string[], jsonFile?: string) {
  const tool = tools.find((tool) => tool.name === toolName)!;
  if (!tool.executable) return;
  const start = performance.now();
  let timedOut = false;
  const proc = Bun.spawn([tool.executable, ...args], {
    cwd: out,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NIE_GAME_SOURCE: undefined,
      NIE_GAME_DIR: undefined,
      IECODE_GAME_PATH: undefined,
      NIE_GAME_PATH: undefined,
      ...(values.library
        ? { IECODE_LIB_PATH: resolve(values.library), NIE_FFI_PATH: resolve(values.library) }
        : {}),
      RAYON_NUM_THREADS: "4",
      NIE_CPK_CACHE_BUDGET_GIB: "4",
      NIE_CONFIG_DIR: join(out, "source-index"),
    },
  });
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, 45_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  let parsed: unknown;
  let jsonShape: string | null = null;
  let outputDiagnostic: string | null = null;
  let domainCounts: Record<string, number> | null = null;
  let discoveryMs: number | null = null;
  if (exitCode === 0 && !timedOut) {
    try {
      parsed = jsonOutput(jsonFile ? await Bun.file(jsonFile).text() : stdout);
      machineOutput.set(id, parsed);
      if (id.endsWith("-locate") && parsed && typeof parsed === "object") {
        const result = parsed as { discovery_ms?: number; source?: string };
        discoveryMs = result.discovery_ms ?? null;
        if (discoveryMs === null || !result.source)
          outputDiagnostic = "missing-native-discovery-result";
      }
      if (id === "inagle-stats" && parsed && typeof parsed === "object") {
        const stats = parsed as Record<string, unknown>;
        domainCounts = Object.fromEntries(
          ["characters", "skills", "items", "teams"].flatMap((key) =>
            typeof stats[key] === "number" ? [[key, stats[key] as number]] : [],
          ),
        );
        if (stats.source !== "vfs" || Object.keys(domainCounts).length !== 4)
          outputDiagnostic = "game-data-not-from-vfs";
      }
      jsonShape = `${id}.observed-shape.json`;
      save(
        jsonShape,
        JSON.stringify(
          {
            kind: "observed-output-shape/v1",
            command: id,
            limits:
              "One output; arrays sampled at 32 elements; not a normative JSON Schema or binary format layout.",
            shape: observedShape(parsed),
          },
          null,
          2,
        ) + "\n",
      );
    } catch {
      if (args.includes("--json")) outputDiagnostic = "invalid-json-output";
    }
  }
  save(
    `${id}.stdout.json`,
    JSON.stringify(
      parsed === undefined
        ? { output: "redacted", utf8_bytes: Buffer.byteLength(stdout) }
        : { output: "redacted-structured-data", shape: observedShape(parsed) },
    ) + "\n",
  );
  save(
    `${id}.stderr.json`,
    JSON.stringify({
      diagnostic: /PostgreSQL projections are unavailable|ECONNREFUSED/.test(stderr)
        ? "database-unavailable"
        : /Game not found/.test(stderr)
          ? "installation-not-recognized"
          : null,
    }) + "\n",
  );
  const diagnostic = /PostgreSQL projections are unavailable|ECONNREFUSED/.test(stderr)
    ? "database-unavailable"
    : /Game not found/.test(stderr)
      ? "installation-not-recognized"
      : outputDiagnostic;
  commands.push({
    id,
    tool: toolName,
    arguments: args.map((argument, index) =>
      ["--game", "--game-dir"].includes(args[index - 1] ?? "") ? "<game-root>" : argument,
    ),
    exitCode,
    timedOut,
    seconds: +((performance.now() - start) / 1000).toFixed(3),
    jsonShape,
    domainCounts,
    discoveryMs,
    diagnostic,
  });
  console.log(
    `${id}: exit=${exitCode}${timedOut ? " timeout" : ""}${diagnostic ? ` ${diagnostic}` : ""}`,
  );
}
for (const tool of tools) {
  await probe(tool.name, `${tool.name}-help`, ["--help"]);
  if (tool.name !== "iecode-homebrew")
    await probe(tool.name, `${tool.name}-version`, ["--version"]);
}
await probe("nie", "nie-info", ["info", "--game-dir", source, "--json"]);
await probe("nie", "nie-locate", ["vfs", "locate", "--json"]);
await probe("iecode", "iecode-locate", ["vfs", "locate", "--json"]);
await probe("inagle", "inagle-locate", ["locate", "--json"]);
await probe("nie", "nie-vfs-stats", ["vfs", "stats", "--game-dir", source]);
await probe("nie", "nie-config-path", [
  "vfs",
  "find",
  "cfg.bin",
  "--game-dir",
  source,
  "--limit",
  "1",
  "--json",
]);
await probe("nie", "nie-characters", [
  "vfs",
  "chara",
  "--game-dir",
  source,
  "--json",
  "--limit",
  "3",
  "--no-paths",
]);
await probe("nie", "nie-skills", [
  "vfs",
  "waza",
  "--game-dir",
  source,
  "--json",
  "--limit",
  "3",
  "--no-paths",
]);
await probe("iecode", "iecode-info", ["info", "--game", source, "--json"]);
await probe("iecode", "iecode-vfs-stats", ["vfs", "stats", "--game", source, "--json"]);
await probe("iecode", "iecode-vfs-find", [
  "vfs",
  "find",
  "cfg.bin",
  "--game",
  source,
  "--limit",
  "3",
  "--json",
]);
let configPath: string | undefined;
if (commands.find((command) => command.id === "nie-config-path")?.jsonShape) {
  configPath = (machineOutput.get("nie-config-path") as { path: string }[])[0]?.path;
}
if (configPath)
  await probe("iecode", "iecode-vfs-decode", [
    "vfs",
    "decode",
    configPath,
    "--game",
    source,
    "--json",
  ]);
await probe("inagle", "inagle-stats", ["--game-dir", source, "stats", "--json"]);
await probe("inagle", "inagle-search", ["--game-dir", source, "search", "a", "--limit", "3"]);
await probe("inagle", "inagle-team-encode", ["team-builder", "encode", "1", "0:100", "1:200"]);
await probe("inagle", "inagle-team-decode", ["team-builder", "decode", "MXwwOjEwMHwxOjIwMA=="]);
const failed = commands.filter(
  (command) => command.exitCode !== 0 || command.timedOut || command.diagnostic !== null,
);
const comparisons: { vfsEntryCountsMatch?: boolean; discoveredSourcesMatch?: boolean } = {};
const discovered = ["nie-locate", "iecode-locate", "inagle-locate"].map(
  (id) => (machineOutput.get(id) as { source?: string } | undefined)?.source,
);
comparisons.discoveredSourcesMatch =
  discovered.every((value) => !!value) && new Set(discovered).size === 1;
if (
  commands.filter(
    (command) => ["nie-info", "iecode-vfs-stats"].includes(command.id) && command.jsonShape,
  ).length === 2
) {
  const rust = machineOutput.get("nie-info") as {
    vfs: { entrees: number };
  };
  const managed = machineOutput.get("iecode-vfs-stats") as {
    entry_count: number;
  };
  comparisons.vfsEntryCountsMatch =
    rust.vfs.entrees === managed.entry_count && managed.entry_count > 0;
}
const inputsAfter = inputSnapshot();
const inputsUnchanged = JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter);
save(
  "receipt.json",
  JSON.stringify(
    {
      schema: "iecode.cli-evidence/v1",
      capturedAt: new Date().toISOString(),
      tools,
      commands,
      comparisons,
      source: values.source ? "remote-vfs" : "installed-vfs",
      inputFiles: inputsBefore.files,
      inputMetadataUnchanged: inputsUnchanged,
      limitations: [
        "Help/catalogue availability is not parser success",
        "Bounded domain probes do not measure full-VFS decoder coverage",
        "Observed shapes are not normative schemas",
        "No database migrations, downloads, servers or release operations are run",
      ],
    },
    null,
    2,
  ) + "\n",
);
save(
  "summary.md",
  "| Probe | Exit | Observed shape | Diagnostic |\n| --- | ---: | --- | --- |\n" +
    commands
      .map(
        (command) =>
          `| ${command.id} | ${command.exitCode} | ${command.jsonShape ? "yes" : "none"} | ${command.diagnostic ?? (command.timedOut ? "timeout" : "—")} |`,
      )
      .join("\n") +
    "\n",
);
console.log(
  `${commands.length} probes, ${failed.length} failed/blocked, comparisons=${JSON.stringify(comparisons)}, source=${values.source ? "remote-vfs" : "installed-vfs"}, inputs unchanged=${inputsUnchanged}. Private receipt: ${join(out, "receipt.json")}`,
);
process.exitCode =
  failed.length ||
  !inputsUnchanged ||
  Object.values(comparisons).includes(false) ||
  tools.some((tool) => tool.required && !tool.executable)
    ? 1
    : 0;
