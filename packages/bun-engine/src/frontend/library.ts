// The frontend library: systems -> games from the bep project (package.json bunEngine + bep.lock),
// the content-addressed ROM store, the free ROM packs and folders the user adds. Games are hashed
// (CRC32, MD5) and matched against libretro-database DATs into usr/var/lib/bep/library.db.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { defaultFirmwareStore, type FirmwareManifest } from "../firmware/import";
import * as pm from "../pm";
import { repoRoot, usrRoot } from "../usr";
import { detectSystem, extensionOf, loadSystems, type SystemDefinition, systemsForConsole } from "./systems";

const maxHashBytes = 256 * 1024 * 1024;
export const databaseDir = join(repoRoot, "vendor", "libretro-database");

export interface Source {
  id: number;
  kind: "bep" | "store" | "free" | "folder";
  path: string;
  system: string | null;
}

export interface Game {
  id: number;
  system: string;
  path: string;
  file: string;
  name: string;
  source: string;
  size: number;
  mtime: number;
  crc: string | null;
  md5: string | null;
  title: string | null;
  description: string | null;
  developer: string | null;
  year: string | null;
  region: string | null;
  serial: string | null;
  dat: string | null;
  route: string | null;
  /** A `<stem>.png|webp|jpg` next to the game file, shown as its cover. */
  cover: string | null;
  favorite: number;
  playCount: number;
  lastPlayed: string | null;
}

/** The bep project the frontend manages: BEP_PROJECT, else a library project inside usr/. */
export function projectDir(): string {
  return resolve(Bun.env.BEP_PROJECT ?? join(usrRoot(), "var", "lib", "bep", "library"));
}

let queue: Promise<unknown> = Promise.resolve();
/** Runs a bep operation with the project as working directory, one at a time. */
export function inProject<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const dir = projectDir();
    mkdirSync(dir, { recursive: true });
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) {
      await Bun.write(
        manifest,
        `${JSON.stringify({ name: "bun-engine-library", private: true, bunEngine: { cores: [], binaries: [], libretro: [], firmware: {}, roms: {} } }, null, 2)}\n`,
      );
    }
    const previous = process.cwd();
    process.chdir(dir);
    try {
      return await operation();
    } finally {
      process.chdir(previous);
    }
  });
  queue = run.catch(() => {});
  return run;
}

export function romStore(): string {
  return join(dirname(defaultFirmwareStore()), "roms");
}

