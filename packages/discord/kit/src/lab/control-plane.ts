// SPDX-License-Identifier: Apache-2.0
import { stat } from "node:fs/promises";
import { loadCredentials, makeApi, saveState } from "./ai-lab.ts";
import type { NetworkSnapshot } from "./network.ts";

interface Declaration {
  guildId: string;
  channels: { drive: string; chat: string; network: string };
  drive: {
    folderId: string;
    reportPath: string;
    agentReportPath: string;
    automationReportPath?: string;
    ragReportPath?: string;
  };
  sync?: { cloudAutomationReportPath?: string };
  wireguard: { interface: string; reportPath: string; peers: { id: string }[] };
}
export interface NetworkPeer {
  id: string;
  status: "connected" | "stale" | "never" | "unknown";
}
export function networkPeers(
  snapshot: NetworkSnapshot | undefined,
  declaration: Declaration["wireguard"],
  ageSeconds: number,
): NetworkPeer[] {
  const fresh =
    Number.isFinite(ageSeconds) &&
    ageSeconds >= 0 &&
    ageSeconds <= 300 &&
    snapshot?.interface === declaration.interface;
  return declaration.peers.map(({ id }) => {
    const state = fresh ? snapshot?.peers.find((peer) => peer.id === id)?.state : undefined;
    return {
      id,
      status:
        state === "recent"
          ? "connected"
          : state === "stale"
            ? "stale"
            : state === "never"
              ? "never"
              : "unknown",
    };
  });
}

async function readNetwork(declaration: Declaration["wireguard"]) {
  try {
    const [snapshot, info] = await Promise.all([
      Bun.file(declaration.reportPath).json(),
      stat(declaration.reportPath),
    ]);
    return networkPeers(snapshot, declaration, (Date.now() - info.mtimeMs) / 1000);
  } catch {
    return networkPeers(undefined, declaration, NaN);
  }
}

export function publicSyncReport(report: Record<string, unknown>) {
  const numeric = [
    "unchanged",
    "localAhead",
    "staged",
    "unsupported",
    "uploaded",
    "records_ingested",
    "sources_scanned",
    "sources_updated",
    "running",
    "completed",
    "failed",
    "source_count",
    "indexed",
    "progress_current",
    "progress_total",
  ];
  return Object.fromEntries(
    numeric.flatMap((key) =>
      typeof report[key] === "number" &&
      Number.isSafeInteger(report[key]) &&
      Number(report[key]) >= 0
        ? [[key, report[key]]]
        : [],
    ),
  );
}

export function renderRag(report: Record<string, unknown>) {
  if (!report.available) return "état indisponible";
  if (!report.fresh) return "suivi périmé";
  if (report.running === 1) {
    const current = report.progress_current,
      total = report.progress_total;
    return Number.isSafeInteger(current) &&
      Number.isSafeInteger(total) &&
      Number(total) > 0 &&
      Number(current) <= Number(total)
      ? `en cours : ${Number(current).toLocaleString("fr-FR")} / ${Number(total).toLocaleString("fr-FR")} éléments sur la source active ; rapport final attendu`
      : "en cours ; rapport final attendu";
  }
  if (report.failed === 1) return "échec du dernier traitement";
  if (report.completed === 1)
    return `terminé : ${report.indexed} éléments indexés, ${report.source_count} sources`;
  return "rapport final actuel non vérifié";
}

async function readReport(path: string) {
  if (!(await Bun.file(path).exists())) return { available: false };
  const receipt = (await Bun.file(path).json()) as {
    observedAt?: string;
    report?: Record<string, unknown>;
  };
  const age = receipt.observedAt ? Date.now() - Date.parse(receipt.observedAt) : NaN;
  return {
    available: true,
    fresh: Number.isFinite(age) && age >= 0 && age < 600_000,
    observedAt: receipt.observedAt,
    ...publicSyncReport(receipt.report ?? {}),
  };
}
export function publicAutomation(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) =>
        /^(drive|agents|drive-retrieval|drive-replica|rag-monitor|home-aphrody|home-dbfr)$/.test(
          name,
        ),
      )
      .flatMap(([name, job]) => {
        if (!job || typeof job !== "object" || !("ok" in job) || typeof job.ok !== "boolean")
          return [];
        return [[name, job.ok ? "ok" : "retrying"]];
      }),
  );
}
export async function readAutomation(path?: string) {
  try {
    if (!path || !(await Bun.file(path).exists())) return { available: false };
    const receipt = (await Bun.file(path).json()) as {
      observedAt?: string;
      jobs?: Record<string, unknown>;
    };
    const age = Date.now() - Date.parse(receipt.observedAt ?? "");
    return {
      available: true,
      fresh: Number.isFinite(age) && age >= 0 && age <= 180_000,
      jobs: publicAutomation(receipt.jobs ?? {}),
    };
  } catch {
    return { available: false };
  }
}

