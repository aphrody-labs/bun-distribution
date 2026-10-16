#!/usr/bin/env bun
import {
  createVideoLibrary,
  stringifyNativeJSON,
  VideoLibraryError,
  videoLibraryDoctor,
  type VideoLibraryOptions,
} from "./index.ts";

const help = `Aphrody / Bun Video

  aphrody-video doctor
  aphrody-video commands [filter]
  aphrody-video describe <id>
  aphrody-video inspect <project> [project|sequence]
  aphrody-video probe <media>
  aphrody-video render <project> <output.png> --seconds N [--scale N]
  aphrody-video export <project> <output> [--format F] [--start N] [--end N] [--allow-offline]

Options: --binary PATH, --data-dir PATH, --timeout-ms N, --max-output-bytes N.
Output is exact JSON. Native artifacts are built through the workspace owner.`;

const valued = new Set([
  "--binary",
  "--data-dir",
  "--timeout-ms",
  "--max-output-bytes",
  "--seconds",
  "--scale",
  "--format",
  "--start",
  "--end",
]);
const flags = new Set(["--json", "--allow-offline"]);
const globalOptions = [
  "--binary",
  "--data-dir",
  "--timeout-ms",
  "--max-output-bytes",
  "--json",
];

interface Arguments {
  positional: string[];
  values: Map<string, string | true>;
}

function usage(): never {
  throw new VideoLibraryError(
    "INVALID_OPTIONS",
    "Invalid video arguments. Run aphrody-video help.",
  );
}

function parse(args: string[]): Arguments {
  const positional: string[] = [];
  const values = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const entry = args[index]!;
    if (entry === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!entry.startsWith("--")) {
      positional.push(entry);
      continue;
    }
    const equal = entry.indexOf("=");
    const name = equal < 0 ? entry : entry.slice(0, equal);
    if (values.has(name)) usage();
    if (flags.has(name)) {
      if (equal >= 0) usage();
      values.set(name, true);
    } else if (valued.has(name)) {
      const value = equal < 0 ? args[++index] : entry.slice(equal + 1);
      if (value === undefined || !value || value.includes("\0")) usage();
      values.set(name, value);
    } else {
      usage();
    }
  }
  return { positional, values };
}

function stringOption(args: Arguments, key: string): string | undefined {
  const value = args.values.get(key);
  return typeof value === "string" ? value : undefined;
}

function integerOption(args: Arguments, key: string): number | undefined {
  const value = stringOption(args, key);
  if (value === undefined) return;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) usage();
  return Number(value);
}

function allowed(
  args: Arguments,
  extra: string[],
  minimum: number,
  maximum = minimum,
): void {
  const options = new Set([...globalOptions, ...extra]);
  if (
    args.positional.length < minimum ||
    args.positional.length > maximum ||
    [...args.values.keys()].some((key) => !options.has(key))
  )
    usage();
}

async function main(): Promise<number> {
  const [action = "help", ...rest] = Bun.argv.slice(2);
  if (["help", "--help", "-h"].includes(action)) {
    if (rest.length) usage();
    console.log(help);
    return 0;
  }
  const args = parse(rest);
  const options: VideoLibraryOptions = {
    binary: stringOption(args, "--binary"),
    dataDir: stringOption(args, "--data-dir"),
    timeoutMs: integerOption(args, "--timeout-ms"),
    maxOutputBytes: integerOption(args, "--max-output-bytes"),
  };
  if (action === "doctor") {
    allowed(args, [], 0);
    const report = await videoLibraryDoctor(options);
    console.log(stringifyNativeJSON(report, 2));
    return report.engine.available &&
      report.runtime.recognizedFork &&
      report.runtime.versionMatches &&
      report.runtime.revisionMatches &&
      report.source.initialized &&
      report.source.pointerMatches &&
      report.source.revisionMatches
      ? 0
      : 1;
  }
  switch (action) {
    case "commands":
      allowed(args, [], 0, 1);
      break;
    case "describe":
      allowed(args, [], 1);
      break;
    case "inspect":
      allowed(args, [], 1, 2);
      break;
    case "probe":
      allowed(args, [], 1);
      break;
    case "render":
      allowed(args, ["--seconds", "--scale"], 2);
      break;
    case "export":
      allowed(args, ["--format", "--start", "--end", "--allow-offline"], 2);
      break;
    default:
      usage();
  }
  const library = await createVideoLibrary(options);
  let result: unknown;
  switch (action) {
    case "commands":
      result = await library.commands(args.positional[0]);
      break;
    case "describe":
      result = await library.describe(args.positional[0]!);
      break;
    case "inspect": {
      const kind = args.positional[1] ?? "sequence";
      if (kind === "project")
        result = await library.inspect(args.positional[0]!, "project");
      else if (kind === "sequence")
        result = await library.inspect(args.positional[0]!, "sequence");
      else usage();
      break;
    }
    case "probe":
      result = await library.probe(args.positional[0]!);
      break;
    case "render": {
      const seconds = stringOption(args, "--seconds");
      if (seconds === undefined) usage();
      const scale = stringOption(args, "--scale");
      result = await library.render(args.positional[0]!, {
        output: args.positional[1]!,
        seconds,
        scale: scale === undefined ? undefined : Number(scale),
      });
      break;
    }
    case "export":
      result = await library.export(args.positional[0]!, {
        output: args.positional[1]!,
        format: stringOption(args, "--format"),
        start: stringOption(args, "--start"),
        end: stringOption(args, "--end"),
        allowOffline: args.values.has("--allow-offline"),
      });
      break;
  }
  console.log(stringifyNativeJSON(result, 2));
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof VideoLibraryError) {
    if (error.result !== undefined)
      console.log(stringifyNativeJSON(error.result, 2));
    console.error(`Aphrody / Bun: ${error.message} (${error.code})`);
    process.exitCode = error.code === "INVALID_OPTIONS" ? 2 : 1;
  } else {
    console.error("Aphrody / Bun: The video operation failed.");
    process.exitCode = 1;
  }
}
