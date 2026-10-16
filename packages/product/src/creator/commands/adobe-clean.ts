import { rm } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { join } from "node:path";

import { parse } from "../../shared/args.ts";
import { clearDir, expandStar, treeStats } from "../../shared/fsutil.ts";
import { formatBytes } from "../../shared/format.ts";
import type { Command } from "./types.ts";

const HELP = `creator-kit adobe-clean <status|free|cache|all> [options]

Libère de la RAM et de l'espace disque pris par les logiciels Adobe, sans toucher à tes projets.

  status   RAM libre et mémoire utilisée par chaque processus Adobe
  free     ferme les processus d'arrière-plan Creative Cloud (jamais Photoshop, Premiere, etc.)
  cache    vide les caches régénérables (Media Cache Premiere/After Effects/Media Encoder, Camera Raw,
           fichiers "Photoshop Temp" orphelins) ; refusé si une application Adobe est ouverte
  all      free puis cache

Options :
  --apply         exécute (par défaut : simulation, rien n'est modifié)
  --older-than <j> ne supprime que les fichiers de cache plus vieux que j jours (défaut 0)
  --extra <dossier> dossier de cache supplémentaire à vider (répétable)
  --json          sortie JSON pour status
  --top <n>       status : nombre de gros consommateurs de RAM listés (défaut 8)
  -h, --help

Le cache média est reconstruit automatiquement par Adobe : la 1re ouverture d'un projet peut être plus lente.`;

/** Creative Cloud background helpers, safe to close when no Adobe app needs them. */
export const BACKGROUND = [
  "Creative Cloud",
  "Creative Cloud Helper",
  "Adobe Desktop Service",
  "CCXProcess",
  "CCLibrary",
  "AdobeIPCBroker",
  "AdobeCollabSync",
  "Adobe CEF Helper",
  "Adobe Installer",
  "AdobeUpdateService",
] as const;

/** Creative applications: holding caches, never closed by this tool. */
export const APPS = [
  "Photoshop",
  "Illustrator",
  "AfterFX",
  "Adobe Premiere Pro",
  "Adobe Media Encoder",
  "InDesign",
  "Lightroom",
  "Adobe Audition",
  "Adobe Animate",
  "Acrobat",
  "Adobe Bridge",
  "Adobe Dreamweaver",
  "Adobe Character Animator",
] as const;

export interface ProcInfo {
  name: string;
  pid: number;
  bytes: number;
}

export type ProcessLister = () => Promise<ProcInfo[]>;

export async function listProcessesNative(): Promise<ProcInfo[]> {
  if (process.platform === "win32") {
    const proc = Bun.spawn(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process | Select-Object ProcessName,Id,WorkingSet64 | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, stdout: "pipe", stderr: "ignore" },
    );
    const text = await new Response(proc.stdout).text();
    const rows = JSON.parse(text || "[]") as {
      ProcessName: string;
      Id: number;
      WorkingSet64: number;
    }[];
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      name: row.ProcessName,
      pid: row.Id,
      bytes: row.WorkingSet64,
    }));
  }
  const proc = Bun.spawn(["ps", "-eo", "pid=,rss=,comm="], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  return text
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      pid: Number(m[1]),
      bytes: Number(m[2]) * 1024,
      name: m[3] as string,
    }));
}

const norm = (name: string) => name.toLowerCase().replace(/\.exe$/, "");

export function pick(procs: ProcInfo[], names: readonly string[]): ProcInfo[] {
  const wanted = new Set(names.map(norm));
  return procs.filter((p) => wanted.has(norm(p.name)));
}

/** Adobe cache folders (all regenerable). `env` is injectable for tests. */
export function cacheLocations(
  env: Record<string, string | undefined>,
): { label: string; pattern: string }[] {
  const appData = env.APPDATA;
  const temp = env.TEMP ?? env.TMP;
  const out: { label: string; pattern: string }[] = [];
  if (appData) {
    out.push(
      {
        label: "Premiere / AE / Media Encoder : Media Cache Files",
        pattern: join(appData, "Adobe", "Common", "Media Cache Files"),
      },
      {
        label: "Premiere / AE / Media Encoder : Media Cache (base de données)",
        pattern: join(appData, "Adobe", "Common", "Media Cache"),
      },
      {
        label: "Premiere : Peak Files",
        pattern: join(appData, "Adobe", "Common", "Peak Files"),
      },
      {
        label: "Camera Raw : cache",
        pattern: join(appData, "Adobe", "CameraRaw", "Cache"),
      },
    );
  }
  if (temp)
    out.push({
      label: "Photoshop Temp orphelins (dossier temporaire)",
      pattern: join(temp, "Photoshop Temp*"),
    });
  const systemDrive = env.SystemDrive;
  if (systemDrive)
    out.push({
      label: "Photoshop Temp orphelins (racine du disque)",
      pattern: join(`${systemDrive}\\`, "Photoshop Temp*"),
    });
  return out;
}

