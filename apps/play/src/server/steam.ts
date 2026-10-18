// SPDX-License-Identifier: Apache-2.0
/**
 * Steam surface of play.aphrody.app, built from @aphrody/bun-steam exports and content_log.
 * Explicit launches use the existing client; sessions and configuration remain in their stores.
 */
import {
  type AuditReport,
  installedGames,
  isSteamRunning,
  listCompatTools,
  listLibraries,
  remotePlayState,
  openSteamUri,
  rungameidUri,
  resolveSteamRoot,
  runAudit,
} from "@aphrody/bun-steam";
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { libraryCacheFile } from "./art";
import { config } from "./config";
import { installedSteamGame, steamAppId } from "../steam-target";

/** Request a launch through the existing client; acceptance does not prove game readiness. */
export async function launchSteamGame(value: string): Promise<Response> {
  const appId = steamAppId(value);
  if (appId === null)
    return Response.json({ error: "invalid Steam app id" }, { status: 400 });
  const root = steamRoot();
  if (!root)
    return Response.json({ error: "Steam unavailable" }, { status: 503 });
  const game = installedSteamGame(installedGames(root), appId);
  if (!game)
    return Response.json(
      { error: "game is not fully installed" },
      { status: 404 },
    );
  if (!isSteamRunning())
    return Response.json(
      { error: "Steam client is not running" },
      { status: 409 },
    );
  const result = await openSteamUri(rungameidUri(appId));
  return Response.json(
    { appId, name: game.name, requested: result.exitCode === 0 },
    {
      status: result.exitCode === 0 ? 202 : 502,
      headers: { "cache-control": "no-store" },
    },
  );
}

function steamRoot(): string | null {
  try {
    return resolveSteamRoot(config.steamRoot);
  } catch {
    return null;
  }
}

export function steamStatus() {
  const root = steamRoot();
  if (!root) return { available: false as const };
  const settle = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  return {
    available: true as const,
    root,
    libraries: settle(() => listLibraries(root), []),
    games: settle(() => installedGames(root), [])
      // Games are what the client shows in its library: they have capsule art in the library
      // cache. Runtimes and redistributables (Proton, Steam Linux Runtime, Steamworks) do not.
      .map(({ appId, name, sizeOnDisk, stateFlags, buildId }) => ({
        appId,
        name,
        sizeOnDisk,
        stateFlags,
        buildId,
        kind: libraryCacheFile(appId, "library_600x900.jpg")
          ? ("game" as const)
          : ("tool" as const),
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    compatTools: settle(() => listCompatTools(root), []).map(
      ({ internalName, displayName, kind, version }) => ({
        internalName,
        displayName,
        kind,
        version,
      }),
    ),
    remotePlay: settle(
      () => {
        const state = remotePlayState(root, 8);
        return {
          // Peer addresses stay on the host; the page shows names and outcomes.
          clients: state.clients.map(
            ({ id, hostname, lastUpdated, lastResult, apps }) => ({
              id,
              hostname,
              lastUpdated,
              lastResult,
              apps,
            }),
          ),
          connections: state.connections,
        };
      },
      { clients: [], connections: [] },
    ),
  };
}

export interface DownloadState {
  appId: number;
  name: string | null;
  state: string;
  update: string;
  updatedAt: string;
  finished: boolean;
}

export interface DownloadSnapshot {
  rateMbps: number | null;
  rateAt: string | null;
  apps: DownloadState[];
}

const LINE = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] (.*)$/;

/** Follows logs/content_log.txt incrementally (bounded reads) and folds it into per-app state. */
export class ContentLog {
  #offset = -1;
  #pending = "";
  #apps = new Map<number, DownloadState>();
  #rate: number | null = null;
  #rateAt: string | null = null;
  #names = new Map<number, string>();

  constructor(
    private readonly path = join(steamRoot() ?? "", "logs", "content_log.txt"),
  ) {}

  #fold(line: string): void {
    const match = LINE.exec(line);
    if (!match) return;
    const [, at, text] = match as unknown as [string, string, string];
    const rate = /^Current download rate: ([\d.]+) Mbps/.exec(text);
    if (rate) {
      this.#rate = Number(rate[1]);
      this.#rateAt = at;
      return;
    }
    const app =
      /^AppID (\d+) (state changed|App update changed|finished update|update started)\s*:?\s*(.*)$/.exec(
        text,
      );
    if (!app) return;
    const appId = Number(app[1]);
    const entry = this.#apps.get(appId) ?? {
      appId,
      name: this.#names.get(appId) ?? null,
      state: "",
      update: "",
      updatedAt: at,
      finished: false,
    };
    entry.updatedAt = at;
    if (app[2] === "state changed") entry.state = app[3]!.replace(/,$/, "");
    else if (app[2] === "App update changed") {
      entry.update = app[3]!.replace(/,$/, "");
      entry.finished = entry.update === "None";
    } else if (app[2] === "finished update") entry.finished = true;
    else entry.finished = false;
    this.#apps.set(appId, entry);
  }

  /** Reads what was appended since the last call (the first call reads the last 256 KiB). */
  poll(): boolean {
    let size: number;
    try {
      size = statSync(this.path).size;
    } catch {
      return false;
    }
    if (this.#offset < 0 || size < this.#offset)
      this.#offset = Math.max(0, size - 256 * 1024);
    if (size === this.#offset) return false;
    const length = Math.min(size - this.#offset, 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = openSync(this.path, "r");
    try {
      readSync(fd, buffer, 0, length, this.#offset);
    } finally {
      closeSync(fd);
    }
    this.#offset += length;
    const lines = (this.#pending + buffer.toString("utf8")).split(/\r?\n/);
    this.#pending = lines.pop() ?? "";
    for (const line of lines) this.#fold(line);
    return true;
  }

  names(games: { appId: number; name: string }[]): void {
    for (const game of games) this.#names.set(game.appId, game.name);
    for (const entry of this.#apps.values())
      entry.name ??= this.#names.get(entry.appId) ?? null;
  }

  snapshot(): DownloadSnapshot {
    return {
      rateMbps: this.#rate,
      rateAt: this.#rateAt,
      apps: [...this.#apps.values()]
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20),
    };
  }
}

let lastAudit: { at: string; report: AuditReport } | null = null;
let auditRunning: Promise<unknown> | null = null;

/** The latest `bun-steam audit` report; `run` starts one (network probes, about a minute). */
export function steamAudit(run = false) {
  if (run && !auditRunning) {
    // No disk probe: the VPS disks belong to the running downloads.
    auditRunning = runAudit({ steamRoot: steamRoot() ?? undefined, diskMiB: 0 })
      .then((report) => {
        lastAudit = { at: new Date().toISOString(), report };
      })
      .finally(() => {
        auditRunning = null;
      });
  }
  return { running: auditRunning !== null, last: lastAudit };
}

export async function lancacheAudit(): Promise<unknown> {
  const response = await fetch(config.lancacheUrl, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`lancache audit HTTP ${response.status}`);
  return response.json();
}
