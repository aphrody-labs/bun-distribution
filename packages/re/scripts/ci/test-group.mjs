import {
  BUILT_TEST_PROJECTS,
  SOURCE_TEST_PROJECTS,
} from "../lib/test-projects.mjs";

const [group, ...arguments_] = process.argv.slice(2);
const projects = { source: SOURCE_TEST_PROJECTS, built: BUILT_TEST_PROJECTS }[
  group
];
if (!projects) throw new Error("Expected source or built test group");
// The group owns project selection; callers can request reporters or shards.
if (
  arguments_.some((argument) => /^--(?:project|exclude)(?:=|$)/u.test(argument))
)
  throw new Error("Test groups cannot override their project inventory");

const files = new Set();
for (const { include, exclude = [] } of projects) {
  const excluded = exclude.map((pattern) => new Bun.Glob(pattern));
  for (const pattern of include)
    for await (const file of new Bun.Glob(pattern).scan({ cwd: "." }))
      if (!excluded.some((glob) => glob.match(file)))
        files.add(`./${file.replaceAll("\\", "/")}`);
}

const child = Bun.spawn(
  [process.execPath, "test", "--isolate", ...arguments_, ...[...files].sort()],
  { stdio: ["inherit", "inherit", "inherit"] },
);
let shutdownSignal;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    shutdownSignal ??= signal;
    child.kill(signal);
  });
const code = await child.exited;
process.exitCode =
  shutdownSignal === "SIGINT" ? 130 : shutdownSignal === "SIGTERM" ? 143 : code;
