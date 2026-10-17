// HTTP API of the Bun Engine frontend: library, launch routing, BIOS status and the bep installer.
// Long bep operations (installs, scans, mirror probes) run as jobs the UI polls.
import { join } from "node:path";
import { listFirmware } from "../firmware/import";
import { biosReport, libretroCatalog } from "../libretro";
import { indexMirrors, listMirrors, probeMirrors } from "../mirrors";
import * as pm from "../pm";
import { listInstalled, releaseCatalog } from "../usr";
import { launchGame, routesFor, runningGames, stopGame } from "./launch";
import {
  addFolder,
  defaultRoute,
  findGame,
  gameById,
  gamesFor,
  inProject,
  listSources,
  projectDir,
  removeSource,
  scanLibrary,
  setDefaultRoute,
  setFavorite,
  setGameRoute,
  systemCounts,
} from "./library";
import { loadSystems, systemById } from "./systems";

export interface Job {
  id: number;
  title: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
  result?: unknown;
  error?: string;
}

const jobs: Job[] = [];
let nextJob = 1;

/** Starts a background job; the newest 50 are kept for the UI. */
export function startJob(title: string, work: () => Promise<unknown>): Job {
  const job: Job = {
    id: nextJob++,
    title,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  jobs.unshift(job);
  jobs.splice(50);
  void work().then(
    (result) =>
      Object.assign(job, {
        status: "done",
        result,
        endedAt: new Date().toISOString(),
      }),
    (error) =>
      Object.assign(job, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        endedAt: new Date().toISOString(),
      }),
  );
  return job;
}

export async function systemsOverview(): Promise<unknown[]> {
  const counts = systemCounts();
  const { systems } = await loadSystems();
  return Promise.all(
    systems.map(async (system) => {
      const routes = await routesFor(system.id);
      return {
        id: system.id,
        name: system.name,
        manufacturer: system.manufacturer,
        year: system.year,
        extensions: system.extensions,
        games: counts[system.id] ?? 0,
        routes,
        defaultRoute: defaultRoute(system.id),
      };
    }),
  );
}

/** Native machine BIOS plus the libretro core BIOS report (Recalbox-style). */
export async function biosOverview(): Promise<unknown> {
  const { systems } = await loadSystems();
  const { firmware: free } = (await Bun.file(
    join(
      import.meta.dir,
      "..",
      "..",
      "plugins",
      "consoles",
      "free-firmware.json",
    ),
  ).json()) as {
    firmware: Record<
      string,
      { console: string; file: string; license: string }
    >;
  };
  const native = [];
  for (const system of systems) {
    const bios = system.native?.bios;
    if (!bios) continue;
    const images = await listFirmware(bios.console).catch(() => []);
    native.push({
      system: system.id,
      machine: system.native!.machine,
      console: bios.console,
      required: bios.required,
      freeFirmware: bios.freeFirmware,
      license: free[bios.freeFirmware]?.license,
      images: images.map((image) => ({
        sha256: image.sha256,
        bytes: image.bytes,
        file: image.file,
      })),
      status: images.length
        ? "present"
        : bios.required
          ? "missing"
          : "optional",
    });
  }
  const installedCores = new Set(
    (
      await Array.fromAsync(
        new Bun.Glob("*_libretro.*").scan({
          cwd: join(pm.cacheDirectories().usr, "lib", "libretro"),
        }),
      )
    ).map((file) => file.replace(/_libretro\..+$/, "")),
  );
  const wanted = new Set(systems.flatMap((system) => system.libretro));
  const ids = [...wanted].filter((id) => installedCores.has(id));
  const libretro = ids.length ? await biosReport(ids) : [];
  return {
    native,
    libretro,
    freeFirmware: Object.entries(free).map(([id, entry]) => ({ id, ...entry })),
    store: await listFirmware().catch(() => []),
  };
}