let database: Database | undefined;
export function db(): Database {
  if (database) return database;
  const dir = join(usrRoot(), "var", "lib", "bep");
  mkdirSync(dir, { recursive: true });
  database = new Database(join(dir, "library.db"), {
    create: true,
    strict: true,
  });
  database.run("PRAGMA journal_mode = WAL");
  database.run(`CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, system TEXT, UNIQUE (kind, path))`);
  database.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY, system TEXT NOT NULL, path TEXT NOT NULL UNIQUE, file TEXT NOT NULL, name TEXT NOT NULL,
    source TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, crc TEXT, md5 TEXT, title TEXT, description TEXT,
    developer TEXT, year TEXT, region TEXT, serial TEXT, dat TEXT, route TEXT, favorite INTEGER NOT NULL DEFAULT 0,
    playCount INTEGER NOT NULL DEFAULT 0, lastPlayed TEXT, scan INTEGER NOT NULL DEFAULT 0)`);
  if (
    !database
      .query<{ name: string }, []>("PRAGMA table_info(games)")
      .all()
      .some(column => column.name === "cover")
  )
    database.run("ALTER TABLE games ADD COLUMN cover TEXT");
  database.run("CREATE INDEX IF NOT EXISTS games_system ON games (system)");
  database.run(
    "CREATE TABLE IF NOT EXISTS dat_files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, entries INTEGER NOT NULL)",
  );
  database.run(`CREATE TABLE IF NOT EXISTS dat_roms (
    dat TEXT NOT NULL, crc TEXT, md5 TEXT, size INTEGER, name TEXT NOT NULL, description TEXT, developer TEXT,
    year TEXT, region TEXT, serial TEXT)`);
  database.run("CREATE INDEX IF NOT EXISTS dat_roms_crc ON dat_roms (crc)");
  database.run("CREATE INDEX IF NOT EXISTS dat_roms_md5 ON dat_roms (md5)");
  database.run("CREATE TABLE IF NOT EXISTS defaults (system TEXT PRIMARY KEY, route TEXT NOT NULL)");
  // Profiles (additive, nothing existing is altered): one row per launch with the profile that played,
  // seeded once from the legacy games.lastPlayed so the default profile keeps its history.
  const hadPlays = database
    .query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'plays'")
    .get()!.n;
  database.run(
    "CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, created TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  database.run("INSERT OR IGNORE INTO players (name) VALUES ('default')");
  database.run(
    "CREATE TABLE IF NOT EXISTS plays (id INTEGER PRIMARY KEY, game INTEGER NOT NULL, profile TEXT NOT NULL DEFAULT 'default', at TEXT NOT NULL)",
  );
  database.run("CREATE INDEX IF NOT EXISTS plays_profile ON plays (profile, at)");
  if (!hadPlays)
    database.run(
      "INSERT INTO plays (game, profile, at) SELECT id, 'default', lastPlayed FROM games WHERE lastPlayed IS NOT NULL",
    );
  const seeded = database.query<{ n: number }, []>("SELECT count(*) AS n FROM sources").get()!.n;
  if (!seeded) {
    database.query("INSERT INTO sources (kind, path) VALUES ('bep', ''), ('store', ''), ('free', '*')").run();
  }
  return database;
}

export function listSources(): Source[] {
  return db().query<Source, []>("SELECT * FROM sources ORDER BY id").all();
}

export async function addFolder(path: string, system?: string): Promise<Source> {
  const dir = resolve(path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  if (system && !(await loadSystems()).systems.some(item => item.id === system))
    throw new Error(`unknown system ${system}`);
  db()
    .query(
      "INSERT INTO sources (kind, path, system) VALUES ('folder', ?1, ?2) ON CONFLICT (kind, path) DO UPDATE SET system = ?2",
    )
    .run(dir, system ?? null);
  return db().query<Source, [string]>("SELECT * FROM sources WHERE kind = 'folder' AND path = ?").get(dir)!;
}

export function removeSource(id: number): void {
  db().query("DELETE FROM sources WHERE id = ?").run(id);
}

/** Tokenizes a clrmamepro DAT: parentheses, quoted strings and bare words. */
function* tokens(text: string): Generator<string> {
  const re = /"((?:[^"\\]|\\.)*)"|([()])|([^\s()"]+)/g;
  for (let match = re.exec(text); match; match = re.exec(text)) yield match[1] ?? match[2] ?? match[3]!;
}

type DatNode = Map<string, Array<string | DatNode>>;

function parseBlock(stream: Generator<string>): DatNode {
  const node: DatNode = new Map();
  for (let key = stream.next(); !key.done && key.value !== ")"; key = stream.next()) {
    const value = stream.next();
    if (value.done) break;
    const entry = value.value === "(" ? parseBlock(stream) : value.value;
    const list = node.get(key.value) ?? [];
    list.push(entry);
    node.set(key.value, list);
  }
  return node;
}

function field(node: DatNode, key: string): string | null {
  const value = node.get(key)?.[0];
  return typeof value === "string" ? value : null;
}

/** Imports one libretro-database DAT into dat_roms when it changed since the last import. */
async function importDat(relativeDat: string): Promise<number> {
  const path = join(databaseDir, relativeDat);
  if (!existsSync(path)) return 0;
  const mtime = Math.trunc(statSync(path).mtimeMs);
  const known = db()
    .query<{ mtime: number; entries: number }, [string]>("SELECT mtime, entries FROM dat_files WHERE path = ?")
    .get(relativeDat);
  if (known?.mtime === mtime) return known.entries;
  const stream = tokens(await Bun.file(path).text());
  const insert = db().query(
    "INSERT INTO dat_roms VALUES ($dat, $crc, $md5, $size, $name, $description, $developer, $year, $region, $serial)",
  );
  let entries = 0;
  db().transaction(() => {
    db().query("DELETE FROM dat_roms WHERE dat = ?").run(relativeDat);
    for (let token = stream.next(); !token.done; token = stream.next()) {
      const open = stream.next();
      if (open.value !== "(") continue;
      const block = parseBlock(stream);
      if (token.value !== "game") continue;
      for (const rom of block.get("rom") ?? []) {
        if (typeof rom === "string") continue;
        insert.run({
          dat: relativeDat,
          crc: field(rom, "crc")?.toLowerCase() ?? null,
          md5: field(rom, "md5")?.toLowerCase() ?? null,
          size: Number(field(rom, "size") ?? 0),
          name: field(block, "name") ?? field(rom, "name") ?? "",
          description: field(block, "description"),
          developer: field(block, "developer") ?? field(block, "publisher"),
          year: field(block, "releaseyear") ?? field(block, "year"),
          region: field(block, "region"),
          serial: field(block, "serial") ?? field(rom, "serial"),
        });
        entries++;
      }
    }
    db().query("INSERT OR REPLACE INTO dat_files VALUES (?, ?, ?)").run(relativeDat, mtime, entries);
  })();
  return entries;
}

/** Checks out the pinned libretro-database (DATs only) when it is missing. */
export function ensureDatabase(): boolean {
  if (existsSync(join(databaseDir, "metadat"))) return true;
  const submodule = Bun.spawnSync([
    "git",
    "-C",
    repoRoot,
    "submodule",
    "update",
    "--init",
    "--depth",
    "1",
    "--",
    "vendor/libretro-database",
  ]);
  if (submodule.success && existsSync(join(databaseDir, "metadat"))) return true;
  const url = Bun.spawnSync([
    "git",
    "-C",
    repoRoot,
    "config",
    "-f",
    ".gitmodules",
    "submodule.vendor/libretro-database.url",
  ])
    .stdout.toString()
    .trim();
  if (!url) return false;
  const clone = Bun.spawnSync(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", url, databaseDir]);
  if (!clone.success) return false;
  Bun.spawnSync([
    "git",
    "-C",
    databaseDir,
    "sparse-checkout",
    "set",
    "metadat/no-intro",
    "metadat/redump",
    "metadat/homebrew",
  ]);
  return existsSync(join(databaseDir, "metadat"));
}

interface Hashes {
  crc: string;
  md5: string;
  headerless?: string;
}

async function hashFile(path: string, ext: string, system: SystemDefinition): Promise<Hashes | undefined> {
  const file = Bun.file(path);
  if (file.size === 0 || file.size > maxHashBytes) return undefined;
  const bytes = await file.bytes();
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  const hashes: Hashes = {
    crc: hex(Bun.hash.crc32(bytes)),
    md5: new Bun.CryptoHasher("md5").update(bytes).digest("hex"),
  };
  const header = system.headerBytes?.[ext];
  if (header && bytes.length > header) hashes.headerless = hex(Bun.hash.crc32(bytes.subarray(header)));
  return hashes;
}

export interface DatRow {
  dat: string;
  name: string;
  size?: number | null;
  description: string | null;
  developer: string | null;
  year: string | null;
  region: string | null;
  serial: string | null;
}

function matchDat(system: SystemDefinition, hashes: Hashes | undefined): DatRow | undefined {
  if (!hashes || !system.dats.length) return undefined;
  const dats = JSON.stringify(system.dats);
  const byCrc = db().query<DatRow, [string, string]>(
    "SELECT * FROM dat_roms WHERE crc = ?1 AND dat IN (SELECT value FROM json_each(?2)) LIMIT 1",
  );
  return (
    byCrc.get(hashes.crc, dats) ??
    db()
      .query<DatRow, [string, string]>(
        "SELECT * FROM dat_roms WHERE md5 = ?1 AND dat IN (SELECT value FROM json_each(?2)) LIMIT 1",
      )
      .get(hashes.md5, dats) ??
    (hashes.headerless ? byCrc.get(hashes.headerless, dats) : null) ??
    undefined
  );
}

/**
 * Verifies one dump against the No-Intro/Redump DATs of `system` (imported on demand): a CRC32
 * match with the same size, an MD5 match, or the CRC32 without the copier header. `serial` lists
 * the DAT entries sharing the header serial, so a size mismatch can be told from a missing revision.
 */
export async function verifyDump(
  system: SystemDefinition,
  dump: { crc: string; md5: string; size: number; headerless?: string; serial?: string | null },
): Promise<{ match?: DatRow; serial: DatRow[] }> {
  if (!system.dats.length) return { serial: [] };
  ensureDatabase();
  for (const dat of system.dats) await importDat(dat);
  const dats = JSON.stringify(system.dats);
  const scoped = "dat IN (SELECT value FROM json_each($dats))";
  const match =
    db()
      .query<DatRow, { crc: string; md5: string; size: number; dats: string }>(
        `SELECT * FROM dat_roms WHERE ${scoped} AND ((crc = $crc AND (size = $size OR size = 0)) OR md5 = $md5) LIMIT 1`,
      )
      .get({ crc: dump.crc, md5: dump.md5, size: dump.size, dats }) ??
    (dump.headerless
      ? db()
          .query<DatRow, { crc: string; dats: string }>(`SELECT * FROM dat_roms WHERE ${scoped} AND crc = $crc LIMIT 1`)
          .get({ crc: dump.headerless, dats })
      : null);
  const serial = dump.serial?.trim()
    ? db()
        .query<DatRow, { serial: string; dats: string }>(
          `SELECT * FROM dat_roms WHERE ${scoped} AND serial = $serial LIMIT 50`,
        )
        .all({ serial: dump.serial.trim(), dats })
    : [];
  return { ...(match ? { match } : {}), serial };
}

/** A note shipped next to a free ROM (TetaNES bundles `<game>.txt`). */
async function sidecarNote(path: string): Promise<string | null> {
  const note = Bun.file(path.replace(/\.[^.\\/]+$/, ".txt"));
  if (!(await note.exists()) || note.size > 64 * 1024) return null;
  return (await note.text()).trim().slice(0, 600) || null;
}

/** The cover of a game: an image named like the game file, next to it. */
function coverFor(path: string): string | null {
  const stem = path.replace(/\.[^.\\/]+$/, "");
  return ["png", "webp", "jpg", "jpeg"].map(ext => `${stem}.${ext}`).find(file => existsSync(file)) ?? null;
}

interface Candidate {
  path: string;
  system: SystemDefinition;
  name: string;
  source: string;
}

async function* candidates(): AsyncGenerator<Candidate> {
  const seen = new Set<string>();
  const emit = (candidate: Candidate) => {
    const key = resolve(candidate.path).toLowerCase();
    if (seen.has(key) || !existsSync(candidate.path)) return false;
    seen.add(key);
    return true;
  };
  for (const source of listSources()) {
    if (source.kind === "bep") {
      const dir = source.path || projectDir();
      const lock = Bun.file(join(dir, "bep.lock"));
      if (!(await lock.exists())) continue;
      const { roms } = (await lock.json()) as {
        roms: Record<string, FirmwareManifest>;
      };
      for (const [name, rom] of Object.entries(roms ?? {})) {
        const system = (await systemsForConsole(rom.console))[0];
        const candidate = {
          path: join(romStore(), rom.console, rom.file),
          system: system!,
          name,
          source: `bep:${name}`,
        };
        if (system && emit(candidate)) yield candidate;
      }
    } else if (source.kind === "store") {
      const store = source.path || romStore();
      if (!existsSync(store)) continue;
      for await (const path of new Bun.Glob("*/*.json").scan({
        cwd: store,
        absolute: true,
        onlyFiles: true,
      })) {
        const rom = (await Bun.file(path).json()) as FirmwareManifest;
        // Owned dumps of systems without a catalog console are filed under the system id.
        const system =
          (await systemsForConsole(rom.console))[0] ??
          (await loadSystems()).systems.find(item => item.id === rom.console);
        const candidate = {
          path: join(dirname(path), rom.file),
          system: system!,
          name: rom.sha256.slice(0, 12),
          source: "store",
        };
        if (system && emit(candidate)) yield candidate;
      }
    } else if (source.kind === "free") {
      for (const rom of await pm.freeRoms()) {
        const system = (await systemsForConsole(rom.console))[0];
        const path = join(repoRoot, rom.path);
        const candidate = {
          path,
          system: system!,
          name: basename(path).replace(/\.[^.]+$/, ""),
          source: `free:${rom.pack}`,
        };
        if (system && emit(candidate)) yield candidate;
      }
    } else if (existsSync(source.path)) {
      const glob = new Bun.Glob("**/*");
      for await (const rel of glob.scan({
        cwd: source.path,
        onlyFiles: true,
        followSymlinks: false,
      })) {
        if (/(^|[\\/])(\.|node_modules[\\/])/.test(rel)) continue;
        const system = await detectSystem(rel, source.system);
        if (!system) continue;
        const path = join(source.path, rel);
        const candidate = {
          path,
          system,
          name: basename(rel).replace(/\.[^.]+$/, ""),
          source: `folder:${source.id}`,
        };
        if (emit(candidate)) yield candidate;
      }
    }
  }
}

export interface ScanSummary {
  games: number;
  hashed: number;
  matched: number;
  removed: number;
  dats: Record<string, number>;
  systems: Record<string, number>;
  ms: number;
}

/** Rescans every source; unchanged files keep their hashes, missing ones are dropped. */
export async function scanLibrary(): Promise<ScanSummary> {
  const started = performance.now();
  const summary: ScanSummary = {
    games: 0,
    hashed: 0,
    matched: 0,
    removed: 0,
    dats: {},
    systems: {},
    ms: 0,
  };
  ensureDatabase();
  for (const system of (await loadSystems()).systems)
    for (const dat of system.dats) summary.dats[dat] ??= await importDat(dat);
  const scan = Date.now();
  const existing = db().query<Game, [string]>("SELECT * FROM games WHERE path = ?");
  const upsert = db()
    .query(`INSERT INTO games (system, path, file, name, source, size, mtime, crc, md5, title, description,
      developer, year, region, serial, dat, cover, scan)
    VALUES ($system, $path, $file, $name, $source, $size, $mtime, $crc, $md5, $title, $description, $developer, $year,
      $region, $serial, $dat, $cover, $scan)
    ON CONFLICT (path) DO UPDATE SET system = $system, file = $file, name = $name, source = $source, size = $size,
      mtime = $mtime, crc = $crc, md5 = $md5, title = $title, description = $description, developer = $developer,
      year = $year, region = $region, serial = $serial, dat = $dat, cover = $cover, scan = $scan`);
  for await (const candidate of candidates()) {
    const path = resolve(candidate.path);
    const stat = statSync(path);
    const mtime = Math.trunc(stat.mtimeMs);
    const ext = extensionOf(path);
    const previous = existing.get(path);
    let hashes: Hashes | undefined;
    if (previous && previous.size === stat.size && previous.mtime === mtime && previous.crc && previous.md5) {
      hashes = { crc: previous.crc, md5: previous.md5 };
      const header = candidate.system.headerBytes?.[ext];
      if (header) hashes = await hashFile(path, ext, candidate.system);
    } else {
      hashes = await hashFile(path, ext, candidate.system);
      if (hashes) summary.hashed++;
    }
    const dat = matchDat(candidate.system, hashes);
    if (dat) summary.matched++;
    upsert.run({
      system: candidate.system.id,
      path,
      file: relative(repoRoot, path).startsWith("..") ? path : relative(repoRoot, path),
      name: candidate.name,
      source: candidate.source,
      size: stat.size,
      mtime,
      crc: hashes?.crc ?? null,
      md5: hashes?.md5 ?? null,
      title: dat?.name ?? null,
      description: dat?.description ?? (await sidecarNote(path)),
      developer: dat?.developer ?? null,
      year: dat?.year ?? null,
      region: dat?.region ?? null,
      serial: dat?.serial ?? null,
      dat: dat?.dat ?? null,
      cover: coverFor(path),
      scan,
    });
    summary.games++;
    summary.systems[candidate.system.id] = (summary.systems[candidate.system.id] ?? 0) + 1;
  }
  summary.removed = db().query("DELETE FROM games WHERE scan <> ?").run(scan).changes;
  summary.ms = Math.round(performance.now() - started);
  return summary;
}

export function gamesFor(system?: string): Game[] {
  return system
    ? db()
        .query<Game, [string]>(
          "SELECT * FROM games WHERE system = ? ORDER BY favorite DESC, coalesce(title, name) COLLATE NOCASE",
        )
        .all(system)
    : db().query<Game, []>("SELECT * FROM games ORDER BY system, coalesce(title, name) COLLATE NOCASE").all();
}

export function gameById(id: number): Game {
  const game = db().query<Game, [number]>("SELECT * FROM games WHERE id = ?").get(id);
  if (!game) throw new Error(`no game ${id}`);
  return game;
}

/** A game by library id or by file path (added to the library on the fly). */
export async function findGame(idOrPath: string, system?: string): Promise<Game> {
  if (/^\d+$/.test(idOrPath)) return gameById(Number(idOrPath));
  const path = resolve(idOrPath);
  const known = db().query<Game, [string]>("SELECT * FROM games WHERE path = ?").get(path);
  if (known) return known;
  const detected = await detectSystem(basename(path), system);
  if (!detected) throw new Error(`cannot tell the system of ${path}; pass --system`);
  const stat = statSync(path);
  db()
    .query(
      "INSERT INTO games (system, path, file, name, source, size, mtime, scan) VALUES (?, ?, ?, ?, 'cli', ?, ?, ?)",
    )
    .run(
      detected.id,
      path,
      path,
      basename(path).replace(/\.[^.]+$/, ""),
      stat.size,
      Math.trunc(stat.mtimeMs),
      Date.now(),
    );
  return db().query<Game, [string]>("SELECT * FROM games WHERE path = ?").get(path)!;
}

export function totalGames(): number {
  return db().query<{ n: number }, []>("SELECT count(*) AS n FROM games").get()!.n;
}

export function systemCounts(): Record<string, number> {
  const rows = db()
    .query<{ system: string; n: number }, []>("SELECT system, count(*) AS n FROM games GROUP BY system")
    .all();
  return Object.fromEntries(rows.map(row => [row.system, row.n]));
}

/** Per system, the id of the first game that has a cover (the system card shows it). */
export function systemCovers(): Record<string, number> {
  const rows = db()
    .query<{ system: string; id: number }, []>(
      "SELECT system, min(id) AS id FROM games WHERE cover IS NOT NULL GROUP BY system",
    )
    .all();
  return Object.fromEntries(rows.map(row => [row.system, row.id]));
}

export function setFavorite(id: number, favorite: boolean): void {
  db()
    .query("UPDATE games SET favorite = ? WHERE id = ?")
    .run(favorite ? 1 : 0, id);
}

export function setGameRoute(id: number, route: string | null): void {
  db().query("UPDATE games SET route = ? WHERE id = ?").run(route, id);
}

export function recordPlay(id: number, profile = "default"): void {
  const now = new Date().toISOString();
  const known = db().query<{ name: string }, [string]>("SELECT name FROM players WHERE name = ?").get(profile);
  db().transaction(() => {
    db().query("UPDATE games SET playCount = playCount + 1, lastPlayed = ? WHERE id = ?").run(now, id);
    db()
      .query("INSERT INTO plays (game, profile, at) VALUES (?1, ?2, ?3)")
      .run(id, known ? profile : "default", now);
  })();
}

export interface Player {
  name: string;
  plays: number;
}

export function listPlayers(): Player[] {
  return db()
    .query<Player, []>(
      "SELECT p.name AS name, (SELECT count(*) FROM plays WHERE profile = p.name) AS plays FROM players p ORDER BY p.name = 'default' DESC, p.name COLLATE NOCASE",
    )
    .all();
}

export function addPlayer(name: string): Player {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,23}$/u.test(clean))
    throw new Error("a profile name has 1 to 24 letters or digits");
  db().query("INSERT OR IGNORE INTO players (name) VALUES (?)").run(clean);
  return listPlayers().find(player => player.name === clean)!;
}

/** The games a profile played last, newest first, with that profile's own play count and date. */
export function recentGames(profile = "default", limit = 12): Game[] {
  const rows = db()
    .query<Game & { profileLast: string; profileCount: number }, [string, number]>(
      `SELECT g.*, p.last AS profileLast, p.n AS profileCount FROM games g
       JOIN (SELECT game, max(at) AS last, count(*) AS n FROM plays WHERE profile = ?1 GROUP BY game) p ON p.game = g.id
       ORDER BY p.last DESC LIMIT ?2`,
    )
    .all(profile, limit);
  return rows.map(({ profileLast, profileCount, ...game }) => ({
    ...game,
    lastPlayed: profileLast,
    playCount: profileCount,
  }));
}

/** A game with the play count and last play of one profile (the games columns count every profile). */
export function profileGame(id: number, profile = "default"): Game {
  const game = gameById(id);
  const own = db()
    .query<{ n: number; last: string | null }, [number, string]>(
      "SELECT count(*) AS n, max(at) AS last FROM plays WHERE game = ?1 AND profile = ?2",
    )
    .get(id, profile)!;
  return { ...game, playCount: own.n, lastPlayed: own.last };
}

/** Other games of the same system for the game page: the same developer first, then favourites, then by title. */
export function relatedGames(game: Game, limit = 12): Game[] {
  return db()
    .query<Game, [string, number, string, number]>(
      `SELECT * FROM games WHERE system = ?1 AND id != ?2
       ORDER BY (developer IS NOT NULL AND developer = ?3) DESC, favorite DESC, coalesce(title, name) COLLATE NOCASE LIMIT ?4`,
    )
    .all(game.system, game.id, game.developer ?? "", Math.trunc(limit));
}

/** Games whose title, file name, developer or system matches every word of `query`. */
export function searchGames(query: string, limit = 60): Game[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const clauses = words.map(
    (_, i) =>
      `(lower(coalesce(title, name)) LIKE ?${i + 1} ESCAPE '!' OR lower(name) LIKE ?${i + 1} ESCAPE '!' OR lower(coalesce(developer, '')) LIKE ?${i + 1} ESCAPE '!' OR system LIKE ?${i + 1} ESCAPE '!')`,
  );
  const patterns = words.map(word => `%${word.replace(/[!%_]/g, "!$&")}%`);
  return db()
    .query<Game, string[]>(
      `SELECT * FROM games WHERE ${clauses.join(" AND ")} ORDER BY favorite DESC, coalesce(title, name) COLLATE NOCASE LIMIT ${Math.trunc(limit)}`,
    )
    .all(...patterns);
}

export function defaultRoute(system: string): string | null {
  return (
    db().query<{ route: string }, [string]>("SELECT route FROM defaults WHERE system = ?").get(system)?.route ?? null
  );
}

export function setDefaultRoute(system: string, route: string | null): void {
  if (route) db().query("INSERT OR REPLACE INTO defaults VALUES (?, ?)").run(system, route);
  else db().query("DELETE FROM defaults WHERE system = ?").run(system);
}
