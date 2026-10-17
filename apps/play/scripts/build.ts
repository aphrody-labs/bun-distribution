#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the play.aphrody.app release on this workstation (no build runs on the VPS):
 *
 *   dist/server.js                       Bun server bundle (target bun, bun:nginx external)
 *   dist/public/                         client (Bun.build HTML entry + M3 plugin), hashed /assets/
 *   dist/public/stream-client/index.html the unchanged packages/bun-gamestream client
 *   dist/public/catalog.json, roms/      public catalog: Bun Engine systems + free ROM packs only
 *   dist/public/emulation/               dist/web-emulation/<core>/ when published, else a stub
 *   dist/nginx/engine.conf               bun:nginx engine template (infra/config/host/nginx/play)
 *   dist/packages/bun-engine/plugins/    data files the bundled Bun Engine frontend reads
 *
 * Usage: bun apps/play/scripts/build.ts
 */
import type { BunPlugin } from "bun";
import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { m3Plugin } from "@aphrody/m3/plugin";

const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "..", "..");
const dist = join(app, "dist");
const publicDir = join(dist, "public");
const naming = {
  chunk: "assets/[name]-[hash].[ext]",
  asset: "assets/[name]-[hash].[ext]",
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

function check(
  result: Awaited<ReturnType<typeof Bun.build>>,
  what: string,
): void {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`${what} build failed`);
  }
}

// ---------------------------------------------------------------- client
const theme = m3Plugin({ theme: { seed: "#6750a4", variant: "tonalSpot" } });
check(
  await Bun.build({
    entrypoints: [join(app, "src", "client", "index.html")],
    outdir: publicDir,
    naming: { entry: "[name].[ext]", ...naming },
    publicPath: "/",
    target: "browser",
    minify: true,
    sourcemap: "none",
    plugins: [theme],
  }),
  "client",
);
check(
  await Bun.build({
    entrypoints: [
      join(repo, "packages", "bun-gamestream", "src", "client", "index.html"),
    ],
    outdir: publicDir,
    naming: { entry: "stream-client/[name].[ext]", ...naming },
    publicPath: "/",
    target: "browser",
    minify: true,
  }),
  "gamestream client",
);

// ---------------------------------------------------------------- catalog (free packs only)
interface SystemDefinition {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  native?: { machine: string };
}
const consoles = join(repo, "packages", "bun-engine", "plugins", "consoles");
const { systems } = JSON.parse(
  readFileSync(join(consoles, "systems.json"), "utf8"),
) as { systems: SystemDefinition[] };
const { packs } = JSON.parse(
  readFileSync(join(consoles, "roms.json"), "utf8"),
) as { packs: { id: string; license: string }[] };
const licenses = new Map(packs.map((pack) => [pack.id, pack.license]));
const libraryDb = join(repo, "usr", "var", "lib", "bep", "library.db");
const rows = existsSync(libraryDb)
  ? (new Database(libraryDb, { readonly: true })
      .query(
        "SELECT system, path, name, title, size, md5, source, description FROM games WHERE source LIKE 'free:%' AND md5 IS NOT NULL ORDER BY system, COALESCE(title, name)",
      )
      .all() as {
      system: string;
      path: string;
      name: string;
      title: string | null;
      size: number;
      md5: string;
      source: string;
      description: string | null;
    }[])
  : [];
mkdirSync(join(publicDir, "roms"), { recursive: true });
const games = [];
for (const row of rows) {
  if (!existsSync(row.path)) continue;
  const rom = `/roms/${row.md5}${extname(row.path).toLowerCase()}`;
  cpSync(row.path, join(publicDir, rom));
  const pack = row.source.slice("free:".length);
  games.push({
    id: row.md5,
    system: row.system,
    title:
      (row.title ?? row.name)
        .replace(/\s*\((World|USA|Europe|Japan)[^)]*\)\s*\(.*?\)$/, "")
        .trim() || row.name,
    size: row.size,
    rom,
    source: pack,
    license: licenses.get(pack) ?? "Freely redistributable",
    description: row.description?.slice(0, 400) ?? null,
  });
}
const counts = new Map<string, number>();
for (const game of games)
  counts.set(game.system, (counts.get(game.system) ?? 0) + 1);
await Bun.write(
  join(publicDir, "catalog.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    systems: systems.map((system) => ({
      id: system.id,
      name: system.name,
      manufacturer: system.manufacturer,
      year: system.year,
      native: system.native?.machine ?? null,
      games: counts.get(system.id) ?? 0,
    })),
    games,
  }),
);

// ---------------------------------------------------------------- web emulation cores
const emulation = join(repo, "dist", "web-emulation");
if (existsSync(emulation))
  cpSync(emulation, join(publicDir, "emulation"), { recursive: true });
else
  await Bun.write(
    join(publicDir, "emulation", "bun-engine", "manifest.json"),
    `${JSON.stringify(
      {
        id: "bun-engine",
        name: "Bun Engine (wgpu 30, WebGPU)",
        stub: true,
        note: "Placeholder until the web emulation owner publishes dist/web-emulation/<core>/.",
        systems: ["nes", "gba", "nds", "psx"],
        extensions: ["nes", "gba", "nds", "cue", "bin"],
        module: "bun_engine_web.js",
        wasm: "bun_engine_web_bg.wasm",
        start: "start",
        threads: false,
        renderer: "webgpu",
      },
      null,
      2,
    )}\n`,
  );

// ---------------------------------------------------------------- server
/** The bundled Bun Engine modules resolve their data next to their own source: PLAY_ROOT mirrors it. */
const releasePaths: BunPlugin = {
  name: "play-release-paths",
  setup(build) {
    build.onLoad(
      { filter: /[\\/]packages[\\/]bun-engine[\\/]src[\\/].*\.ts$/ },
      async (args) => {
        const dir = relative(repo, dirname(args.path)).replaceAll("\\", "/");
        const file = `${dir}/${basename(args.path)}`;
        const contents = (await Bun.file(args.path).text())
          .replaceAll(
            "import.meta.dir",
            `(process.env.PLAY_ROOT + ${JSON.stringify(`/${dir}`)})`,
          )
          .replaceAll(
            "import.meta.url",
            `Bun.pathToFileURL(process.env.PLAY_ROOT + ${JSON.stringify(`/${file}`)}).href`,
          );
        return { contents, loader: "ts" };
      },
    );
  },
};
check(
  await Bun.build({
    entrypoints: [join(app, "src", "server", "main.ts")],
    outdir: dist,
    naming: "server.js",
    target: "bun",
    minify: { syntax: true, whitespace: true },
    external: ["bun:nginx"],
    plugins: [releasePaths],
  }),
  "server",
);
cpSync(consoles, join(dist, "packages", "bun-engine", "plugins", "consoles"), {
  recursive: true,
});
mkdirSync(join(dist, "nginx"), { recursive: true });
cpSync(
  join(repo, "infra", "config", "host", "nginx", "play", "engine.conf"),
  join(dist, "nginx", "engine.conf"),
);

const size = (path: string) => Bun.file(path).size;
console.log(
  JSON.stringify(
    {
      dist,
      server: size(join(dist, "server.js")),
      games: games.length,
      systems: systems.length,
      emulation: existsSync(emulation) ? "dist/web-emulation" : "stub",
    },
    null,
    2,
  ),
);
