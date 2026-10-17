import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const contextSchema = z.object({
  version: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/u),
  sourceClean: z.boolean(),
  prHeadSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .optional(),
  nodeVersion: z.string().min(1),
  bunVersion: z.string().min(1),
  bunRevision: z.string().min(1),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  taskHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{16}$/u)),
});

const CONFIGURATION = [
  ".gitignore",
  ".oxlintrc.json",
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
];
const SOURCES = [
  "scripts",
  "src",
  "tests",
  "docs",
  ".github/actions",
  "website",
  "experiments",
];

/** Static tasks and the tracked paths whose content determines their result. */
export const STATIC_TASK_INPUTS = {
  typecheck: [...CONFIGURATION, ...SOURCES],
  "lint:built": [...CONFIGURATION, ...SOURCES],
  "format:check": ["."],
  "metadata:check": [
    ...CONFIGURATION,
    "scripts/generate-package-metadata.mjs",
    "scripts/lib/generated-file.mjs",
    "plugin/skills/reverse-engineer-anything/SKILL.md",
    "src/generatedPackageMetadata.ts",
  ],
  jscpd: [...CONFIGURATION, "src", "tests"],
  "scan:todos": [...CONFIGURATION, ...SOURCES],
};

/** Parse the producing check graph's receipt; incomplete provenance is unknown. */
export const parseStaticTaskContext = (value) => contextSchema.parse(value);

const git = (root, arguments_) => {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${arguments_[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
};

/** Hash the tracked index entries of one task's inputs (mode, blob and path). */
export const hashTaskInputs = (root, paths) =>
  createHash("sha256")
    .update(git(root, ["ls-files", "-s", "-z", "--", ...paths]))
    .digest("hex")
    .slice(0, 16);

/** Retain only named task hashes and tool/source identity, never the environment. */
export async function recordStaticTaskContext({
  root = process.cwd(),
  outputDirectory = join(root, ".cache/static-checks"),
} = {}) {
  const context = parseStaticTaskContext({
    version: 1,
    sourceSha: git(root, ["rev-parse", "HEAD"]).trim(),
    sourceClean:
      git(root, ["status", "--porcelain", "--untracked-files=normal"])
        .length === 0,
    ...(process.env.CI_PR_HEAD_SHA
      ? { prHeadSha: process.env.CI_PR_HEAD_SHA }
      : {}),
    nodeVersion: process.version,
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    platform: process.platform,
    architecture: process.arch,
    taskHashes: Object.fromEntries(
      Object.entries(STATIC_TASK_INPUTS).map(([task, paths]) => [
        task,
        hashTaskInputs(root, paths),
      ]),
    ),
  });
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== context.sourceSha)
    throw new Error(
      "Static context source does not match the workflow revision",
    );
  await mkdir(outputDirectory, { recursive: true });
  await Bun.write(
    join(outputDirectory, "static-task-context.json"),
    JSON.stringify(context, null, 2) + "\n",
  );
  return context;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await recordStaticTaskContext();
