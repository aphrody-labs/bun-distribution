// SPDX-License-Identifier: Apache-2.0
import { userHome } from "@aphrody/paths";
import { spawnSync } from "@aphrody/update/process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const help = `Usage: aphrody workspace code-edit <search|replace|add-before|add-after|remove|rename|restore> [options]
  --engine text|regex|ast|codemod|yolo  Default: text (rename/restore: yolo)
  --root PATH                    Default: current directory
  --glob PATTERN                  Repeatable file filters (ripgrep syntax)
  --find PATTERN                  Literal, regex or AST pattern
  --with TEXT                     Replacement or insertion (empty is allowed)
  --lang LANG                     AST language, e.g. ts, tsx, rust
  --transform FILE                Existing jscodeshift codemod
  --paths                         YOLO: rename file paths too
  --journal FILE                  YOLO: restore a rename journal
  --yolo-root PATH                APHRODY_YOLO_ROOT or ~/aphrody
  --apply                         Write files; default previews only
  --help                          Show help

Selection respects ripgrep ignore rules. Binary files and symlinks are excluded.
AST supports search/replace/remove; insertion uses an explicit rewrite template.
Codemod supports replace with --transform. Globs select its input files too.
`;
export type EditOptions = {
  operation: string;
  engine: string;
  root: string;
  globs: string[];
  find?: string;
  replacement?: string;
  lang?: string;
  transform?: string;
  apply: boolean;
  paths: boolean;
  yoloRoot: string;
  journal?: string;
};
export function parseCodeEdit(argv: string[]): EditOptions {
  const options: EditOptions = {
    operation: argv[0] ?? "help",
    engine: ["rename", "restore"].includes(argv[0] ?? "") ? "yolo" : "text",
    root: process.cwd(),
    globs: [],
    apply: false,
    paths: false,
    yoloRoot: resolve(process.env.APHRODY_YOLO_ROOT ?? `${userHome()}/aphrody`),
  };
  if (argv.includes("--help") || argv.includes("-h")) return { ...options, operation: "help" };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === "--apply") {
      options.apply = true;
      continue;
    }
    if (flag === "--paths") {
      options.paths = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--yolo-root":
        options.yoloRoot = resolve(value);
        break;
      case "--journal":
        options.journal = resolve(value);
        break;
      case "--root":
        options.root = resolve(value);
        break;
      case "--engine":
        options.engine = value;
        break;
      case "--glob":
        options.globs.push(value);
        break;
      case "--find":
        options.find = value;
        break;
      case "--with":
        options.replacement = value;
        break;
      case "--lang":
        options.lang = value;
        break;
      case "--transform":
        options.transform = resolve(value);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!["search", "replace", "add-before", "add-after", "remove", "rename", "restore"].includes(options.operation))
    throw new Error("Unknown operation");
  if (!["text", "regex", "ast", "codemod", "yolo"].includes(options.engine)) throw new Error("Unknown engine");
  if (options.engine === "yolo") {
    if (!["rename", "restore"].includes(options.operation)) throw new Error("YOLO supports rename/restore");
    if (options.operation === "restore" && !options.journal) throw new Error("Restore requires --journal FILE");
    if (options.operation === "rename" && (!options.find || options.replacement === undefined))
      throw new Error("Rename requires --find and --with");
  } else if (["rename", "restore"].includes(options.operation)) {
    throw new Error("Rename/restore require the yolo engine");
  } else if (options.engine === "codemod") {
    if (options.operation !== "replace" || !options.transform || !existsSync(options.transform))
      throw new Error("Codemod requires replace --transform FILE");
  } else {
    if (!options.find) throw new Error("A non-empty --find pattern is required");
    if (options.operation !== "search" && options.operation !== "remove" && options.replacement === undefined)
      throw new Error("--with is required");
    if (options.engine === "ast" && (!options.lang || options.operation.startsWith("add-")))
      throw new Error("AST requires --lang; use replace with a rewrite template for insertion");
  }
  if (options.paths && options.operation !== "rename") throw new Error("--paths requires rename");
  if (options.journal && options.operation !== "restore") throw new Error("--journal requires restore");
  return options;
}
export function editCommand(options: EditOptions, paths: string[]): string[] {
  if (options.engine === "yolo")
    return [
      process.execPath,
      resolve(options.yoloRoot, "packages/engine/yolo/src/index.ts"),
      "rename",
      ...(options.operation === "restore"
        ? ["--restore", options.journal!]
        : [
            "--from",
            options.find!,
            "--to",
            options.replacement!,
            ...options.globs.flatMap(glob =>
              glob.startsWith("!") ? ["--exclude", glob.slice(1)] : ["--include", glob],
            ),
            ...(options.paths ? ["--paths"] : []),
            options.root,
          ]),
      ...(options.apply ? ["--apply"] : []),
    ];
  if (options.engine === "codemod")
    return [
      "jscodeshift",
      "--fail-on-error",
      "-t",
      options.transform!,
      ...(options.apply ? [] : ["--dry", "--print"]),
      ...(options.lang ? ["--parser", options.lang] : []),
      ...paths,
    ];
  if (options.engine === "ast")
    return [
      "ast-grep",
      "run",
      "-p",
      options.find!,
      "-l",
      options.lang!,
      ...(options.operation === "search"
        ? ["--json"]
        : ["-r", options.operation === "remove" ? "" : options.replacement!, ...(options.apply ? ["-U"] : [])]),
      ...paths,
    ];
  if (options.operation === "search")
    return ["rg", "--line-number", ...(options.engine === "text" ? ["-F"] : []), "--", options.find!, ...paths];
  if (options.engine === "text") throw new Error("Literal text edits execute in-process");
  let replacement = options.operation === "remove" ? "" : options.replacement!;
  if (options.operation.startsWith("add-")) {
    const match = "$0";
    if (options.engine === "regex") replacement = replacement.replaceAll("$", () => "$$");
    replacement = options.operation === "add-before" ? replacement + match : match + replacement;
  }
  return [
    "sd",
    ...(options.apply ? [] : ["--preview"]),
    ...(options.engine === "text" ? ["-F"] : []),
    "--",
    options.find!,
    replacement,
    ...paths,
  ];
}
function editLiteralText(options: EditOptions, paths: string[], root: string): void {
  const find = options.find!;
  const inserted = options.operation === "remove" ? "" : options.replacement!;
  const replacement =
    options.operation === "add-before"
      ? inserted + find
      : options.operation === "add-after"
        ? find + inserted
        : inserted;
  for (const path of paths) {
    const before = readFileSync(path, "utf8");
    if (!before.includes(find)) continue;
    // A callback preserves dollar signs and multiline text literally.
    const after = before.replaceAll(find, () => replacement);
    if (after === before) continue;
    if (!options.apply) {
      let offset = 0;
      while ((offset = before.indexOf(find, offset)) !== -1) {
        const line = before.slice(0, offset).split("\n").length;
        process.stdout.write(`${path}:${line}: ${JSON.stringify(find)} -> ${JSON.stringify(replacement)}\n`);
        offset += find.length;
      }
      continue;
    }
    const local = relative(root, realpathSync(path));
    if (!lstatSync(path).isFile() || isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) {
      throw new Error(`Selected file changed ownership: ${path}`);
    }
    if (readFileSync(path, "utf8") !== before) throw new Error(`Selected file changed during editing: ${path}`);
    writeFileSync(path, after);
    process.stdout.write(`${path}\n`);
  }
}
function execute(command: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
export function runCodeEdit(argv: string[]): number {
  try {
    const options = parseCodeEdit(argv);
    if (options.operation === "help") {
      console.log(help);
      return 0;
    }
    if (options.engine === "yolo") {
      const entry = resolve(options.yoloRoot, "packages/engine/yolo/src/index.ts");
      if (!existsSync(entry)) throw new Error("YOLO CLI missing; set --yolo-root to its checkout");
      const result = execute(editCommand(options, []), options.yoloRoot);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result.status;
    }
    const root = realpathSync(options.root);
    const selected = execute(["rg", "--files", "-0", ...options.globs.flatMap(g => ["-g", g]), "--", root], root);
    if (selected.status > 1) throw new Error(selected.stderr);
    const paths = selected.stdout
      .split("\0")
      .filter(Boolean)
      .filter(path => {
        if (!lstatSync(path).isFile()) return false;
        const local = relative(root, realpathSync(path));
        return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`) && !readFileSync(path).includes(0);
      });
    if (options.engine === "text" && options.operation !== "search") {
      editLiteralText(options, paths, root);
      console.error(`${options.apply ? "Apply" : "Preview"}: ${paths.length} selected text files; engine=text`);
      return 0;
    }
    let failed = false;
    for (let offset = 0; offset < paths.length; offset += 100) {
      const result = execute(editCommand(options, paths.slice(offset, offset + 100)), root);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      // Search tools use 1 to indicate no matches, not an execution error.
      if (result.status !== 0 && !(options.operation === "search" && result.status === 1)) failed = true;
      if (failed) break;
    }
    console.error(
      `${options.apply ? "Apply" : "Preview"}: ${paths.length} selected text files; engine=${options.engine}`,
    );
    return failed ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
if (import.meta.main) process.exit(runCodeEdit(process.argv.slice(2)));
