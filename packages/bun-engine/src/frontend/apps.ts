// Media and utility apps: launchable programs that are not games. They are a small declared list in
// shell.db (the file the console shell reads too), added from the command line
// (`bun-engine library apps add <id> <title> -- <command...>`), never over HTTP: the page can list and
// launch a declared app but cannot declare a command, so a web page cannot make this service run one.
// Launching goes through the same tracked spawn as games (the "N running" pill, Stop).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnTracked } from "./launch";
import { openProfiles } from "./profiles";

export interface AppEntry {
  id: string;
  title: string;
  /** Program and arguments; the program is an absolute path or a name found on PATH. */
  command: string[];
  /** A Lucide icon name the page knows, else a generic one. */
  icon: string;
  position: number;
}

export interface AppRow extends AppEntry {
  available: boolean;
  reason?: string;
  /** The pid when this app is running. */
  pid?: number;
}

const schema =
  "CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, title TEXT NOT NULL, command TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'app-window', position INTEGER NOT NULL DEFAULT 0)";

function open() {
  const db = openProfiles();
  db.run(schema);
  return db;
}

export function listAppEntries(): AppEntry[] {
  const db = open();
  try {
    return (
      db
        .query("SELECT id, title, command, icon, position FROM apps ORDER BY position, title COLLATE NOCASE")
        .all() as Array<Omit<AppEntry, "command"> & { command: string }>
    ).map(row => ({ ...row, command: JSON.parse(row.command) as string[] }));
  } finally {
    db.close();
  }
}

function resolveProgram(program: string): string | undefined {
  if (isAbsolute(program)) return existsSync(program) ? program : undefined;
  return Bun.which(program) ?? undefined;
}

export function addApp(id: string, title: string, command: string[], icon = "app-window"): AppEntry {
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(id))
    throw new Error("an app id is 1 to 32 lowercase letters, digits, dots, dashes or underscores");
  if (!title.trim()) throw new Error("an app needs a title");
  if (!command.length || !command[0]) throw new Error("an app needs a command");
  const db = open();
  try {
    const position = (db.query("SELECT coalesce(max(position), 0) + 1 AS n FROM apps").get() as { n: number }).n;
    db.query(
      "INSERT INTO apps (id, title, command, icon, position) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET title = excluded.title, command = excluded.command, icon = excluded.icon",
    ).run(id, title.trim().slice(0, 48), JSON.stringify(command), icon, position);
  } finally {
    db.close();
  }
  return listAppEntries().find(app => app.id === id)!;
}

export function removeApp(id: string): boolean {
  const db = open();
  try {
    return db.query("DELETE FROM apps WHERE id = ?1").run(id).changes > 0;
  } finally {
    db.close();
  }
}

/** Every declared app with whether its program exists on this host and whether it runs now. */
export function listApps(running: Array<{ pid: number; app?: string }>): AppRow[] {
  return listAppEntries().map(app => {
    const program = resolveProgram(app.command[0]!);
    return {
      ...app,
      available: Boolean(program),
      reason: program ? undefined : `${app.command[0]} is not installed on this device`,
      pid: running.find(item => item.app === app.id)?.pid,
    };
  });
}

/** Launches a declared app through the tracked spawn used for games. */
export function launchApp(
  id: string,
  running: Array<{ pid: number; app?: string }>,
): { ok: true; app: string; pid: number; command: string[] } {
  const app = listAppEntries().find(item => item.id === id);
  if (!app) throw new Error(`no app ${id}`);
  const program = resolveProgram(app.command[0]!);
  if (!program) throw new Error(`${app.command[0]} is not installed on this device`);
  if (running.some(item => item.app === id)) throw new Error(`${app.title} is already running`);
  const command = [program, ...app.command.slice(1)];
  const pid = spawnTracked(command, process.cwd(), { game: 0, app: id, route: `app:${id}` });
  return { ok: true, app: id, pid, command };
}
