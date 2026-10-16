import { delimiter, join, resolve } from "node:path";

const root = process.env.BUN_ENGINE_HOME
  ? resolve(process.env.BUN_ENGINE_HOME)
  : join(import.meta.dir, "..", "..", "..", "..");
const project = join(root, "vendor", "magika", "python");
const environment = join(project, ".venv");

export interface MagikaPrediction {
  engine: "magika";
  version: string;
  path: string;
  ok: boolean;
  status: string;
  prediction?: {
    label: string;
    mimeType: string;
    group: string;
    description: string;
    extensions: string[];
    isText: boolean;
    score: number;
  };
}

export function magikaSetupCommand(): string[] {
  return ["bun", "uv", "sync", "--project", project, "--locked", "--no-dev"];
}

export async function setupMagika(): Promise<number> {
  const child = Bun.spawn(magikaSetupCommand(), {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function sitePackages(): Promise<string> {
  const windows = join(environment, "Lib", "site-packages");
  for await (const _entry of new Bun.Glob("*").scan({ cwd: windows, dot: true })) return windows;

  for await (const path of new Bun.Glob("lib/python*/site-packages").scan({
    cwd: environment,
    absolute: true,
    onlyFiles: false,
  })) {
    return path;
  }
  throw new Error("Magika is not built; run `bun-engine ml:setup`");
}

export async function identifyWithMagika(path: string): Promise<MagikaPrediction> {
  const absolute = resolve(path);
  if (!(await Bun.file(absolute).exists())) throw new Error(`file not found: ${path}`);

  const executable = join(
    environment,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (!(await Bun.file(executable).exists())) throw new Error("Magika is not built; run `bun-engine ml:setup`");

  process.env.VIRTUAL_ENV = environment;
  process.env.BUN_PYTHON_EXECUTABLE = executable;
  process.env.PYTHONPATH = [join(root, "packages", "bun-engine", "python"), process.env.PYTHONPATH]
    .filter(Boolean)
    .join(delimiter);

  const { Python } = await import("bun:python");
  await using py = await Python.async();
  const packages = await sitePackages();
  await py.exec(
    `import site, sys; site.addsitedir(${JSON.stringify(packages)}); sys.path.insert(0, ${JSON.stringify(join(root, "packages", "bun-engine", "python"))})`,
  );
  return JSON.parse(await py.call("magika_bridge", "identify_path_json", absolute));
}
