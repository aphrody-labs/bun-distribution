// Merge missing versioned terminal settings without replacing user-owned entries.
// `--windows-terminal` limits synchronization to Windows Terminal; `--check` is read-only.
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === "object")
    : [];
}

function mergeBy<T extends JsonObject>(
  userItems: T[],
  managedItems: T[],
  identity: (item: T) => string,
): T[] {
  const result = [...userItems];
  for (const item of managedItems) {
    const key = identity(item);
    if (!result.some((existing) => identity(existing) === key)) result.push(item);
  }
  return result;
}

function mergeMenu(userItems: JsonObject[], managedItems: JsonObject[]): JsonObject[] {
  const result = [...userItems];
  for (const item of managedItems) {
    if (item.type !== "profile" || typeof item.profile !== "string") continue;
    if (result.some((existing) => existing.type === "profile" && existing.profile === item.profile))
      continue;
    const tail = result.findIndex((existing) => existing.type === "remainingProfiles");
    result.splice(tail < 0 ? result.length : tail, 0, item);
  }
  return result;
}

function mergeTerminalSettings(userValue: unknown, managedValue: unknown): JsonObject {
  const user = object(userValue);
  const managed = object(managedValue);
  const result: JsonObject = { ...managed, ...user };

  result.actions = mergeBy(array(user.actions), array(managed.actions), (item) =>
    String(item.id ?? JSON.stringify(item)),
  );
  result.keybindings = mergeBy(array(user.keybindings), array(managed.keybindings), (item) =>
    String(item.keys ?? item.id ?? JSON.stringify(item)),
  );
  result.schemes = mergeBy(array(user.schemes), array(managed.schemes), (item) =>
    String(item.name ?? JSON.stringify(item)),
  );
  result.themes = mergeBy(array(user.themes), array(managed.themes), (item) =>
    String(item.name ?? JSON.stringify(item)),
  );
  result.newTabMenu = mergeMenu(array(user.newTabMenu), array(managed.newTabMenu));

  const userProfiles = object(user.profiles);
  const managedProfiles = object(managed.profiles);
  result.profiles = {
    ...managedProfiles,
    ...userProfiles,
    defaults: { ...object(managedProfiles.defaults), ...object(userProfiles.defaults) },
    list: mergeBy(array(userProfiles.list), array(managedProfiles.list), (item) =>
      String(item.guid ?? JSON.stringify(item)),
    ),
  };
  return result;
}

async function sameFile(left: string, right: string): Promise<boolean> {
  if (!(await Bun.file(right).exists())) return false;
  const [a, b] = await Promise.all([Bun.file(left).bytes(), Bun.file(right).bytes()]);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

const args = new Set(Bun.argv.slice(2));
const check = args.has("--check");
const windowsTerminalOnly = args.has("--windows-terminal");
if ([...args].some((arg) => arg !== "--check" && arg !== "--windows-terminal")) {
  throw new Error("Usage: bun install.ts [--check] [--windows-terminal]");
}

const here = import.meta.dir;
const local = Bun.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const rio = Bun.env.RIO_CONFIG_HOME ?? join(homedir(), "AppData", "Local", "rio");
const wt = join(local, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState");
let drift = 0;

if (!windowsTerminalOnly) {
  const themeRoot = join(here, "rio", "themes");
  const themeNames = await Array.fromAsync(
    new Bun.Glob("*").scan({ cwd: themeRoot, onlyFiles: true }),
  );
  const rioPairs = [
    [join(here, "rio", "config.toml"), join(rio, "config.toml")],
    ...themeNames.map((name) => [join(themeRoot, name), join(rio, "themes", name)]),
  ] as const;

  const results = await Promise.all(
    rioPairs.map(async ([source, target]) => {
      if (await sameFile(source, target)) return { status: "unchanged", target };
      if (check) return { status: "DIFFERS", target };
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, Bun.file(source));
      return { status: "installed", target };
    }),
  );
  for (const result of results) {
    console.log(`${result.status.padEnd(10)} ${result.target}`);
    if (result.status === "DIFFERS") drift++;
  }
}

const settingsPath = join(wt, "settings.json");
if (!(await Bun.file(settingsPath).exists())) {
  console.log(`skip       Windows Terminal (${wt} absent)`);
} else {
  const source = Bun.JSONC.parse(await Bun.file(join(here, "settings.json")).text());
  const installed = Bun.JSONC.parse(await Bun.file(settingsPath).text());
  const merged = mergeTerminalSettings(installed, source);
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const current = await Bun.file(settingsPath).text();
  if (current === content) {
    console.log(`unchanged  ${settingsPath}`);
  } else if (check) {
    console.log(`DIFFERS    ${settingsPath}`);
    drift++;
  } else {
    await Bun.write(settingsPath, content);
    console.log(`merged     ${settingsPath}`);
  }
}

process.exitCode = drift ? 1 : 0;