export async function installerOverview(): Promise<unknown> {
  const [releases, installed, cores, { systems }] = await Promise.all([
    releaseCatalog(),
    listInstalled(),
    libretroCatalog(),
    loadSystems(),
  ]);
  const byId = new Map(installed.map((row) => [row.id, row]));
  const usedBy = (predicate: (system: (typeof systems)[number]) => boolean) =>
    systems.filter(predicate).map((system) => system.id);
  const libretroDir = join(pm.cacheDirectories().usr, "lib", "libretro");
  const wanted = [
    ...new Set(systems.flatMap((system) => system.libretro)),
  ].sort();
  const mirrors = listMirrors();
  const services = new Map<
    string,
    {
      service: string;
      endpoints: number;
      healthy: number;
      best?: string;
      latencyMs?: number | null;
    }
  >();
  for (const row of mirrors) {
    const entry = services.get(row.service) ?? {
      service: row.service,
      endpoints: 0,
      healthy: 0,
    };
    entry.endpoints++;
    if (row.ok) {
      entry.healthy++;
      if (entry.latencyMs == null || (row.latencyMs ?? 1e9) < entry.latencyMs)
        Object.assign(entry, { best: row.url, latencyMs: row.latencyMs });
    }
    services.set(row.service, entry);
  }
  return {
    project: projectDir(),
    binaries: Object.entries(releases).map(([id, pkg]) => ({
      id,
      console: pkg.console,
      repo: pkg.repo,
      systems: usedBy(
        (system) =>
          system.binaries.includes(id) ||
          (id === "retroarch" && system.libretro.length > 0),
      ),
      installed: byId.get(id) ?? null,
    })),
    libretro: wanted.map((id) => {
      const core = cores.find((item) => item.id === id);
      return {
        id,
        name: core?.name ?? id,
        system: core?.system ?? "",
        license: core?.license ?? "",
        systems: usedBy((system) => system.libretro.includes(id)),
        installed: ["dll", "so", "dylib"].some(
          (ext) =>
            Bun.file(join(libretroDir, `${id}_libretro.${ext}`)).size > 0,
        ),
      };
    }),
    mirrors: [...services.values()],
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function body<T>(request: Request): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}

function guard(
  handler: (
    request: Bun.BunRequest,
    server: Bun.Server<undefined>,
  ) => Promise<Response> | Response,
) {
  return async (request: Bun.BunRequest, server: Bun.Server<undefined>) => {
    try {
      return await handler(request, server);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  };
}

/** Bun.serve routes of the frontend API. */
export function frontendRoutes() {
  return {
    "/api/systems": { GET: guard(async () => json(await systemsOverview())) },
    "/api/systems/:id/games": {
      GET: guard((request) =>
        json(gamesFor((request.params as { id: string }).id)),
      ),
    },
    "/api/systems/:id/routes": {
      GET: guard(async (request) =>
        json(await routesFor((request.params as { id: string }).id)),
      ),
    },
    "/api/systems/:id/default": {
      PUT: guard(async (request) => {
        const { id } = request.params as { id: string };
        await systemById(id);
        const { route } = await body<{ route: string | null }>(request);
        setDefaultRoute(id, route);
        return json({ system: id, route });
      }),
    },
    "/api/games/:id": {
      GET: guard(async (request) => {
        const game = gameById(Number((request.params as { id: string }).id));
        return json({
          ...game,
          routes: await routesFor(game.system),
          defaultRoute: defaultRoute(game.system),
        });
      }),
    },
    "/api/games/:id/launch": {
      POST: guard(async (request, server) => {
        server.timeout(request, 0);
        const game = await findGame((request.params as { id: string }).id);
        const options = await body<{
          route?: string;
          check?: boolean;
          frames?: number;
        }>(request);
        return json(await launchGame(game, options));
      }),
    },
    "/api/games/:id/favorite": {
      POST: guard(async (request) => {
        const { id } = request.params as { id: string };
        const { favorite } = await body<{ favorite: boolean }>(request);
        setFavorite(Number(id), favorite);
        return json({ id: Number(id), favorite });
      }),
    },
    "/api/games/:id/route": {
      PUT: guard(async (request) => {
        const { id } = request.params as { id: string };
        const { route } = await body<{ route: string | null }>(request);
        setGameRoute(Number(id), route);
        return json({ id: Number(id), route });
      }),
    },
    "/api/running": { GET: () => json(runningGames()) },
    "/api/running/:pid": {
      DELETE: (request: Bun.BunRequest) =>
        json({
          stopped: stopGame(Number((request.params as { pid: string }).pid)),
        }),
    },
    "/api/library/scan": {
      POST: () => json(startJob("Scan library", scanLibrary)),
    },
    "/api/library/sources": {
      GET: () => json(listSources()),
      POST: guard(async (request) => {
        const { path, system } = await body<{ path: string; system?: string }>(
          request,
        );
        return json(await addFolder(path, system || undefined));
      }),
    },
    "/api/library/sources/:id": {
      DELETE: guard((request) => {
        removeSource(Number((request.params as { id: string }).id));
        return json({ removed: true });
      }),
    },
    "/api/bios": { GET: guard(async () => json(await biosOverview())) },
    "/api/installer": {
      GET: guard(async () => json(await installerOverview())),
    },
    "/api/installer/:action": {
      POST: guard(async (request) => {
        const { action } = request.params as { action: string };
        const { id, service } = await body<{ id?: string; service?: string }>(
          request,
        );
        const ids = id ? id.split(/[\s,]+/).filter(Boolean) : [];
        const work: Record<string, [string, () => Promise<unknown>]> = {
          bin: [
            `bep add bin ${id}`,
            () =>
              inProject(() => pm.add(["bin", ...ids]).then(() => pm.list())),
          ],
          libretro: [
            `bep add libretro ${id}`,
            () =>
              inProject(() =>
                pm.add(["libretro", ...ids]).then(() => pm.list()),
              ),
          ],
          "free-firmware": [
            `bep add free-firmware ${id}`,
            () =>
              inProject(() =>
                pm.add(["free-firmware", ...ids]).then(() => pm.list()),
              ),
          ],
          remove: [
            `bep remove ${id}`,
            () => inProject(() => pm.remove(ids).then(() => pm.list())),
          ],
          update: [
            `bep update ${id ?? ""}`.trim(),
            () => inProject(() => pm.update(ids)),
          ],
          install: ["bep install", () => inProject(() => pm.install())],
          "mirrors-index": ["bep mirrors index", indexMirrors],
          "mirrors-probe": [
            `bep mirrors probe ${service ?? ""}`.trim(),
            async () =>
              (await probeMirrors(service)).filter((row) => row.ok).length,
          ],
        };
        const entry = work[action];
        if (!entry) throw new Error(`unknown installer action ${action}`);
        if (
          ["bin", "libretro", "free-firmware", "remove"].includes(action) &&
          !ids.length
        )
          throw new Error(`${action} needs an id`);
        return json(startJob(...entry));
      }),
    },
    "/api/jobs": { GET: () => json(jobs) },
  };
}