export function renderAutomation(report: Awaited<ReturnType<typeof readAutomation>>) {
  if (!report.available) return "état indisponible";
  if (!report.fresh) return "suivi périmé";
  const jobs = Object.entries(report.jobs ?? {});
  if (!jobs.length) return "rapport récent sans état vérifié";
  return jobs
    .map(([name, status]) =>
      status === "ok" ? `${name} : ok` : `${name} : échec ; nouvelle tentative attendue`,
    )
    .join(" | ");
}
async function run(argv: string[]): Promise<string> {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
  const deadline = setTimeout(() => child.kill(), 25_000);
  try {
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error("Capability probe failed");
    return output;
  } finally {
    clearTimeout(deadline);
  }
}

const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  if (at < 0 || !process.argv[at + 1]) throw new Error(`Missing ${name}`);
  return process.argv[at + 1]!;
};

if (import.meta.main) {
  const declaration = (await Bun.file(flag("--declaration")).json()) as Declaration;
  if (!/^wg\d+$/.test(declaration.wireguard.interface))
    throw new Error("Invalid WireGuard interface");
  const env = await loadCredentials(flag("--env-file"));
  if (env.DISCORD_GUILD_ID !== declaration.guildId || !env.DISCORD_BOT_TOKEN)
    throw new Error("Guild credential mismatch");
  const [peers, drive, agents, automation, cloudAutomation, rag] = await Promise.all([
    readNetwork(declaration.wireguard),
    readReport(declaration.drive.reportPath),
    readReport(declaration.drive.agentReportPath),
    readAutomation(declaration.drive.automationReportPath),
    readAutomation(declaration.sync?.cloudAutomationReportPath),
    declaration.drive.ragReportPath
      ? readReport(declaration.drive.ragReportPath)
      : Promise.resolve({ available: false }),
  ]);
  const dbfr = await run([
    "/home/ubuntu/.local/bin/aphrody",
    "infra",
    "ssh",
    "exec",
    "--host",
    "dbfr",
    "--cmd",
    "test -d /home/ubuntu/.aphrody/workspaces/dbfr && test -d /srv/shenron/shared/agent-home && printf homes-present",
  ])
    .then((output) => (output.trim() === "homes-present" ? "homes-present" : "unverified"))
    .catch(() => "unreachable");
  const summary = { peers, drive, agents, automation, cloudAutomation, rag, dbfr };
  const fingerprint = JSON.stringify(summary);
  const receiptPath = flag("--receipt");
  const previous = (await Bun.file(receiptPath).exists())
    ? ((await Bun.file(receiptPath).json()) as { fingerprint?: string; postedAt?: number })
    : {};
  if (previous.fingerprint === fingerprint && Date.now() - (previous.postedAt ?? 0) < 600_000)
    process.exit(0);
  console.log(JSON.stringify({ planned: !process.argv.includes("--apply"), ...summary }));
  if (!process.argv.includes("--apply")) process.exit(0);
  const api = makeApi(env.DISCORD_BOT_TOKEN);
  // Verify every destination before publishing any report.
  const destinations = await Promise.all(
    [declaration.channels.drive, declaration.channels.network].map((id) =>
      api<{ guild_id: string; type: number }>(`/channels/${id}`),
    ),
  );
  for (const channel of destinations) {
    if (channel.guild_id !== declaration.guildId || channel.type !== 0)
      throw new Error("Report destination mismatch");
  }
  const reports = [
    [
      declaration.channels.drive,
      `**Synchronisation DBFR**\nDossier : https://drive.google.com/drive/folders/${declaration.drive.folderId}\nAutomatisation : ${JSON.stringify(automation)}\nDrive VPS : ${renderAutomation(cloudAutomation)}\nDrive : ${JSON.stringify(drive)}\nSessions des agents : ${JSON.stringify(agents)}\nRAG : ${renderRag(rag)}.\nAgent homes SSH DBFR/Shenron : ${dbfr}.\nUne mise à jour staged ou un miroir de session ne prouve pas une synchronisation complète ni une connexion A2A.`,
    ],
    [
      declaration.channels.network,
      `**WireGuard — connexions vérifiées**\n${peers.map((peer) => `• ${peer.id}: ${peer.status}`).join("\n")}\nLes clés privées restent sur leurs appareils. Le hub A2A et les endpoints des PC doivent être qualifiés séparément.`,
    ],
  ];
  for (const [channelId, content] of reports) {
    // Sequential writes keep Discord publication ordering deterministic.
    // eslint-disable-next-line no-await-in-loop
    await api(`/channels/${channelId}/messages`, "POST", {
      content,
      allowed_mentions: { parse: [] },
    });
  }
  await saveState(receiptPath, { fingerprint, postedAt: Date.now() });
}
