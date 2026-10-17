import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  BUILT_TEST_PROJECTS,
  SOURCE_TEST_PROJECTS,
} from "./lib/test-projects.mjs";

// Select discovered test files by identity instead of Bun's substring filters,
// retaining each project's include/exclude ownership.
const requested = process.argv
  .slice(2)
  .filter((argument) => argument !== "run");
const flags = requested.filter((argument) => argument.startsWith("-"));
const paths = requested.filter((argument) => !argument.startsWith("-"));

const discovered = new Map();
for (const { include, exclude = [] } of [
  ...SOURCE_TEST_PROJECTS,
  ...BUILT_TEST_PROJECTS,
]) {
  const excluded = exclude.map((pattern) => new Bun.Glob(pattern));
  for (const pattern of include)
    for await (const file of new Bun.Glob(pattern).scan({ cwd: "." }))
      if (!excluded.some((glob) => glob.match(file)))
        discovered.set(resolve(file), file.replaceAll("\\", "/"));
}
const canonical = new Map();
for (const [absolute, relative] of discovered)
  canonical.set(await realpath(absolute).catch(() => absolute), relative);

const selected = new Set();
const missing = [];
for (const path of paths) {
  const absolute = resolve(path);
  const direct = discovered.get(absolute);
  if (direct !== undefined) {
    selected.add(direct);
    continue;
  }
  try {
    await lstat(absolute);
  } catch {
    missing.push(path);
    continue;
  }
  // A case-insensitive or symlinked spelling is accepted only when it resolves
  // to a discovered file through a path with identical components.
  const real = await realpath(absolute);
  const match = canonical.get(real);
  if (
    match !== undefined &&
    resolve(match).toLowerCase() === absolute.toLowerCase()
  )
    selected.add(match);
  else missing.push(path);
}
if (missing.length > 0 || selected.size === 0) {
  console.error(
    `Selected test files were not discovered: ${missing.join(", ")}`,
  );
  process.exit(1);
}

const child = Bun.spawn(
  [
    process.execPath,
    "test",
    "--isolate",
    ...flags,
    ...[...selected].map((file) => `./${file}`),
  ],
  { stdio: ["inherit", "inherit", "inherit"] },
);
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
let shutdownSignal;
for (const signal of Object.keys(signalExitCodes))
  process.on(signal, () => {
    shutdownSignal ??= signal;
    child.kill(signal);
  });
const code = await child.exited;
process.exitCode =
  shutdownSignal === undefined ? code : signalExitCodes[shutdownSignal];
