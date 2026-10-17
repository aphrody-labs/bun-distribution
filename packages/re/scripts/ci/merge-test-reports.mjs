import { Glob } from "bun";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const [directory = ".bun-test-reports", xmlOutput = "test-results.xml"] =
  process.argv.slice(2);
const attribute = (tag, name) =>
  new RegExp(`\s${name}="([^"]*)"`, "u").exec(tag)?.[1];

const files = new Map();
const suites = [];
let tests = 0;
let failures = 0;
let skipped = 0;
let assertions = 0;
let documents = 0;
for (const path of new Glob("**/*.xml").scanSync({ cwd: directory })) {
  documents += 1;
  const text = await Bun.file(join(directory, path)).text();
  const root = /<testsuites\b[^>]*>/u.exec(text)?.[0] ?? "";
  tests += Number(attribute(root, "tests") ?? 0);
  failures += Number(attribute(root, "failures") ?? 0);
  skipped += Number(attribute(root, "skipped") ?? 0);
  assertions += Number(attribute(root, "assertions") ?? 0);
  // Top-level suites are the per-file suites; nested suites are indented deeper.
  for (const match of text.matchAll(
    /^ {2}<testsuite\b[^>]*>[\s\S]*?^ {2}<\/testsuite>|^ {2}<testsuite\b[^>]*\/>/gmu,
  )) {
    suites.push(match[0]);
    const tag = /<testsuite\b[^>]*>/u.exec(match[0])[0];
    const name = (attribute(tag, "file") ?? attribute(tag, "name") ?? "")
      .replaceAll("&amp;", "&")
      .replaceAll("\\", "/");
    const durationMs = Math.round(Number(attribute(tag, "time") ?? 0) * 1000);
    files.set(name, (files.get(name) ?? 0) + durationMs);
  }
}
if (documents === 0) throw new Error(`No JUnit reports found in ${directory}`);

await mkdir(dirname(xmlOutput), { recursive: true });
await Bun.write(
  xmlOutput,
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="${tests}" assertions="${assertions}" failures="${failures}" skipped="${skipped}">\n${suites.join("\n")}\n</testsuites>\n`,
);
await Bun.write(
  "test-timings.json",
  JSON.stringify({
    version: 1,
    success: failures === 0,
    reason: failures === 0 ? "passed" : "failed",
    unhandledErrors: 0,
    files: [...files].map(([name, durationMs]) => ({
      name,
      state: "passed",
      durationMs,
    })),
  }),
);
await Bun.write(
  "test-results.json",
  JSON.stringify({
    numTotalTests: tests,
    numFailedTests: failures,
    success: failures === 0,
  }),
);
console.log(
  `Merged ${documents} reports: ${tests} tests, ${failures} failures.`,
);
process.exitCode = failures === 0 ? 0 : 1;
