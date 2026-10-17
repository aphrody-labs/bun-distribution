import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Glob } from "bun";

import { compareTestDiscovery } from "./lib/test-discovery.mjs";
import {
  BUILT_TEST_PROJECTS,
  SOURCE_TEST_PROJECTS,
} from "./lib/test-projects.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

const temporary = await mkdtemp(join(tmpdir(), "rea-test-discovery-"));
let discovered;
try {
  const output = join(temporary, "discovery.json");
  const discovery = [];
  for (const { name, include, exclude = [] } of [
    ...SOURCE_TEST_PROJECTS,
    ...BUILT_TEST_PROJECTS,
  ]) {
    const excluded = exclude.map((pattern) => new Glob(pattern));
    for (const pattern of include)
      for await (const file of new Glob(pattern).scan({ cwd: root }))
        if (!excluded.some((glob) => glob.match(file)))
          discovery.push({ file, projectName: name });
  }
  await Bun.write(output, JSON.stringify(discovery));
  const files = await execute(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src",
      "tests",
    ],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  const expected = [];
  for (const path of files.stdout
    .split("\0")
    .filter((path) => path.endsWith(".test.ts"))) {
    try {
      if ((await stat(join(root, path))).isFile()) expected.push(path);
    } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
    }
  }
  const report = compareTestDiscovery(
    expected,
    JSON.parse(await readFile(output, "utf8")),
    root,
  );
  if (
    report.missing.length ||
    report.unexpected.length ||
    report.duplicates.length
  ) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else discovered = report.discovered;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (discovered !== undefined)
  console.log(`Discovered all ${discovered} test files exactly once.`);