export interface Io {
  list: ProcessLister;
  kill: (names: string[], force: boolean) => Promise<void>;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

const nativeIo = (): Io => ({
  list: listProcessesNative,
  async kill(names, force) {
    await Promise.all(
      names.map((name) => {
        const cmd =
          process.platform === "win32"
            ? ["taskkill", "/IM", `${name}.exe`, ...(force ? ["/F"] : [])]
            : ["pkill", "-x", name];
        return Bun.spawn(cmd, {
          windowsHide: true,
          stdout: "ignore",
          stderr: "ignore",
        }).exited;
      }),
    );
  },
  env: process.env,
  log: (line) => console.log(line),
});

/** Per-name memory total (Chrome and Electron apps spawn dozens of processes). */
export function topConsumers(
  procs: ProcInfo[],
  count: number,
): { name: string; bytes: number; count: number }[] {
  const byName = new Map<
    string,
    { name: string; bytes: number; count: number }
  >();
  for (const p of procs) {
    const key = norm(p.name);
    const entry = byName.get(key) ?? {
      name: p.name.replace(/\.exe$/i, ""),
      bytes: 0,
      count: 0,
    };
    entry.bytes += p.bytes;
    entry.count += 1;
    byName.set(key, entry);
  }
  return [...byName.values()]
    .toSorted((a, b) => b.bytes - a.bytes)
    .slice(0, count);
}

export async function status(io: Io, json = false, top = 8): Promise<number> {
  const procs = await io.list();
  const adobe = pick(procs, [...BACKGROUND, ...APPS]).toSorted(
    (a, b) => b.bytes - a.bytes,
  );
  const total = totalmem();
  const freeBytes = freemem();
  if (json) {
    io.log(JSON.stringify({ totalBytes: total, freeBytes, adobe }, null, 2));
    return 0;
  }
  io.log(`RAM : ${formatBytes(freeBytes)} libres sur ${formatBytes(total)}`);
  const sum = adobe.reduce((s, p) => s + p.bytes, 0);
  io.log(`Processus Adobe : ${adobe.length} (${formatBytes(sum)})`);
  for (const p of adobe)
    io.log(
      `  ${p.name.padEnd(28)} ${String(p.pid).padStart(7)}  ${formatBytes(p.bytes)}`,
    );
  io.log(
    `\nPlus gros consommateurs de RAM (tous programmes, regroupés par nom) :`,
  );
  for (const t of topConsumers(procs, top))
    io.log(
      `  ${t.name.padEnd(28)} ${String(t.count).padStart(3)} proc.  ${formatBytes(t.bytes)}`,
    );
  return 0;
}

export async function free(io: Io, apply: boolean): Promise<number> {
  const procs = await io.list();
  if (pick(procs, APPS).length > 0) {
    io.log(
      "Applications Adobe ouvertes : les services d'arrière-plan sont gardés (elles en dépendent).",
    );
    return 0;
  }
  const targets = pick(procs, BACKGROUND);
  const bytes = targets.reduce((s, p) => s + p.bytes, 0);
  io.log(
    `${targets.length} processus d'arrière-plan Creative Cloud, ${formatBytes(bytes)} récupérables`,
  );
  for (const p of targets) io.log(`  ${p.name} (${formatBytes(p.bytes)})`);
  if (apply && targets.length > 0) {
    await io.kill(
      [...new Set(targets.map((p) => p.name.replace(/\.exe$/i, "")))],
      true,
    );
    io.log(
      "Fermés. Creative Cloud se relance à la prochaine ouverture d'une application Adobe.",
    );
  } else if (targets.length > 0) {
    io.log("Simulation : relance avec --apply pour les fermer.");
  }
  return 0;
}

export async function cache(
  io: Io,
  apply: boolean,
  olderThanDays: number,
  extra: string[],
): Promise<number> {
  const running = pick(await io.list(), APPS);
  if (running.length > 0) {
    io.log(
      `Ferme d'abord : ${[...new Set(running.map((p) => p.name))].join(", ")} (cache en cours d'utilisation).`,
    );
    return apply ? 1 : 0;
  }
  const olderThanMs = olderThanDays * 86_400_000;
  const locations = [
    ...cacheLocations(io.env),
    ...extra.map((p) => ({ label: `extra : ${p}`, pattern: p })),
  ];
  let total = 0;
  for (const location of locations) {
    // oxlint-disable-next-line no-await-in-loop -- parcours séquentiel des emplacements : l'ordre des lignes de journal et le total cumulé doivent rester déterministes
    for (const path of await expandStar(location.pattern)) {
      const isTempPattern = location.pattern.includes("Photoshop Temp");
      // oxlint-disable-next-line no-await-in-loop -- mesure/suppression séquentielle d'un dossier avant le suivant (journal ordonné, pas de concurrence sur le cache)
      const stats = await (isTempPattern
        ? treeStats(path)
        : clearDir(path, apply, olderThanMs));
      if (isTempPattern && apply) {
        // oxlint-disable-next-line no-await-in-loop -- suppression séquentielle du dossier temporaire Photoshop, après sa mesure
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
      }
      if (stats.bytes === 0) continue;
      total += stats.bytes;
      io.log(
        `  ${formatBytes(stats.bytes).padStart(9)}  ${location.label}  (${path})`,
      );
    }
  }
  io.log(
    `${apply ? "Libéré" : "Récupérable"} : ${formatBytes(total)}${apply ? "" : "  (simulation, --apply pour exécuter)"}`,
  );
  return 0;
}

export async function run(
  argv: string[],
  io: Io = nativeIo(),
): Promise<number> {
  const { values, positionals } = parse(argv, {
    apply: { type: "boolean" },
    "older-than": { type: "string" },
    extra: { type: "string", multiple: true },
    json: { type: "boolean" },
    top: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  const action = positionals[0] ?? "status";
  if (values.help) {
    io.log(HELP);
    return 0;
  }
  const apply = values.apply === true;
  const days = Number(values["older-than"] ?? 0);
  switch (action) {
    case "status":
      return status(io, values.json === true, Number(values.top ?? 8));
    case "free":
      return free(io, apply);
    case "cache":
      return cache(io, apply, days, values.extra ?? []);
    case "all":
      await free(io, apply);
      return cache(io, apply, days, values.extra ?? []);
    default:
      io.log(HELP);
      return 2;
  }
}

const command: Command = {
  name: "adobe-clean",
  summary: "Libérer la RAM et les caches des logiciels Adobe",
  run: (argv) => run(argv),
};

export default command;
