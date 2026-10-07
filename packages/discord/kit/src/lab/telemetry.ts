// SPDX-License-Identifier: Apache-2.0
import { loadCredentials, makeApi, saveState, type LabState } from "./ai-lab.ts";
import type { NetworkSnapshot } from "./network.ts";

export interface ServiceSnapshot {
  host: "vps" | "dbfr";
  services: Record<string, string>;
}
const services = {
  vps: [
    "aphrody-discord-dev.service",
    "aphrody-discord-ai-lab.service",
    "aphrody-llama-gemma4.service",
    "aphrody-llama-shenron-chat.service",
  ],
  dbfr: ["shenron-bot-docker.service", "shenron-compute.service", "shenron-embed.service"],
};
export async function snapshot(host: ServiceSnapshot["host"]): Promise<ServiceSnapshot> {
  const command = ["systemctl", "is-active", ...services[host]];
  const argv =
    host === "vps"
      ? command
      : [
          "/home/ubuntu/.local/bin/aphrody",
          "infra",
          "ssh",
          "exec",
          "--host",
          "dbfr",
          "--cmd",
          command.join(" "),
        ];
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 25_000);
  try {
    const [output, , code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const statuses = output.trim().split(/\s+/);
    if (
      (code !== 0 && host === "dbfr") ||
      statuses.length !== services[host].length ||
      statuses.some(
        (status) => !/^(active|inactive|failed|activating|deactivating|unknown)$/.test(status),
      )
    ) {
      return {
        host,
        services: Object.fromEntries(services[host].map((name) => [name, "unreachable"])),
      };
    }
    return {
      host,
      services: Object.fromEntries(services[host].map((name, index) => [name, statuses[index]!])),
    };
  } finally {
    clearTimeout(deadline);
  }
}
export function renderTelemetry(snapshots: ServiceSnapshot[], network?: NetworkSnapshot): string {
  return (
    "**Laboratoire IA — état des services**\n" +
    snapshots
      .map(
        ({ host, services: state }) =>
          `**${host}**\n${Object.entries(state)
            .map(([name, status]) => `• ${name}: ${status}`)
            .join("\n")}`,
      )
      .join("\n") +
    (network
      ? `\n**WireGuard ${network.interface}**\n${network.peers.map((peer) => `• ${peer.id}: ${peer.state}`).join("\n")}`
      : "")
  );
}
const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (import.meta.main) {
  for (const name of ["--env-file", "--state", "--receipt"])
    if (!process.argv.includes(name)) throw new Error(`Missing ${name}`);
  const env = await loadCredentials(flag("--env-file")!);
  const state = (await Bun.file(flag("--state")!).json()) as LabState;
  if (env.DISCORD_GUILD_ID !== state.guildId || !env.DISCORD_BOT_TOKEN)
    throw new Error("Lab identity mismatch");
  const current = await Promise.all([snapshot("vps"), snapshot("dbfr")]);
  const network = process.argv.includes("--network")
    ? ((await Bun.file(flag("--network")!).json()) as NetworkSnapshot)
    : undefined;
  const receiptPath = flag("--receipt")!;
  const previous = (await Bun.file(receiptPath).exists())
    ? ((await Bun.file(receiptPath).json()) as { fingerprint: string; postedAt: number })
    : undefined;
  const fingerprint = JSON.stringify({
    services: current,
    network: network?.peers.map(({ id, state: peerState }) => ({ id, state: peerState })),
  });
  if (previous?.fingerprint === fingerprint && Date.now() - previous.postedAt < 600_000)
    process.exit(0);
  const api = makeApi(env.DISCORD_BOT_TOKEN);
  const self = await api<{ id: string }>("/users/@me");
  if (self.id !== state.botId) throw new Error("Bot identity mismatch");
  const posted = await api<{ id: string }>(
    `/channels/${state.channels["lab-status"]}/messages`,
    "POST",
    { content: renderTelemetry(current, network), allowed_mentions: { parse: [] } },
  );
  await saveState(receiptPath, { fingerprint, postedAt: Date.now(), messageId: posted.id });
  console.log(JSON.stringify({ posted: true, messageId: posted.id, snapshots: current, network }));
}
