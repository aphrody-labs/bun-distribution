/**
 * `yolo create <dir>`: scaffolds an Aphrody stack project from the versioned templates in
 * `templates/` (layers and versions are described by `templates/stack.toml`).
 *
 *   yolo create my-app [--with web|react,desktop] [--framework hono|elysia] [--yolo-path <checkout>]
 *
 * Templates are plain files; `__NAME__`, `__IDENT__` and `__YOLO__` are substituted, `gitignore`
 * becomes `.gitignore`, and the `desktop` feature copies the icons of `crates/engine/yolo-desktop`.
 * Features are applied in order, a later file replaces an earlier one (the web feature replaces
 * `src/home.ts`). Templates that share an `exclusive` group in stack.toml (frontend: web or react,
 * framework: hono or elysia) cannot be combined. Zero dependencies.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface StackTemplate {
  readonly path: string;
  readonly description: string;
  readonly required?: boolean;
  readonly exclusive?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly dev_dependencies?: Readonly<Record<string, string>>;
  readonly curated?: string;
}

export interface StackManifest {
  readonly meta: Readonly<Record<string, string>>;
  readonly layer: Readonly<Record<string, Record<string, unknown>>>;
  readonly template: Readonly<Record<string, StackTemplate>>;
}

export async function loadStack(rootDir: string): Promise<StackManifest> {
  return Bun.TOML.parse(
    await Bun.file(resolve(rootDir, "templates/stack.toml")).text(),
  ) as StackManifest;
}

const TEXT_FILE =
  /\.(json|ts|tsx|js|toml|md|html|css|rs|yml|yaml|txt|sh|service)$|(^|\/)(gitignore|\.gitignore|Dockerfile)$/;

function walk(dir: string, base = dir, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, acc);
    else acc.push(abs.slice(base.length + 1));
  }
  return acc;
}

export function toIdent(name: string): string {
  const ident = name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z_]/.test(ident) ? ident : `app_${ident}`;
}

export interface CreateOptions {
  readonly rootDir: string;
  readonly target: string;
  readonly name: string;
  readonly features: readonly string[];
  readonly yoloPath: string;
}

/** Writes the project and returns the relative paths of the files created. */
export async function createProject(options: CreateOptions): Promise<string[]> {
  const stack = await loadStack(options.rootDir);
  const names = [...new Set(["base", ...options.features])];
  for (const name of names) {
    if (stack.template[name] === undefined) {
      throw new Error(
        `Unknown feature "${name}" (available: ${Object.keys(stack.template).join(", ")})`,
      );
    }
  }
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const group = stack.template[name]?.exclusive;
    if (group !== undefined) groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  for (const [group, members] of groups) {
    if (members.length > 1) throw new Error(`Choose one ${group} variant: ${members.join(" or ")}`);
  }
  if (existsSync(options.target) && readdirSync(options.target).length > 0) {
    throw new Error(`${options.target} exists and is not empty`);
  }

  const substitutions: [string, string][] = [
    ["__NAME__", options.name],
    ["__IDENT__", toIdent(options.name)],
    ["__YOLO__", options.yoloPath.replaceAll("\\", "/")],
  ];
  const written = new Map<string, string | Uint8Array>();
  const extraDependencies: Record<string, string> = {};
  const extraDevDependencies: Record<string, string> = {};

  for (const name of names) {
    const template = stack.template[name] as StackTemplate;
    const dir = resolve(options.rootDir, template.path);
    for (const rel of walk(dir)) {
      const destRel = rel
        .split(/[/\\]/)
        .map((part) => (part === "gitignore" ? ".gitignore" : part))
        .join("/");
      const bytes = readFileSync(join(dir, rel));
      if (TEXT_FILE.test(rel)) {
        let text = bytes.toString("utf8");
        for (const [token, value] of substitutions) text = text.split(token).join(value);
        written.set(destRel, text);
      } else written.set(destRel, new Uint8Array(bytes));
    }
    Object.assign(extraDependencies, template.dependencies ?? {});
    Object.assign(extraDevDependencies, template.dev_dependencies ?? {});
  }

  if (Object.keys(extraDependencies).length > 0 || Object.keys(extraDevDependencies).length > 0) {
    const pkg = JSON.parse(written.get("package.json") as string) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    Object.assign(pkg.dependencies, extraDependencies);
    Object.assign(pkg.devDependencies, extraDevDependencies);
    written.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  }
  if (names.includes("desktop")) {
    const icons = resolve(options.yoloPath, "crates/engine/yolo-desktop/icons");
    if (!existsSync(icons)) throw new Error(`Desktop icons not found: ${icons}`);
    for (const rel of walk(icons))
      written.set(`src-tauri/icons/${rel}`, new Uint8Array(readFileSync(join(icons, rel))));
  }

  mkdirSync(options.target, { recursive: true });
  for (const [rel, content] of written) {
    const dest = resolve(options.target, rel);
    mkdirSync(dirname(dest), { recursive: true });
    await Bun.write(dest, content);
  }
  return [...written.keys()].sort();
}

const HELP = `\x1b[1myolo create\x1b[0m <dir> — scaffold an Aphrody stack project

  --with web,desktop        Features on top of the base server (default: web; react replaces web)
  --framework hono|elysia   Add a framework variant of the HTTP surface (src/alt/)
  --name <name>             Package name (default: the directory name)
  --yolo-path <dir>         Yolo checkout the project links to (default: this checkout)
  --list                    Show the available templates and layers`;

export async function runCreateCommand(
  args: readonly string[],
  rootDir: string = process.cwd(),
): Promise<number> {
  const positional: string[] = [];
  let features: string[] = ["web"];
  let framework: string | undefined;
  let name: string | undefined;
  let yoloPath = rootDir;
  let list = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    if (arg === "--with") features = value().split(",").filter(Boolean);
    else if (arg === "--framework") framework = value();
    else if (arg === "--name") name = value();
    else if (arg === "--yolo-path") yoloPath = resolve(value());
    else if (arg === "--list") list = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      return 0;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }

  if (list) {
    const stack = await loadStack(rootDir);
    console.log(
      `\x1b[1m${stack.meta["name"]}\x1b[0m (Bun ${stack.meta["bun"]}, runtime ABI ${stack.meta["runtime_abi"]})`,
    );
    for (const [id, t] of Object.entries(stack.template)) {
      console.log(`  ${id.padEnd(8)} ${t.required ? "(always) " : "         "}${t.description}`);
    }
    for (const [id, layer] of Object.entries(stack.layer)) {
      console.log(`  layer ${id.padEnd(9)} ${String(layer["plan"]).padEnd(3)} ${layer["status"]}`);
    }
    return 0;
  }
  const dir = positional[0];
  if (dir === undefined) {
    console.log(HELP);
    return 1;
  }
  if (framework !== undefined) features.push(framework);
  const target = resolve(process.cwd(), dir);
  const files = await createProject({
    rootDir,
    target,
    name: name ?? basename(target),
    features,
    yoloPath,
  });
  console.log(
    `\x1b[1mCreated ${basename(target)}\x1b[0m (${files.length} files, features: base, ${features.join(", ")})`,
  );
  console.log(
    `\n  cd ${dir}\n  bun install\n  just -f ${join(yoloPath, "justfile")} runtime-build   # once\n  bun run dev`,
  );
  return 0;
}
