// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop */
import { resolve, dirname } from "node:path";
import { chmod, mkdir, stat } from "node:fs/promises";
import {
  loadCredentials,
  makeApi,
  saveState,
  unique,
  type LabApi,
  type Channel,
} from "../../../../packages/discord/kit/src/lab/ai-lab.ts";
import type { LabMessage } from "../../../../packages/discord/kit/src/lab/assistant.ts";
import {
  approvedRollouts,
  handleMessage,
  maybeInitiate,
  normalizeSources,
  type Backend,
  type DebatePolicy,
  type DebateState,
} from "./debate.ts";

export async function run(args: string[]): Promise<string> {
  const child = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "65" },
  });
  const timeout = setTimeout(() => child.kill(), 75_000);
  try {
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0 || text.length > 2 * 1024 * 1024) throw new Error("Backend transport failed");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export function makeBackend(policy: DebatePolicy): Backend {
  if (
    policy.shenron.host !== "dbfr" ||
    policy.shenron.bridge !== "/usr/local/libexec/aphrody-debate-backend.py"
  )
    throw new Error("Canonical backend required");
  const invoke = async (tool: string, args: unknown): Promise<Record<string, unknown>> => {
    const encoded = Buffer.from(JSON.stringify({ tool, arguments: args })).toString("base64");
    const text = await run([
      "/home/ubuntu/.local/bin/aphrody",
      "infra",
      "ssh",
      "exec",
      "--host",
      policy.shenron.host,
      "--cmd",
      `sudo -n python3 /usr/local/libexec/aphrody-debate-backend.py '${encoded}'`,
    ]);
    const result = JSON.parse(text) as Record<string, unknown>;
    if (result.error) throw new Error("Shenron unavailable");
    return result;
  };
  return {
    async sendShenron(channelId, message) {
      return shenronDiscord({ action: "send", channelId, message });
    },
    async search(query) {
      const body = await invoke("aphrody_shenron_rag_search", {
        q: query,
        limit: policy.sourceLimit,
      });
      return normalizeSources(body as { results?: Record<string, unknown>[] }, policy.sourceLimit);
    },
    async answer(speaker, prompt) {
      if (speaker === "shenron") {
        const result = await invoke("aphrody_shenron_llm_chat", {
          model: policy.shenron.model,
          messages: [{ role: "user", content: prompt }],
        });
        if (typeof result.answer !== "string") throw new Error("Missing Shenron answer");
        return result.answer;
      }
      const url = new URL(policy.gemma.baseUrl);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
        throw new Error("Local Gemma endpoint required");
      const response = await fetch(`${url.href.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: policy.gemma.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: policy.gemma.maxTokens,
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(55_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Gemma unavailable");
      const result = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return result.choices?.[0]?.message?.content ?? "";
    },
  };
}

export async function configureDebate(
  policy: DebatePolicy,
  api: LabApi,
  apply: boolean,
): Promise<DebateState> {
  const guild = await api<{ id: string; owner_id: string }>(`/guilds/${policy.guildId}`);
  if (guild.id !== policy.guildId || guild.owner_id !== policy.ownerId)
    throw new Error("Guild owner mismatch");
  const self = await api<{ id: string }>("/users/@me");
  const roles = await api<{ id: string; name: string; permissions: string }[]>(
    `/guilds/${policy.guildId}/roles`,
  );
  const admin = unique(roles, policy.adminRole);
  const researcher = unique(roles, policy.researcherRole);
  if (!admin || !(BigInt(admin.permissions) & 8n) || !researcher)
    throw new Error("Lab roles required");
  const channels = await api<Channel[]>(`/guilds/${policy.guildId}/channels`);
  const parent = unique(channels, policy.category);
  if (!parent || parent.type !== 4) throw new Error("Existing lab category required");
  let channel = unique(channels, policy.channelName);
  if (channel && (channel.type !== 0 || channel.parent_id !== parent.id))
    throw new Error("Debate channel conflict");
  if (!channel && apply)
    channel = await api<Channel>(`/guilds/${policy.guildId}/channels`, "POST", {
      name: policy.channelName,
      type: 0,
      parent_id: parent.id,
      rate_limit_per_user: 10,
      topic:
        "Débats Dragon Ball sourcés : !aide, !debat <sujet>, !argument <thèse>. Shenron et Aphrody/Gemma ; relais Codex/AGY/Claude ; validation avant entraînement.",
      permission_overwrites: [
        { id: guild.id, type: 0, deny: "1024", allow: "0" },
        { id: admin.id, type: 0, deny: "0", allow: "1024" },
        { id: researcher.id, type: 0, deny: "0", allow: String(1024 | 2048 | 65536) },
        { id: self.id, type: 1, deny: "0", allow: String(1024 | 2048 | 65536) },
      ],
    });
  return {
    guildId: guild.id,
    botId: self.id,
    channelId: channel?.id ?? "planned",
    adminRoleId: admin.id,
    researcherRoleId: researcher.id,
  };
}

async function shenronDiscord(
  request: unknown,
): Promise<{ available?: boolean; botId?: string; messageId?: string }> {
  const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
  const result = await run([
    "/home/ubuntu/.local/bin/aphrody",
    "infra",
    "ssh",
    "exec",
    "--host",
    "dbfr",
    "--cmd",
    `sudo -n /home/ubuntu/.bun/bin/bun /usr/local/libexec/aphrody-debate-discord.mjs '${encoded}'`,
  ]);
  return JSON.parse(result) as { available?: boolean; botId?: string; messageId?: string };
}

async function refreshShenron(
  state: DebateState,
  policy: DebatePolicy,
  api: LabApi,
): Promise<void> {
  let available = false;
  try {
    const status = await shenronDiscord({ action: "status" });
    available = status.available === true && status.botId === policy.shenron.botId;
    if (available) {
      const channel = await api<{
        permission_overwrites: { id: string; type: number; allow: string; deny: string }[];
      }>(`/channels/${state.channelId}`);
      const overwrite = channel.permission_overwrites.find((o) => o.id === policy.shenron.botId);
      if (!overwrite || (BigInt(overwrite.allow) & 68608n) !== 68608n)
        await api(`/channels/${state.channelId}/permissions/${policy.shenron.botId}`, "PUT", {
          type: 1,
          allow: "68608",
          deny: "0",
        });
    }
  } catch {
    available = false;
  }
  state.shenronAvailable = available;
}

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1]!.startsWith("--"))
    throw new Error(`Missing ${name}`);
  return process.argv[index + 1]!;
}

if (import.meta.main) {
  const flags = ["--policy", "--env-file", "--state"];
  if (process.argv.includes("--help")) {
    console.log(
      "Debate worker: --policy FILE --env-file PROTECTED_FILE --state PRIVATE_FILE [--configure [--apply] | --probe | --guide]",
    );
    process.exit(0);
  }
  for (const name of flags) flag(name);
  const policy = (await Bun.file(flag("--policy")).json()) as DebatePolicy;
  if (
    !Number.isInteger(policy.maxRounds) ||
    policy.maxRounds < 1 ||
    policy.maxRounds > 20 ||
    !Number.isInteger(policy.sourceLimit) ||
    policy.sourceLimit < 1 ||
    policy.sourceLimit > 8 ||
    policy.pollSeconds < 2 ||
    policy.pollSeconds > 60 ||
    policy.rivalry.intervalSeconds < 900 ||
    policy.rivalry.intervalSeconds > 86400 ||
    policy.rivalry.maxSpontaneousRounds < 0 ||
    policy.rivalry.maxSpontaneousRounds > 4
  )
    throw new Error("Invalid debate limits");
  const credentials = flag("--env-file");
  if ((await stat(credentials)).mode & 0o027)
    throw new Error("Credentials require mode 0600 or trusted-group 0640");
  const env = await loadCredentials(credentials);
  if (env.DISCORD_GUILD_ID !== policy.guildId || !env.DISCORD_BOT_TOKEN)
    throw new Error("Credential guild mismatch");
  const api = makeApi(env.DISCORD_BOT_TOKEN);
  const statePath = resolve(flag("--state"));
  const store = dirname(statePath);
  // Debate content remains outside the repository in the host's protected lab store.
  await mkdir(store, { recursive: true, mode: 0o700 });
  if ((await stat(store)).mode & 0o077) throw new Error("Private state directory required");
  const configured = await configureDebate(
    policy,
    api,
    process.argv.includes("--configure") && process.argv.includes("--apply"),
  );
  if (process.argv.includes("--configure")) {
    if (process.argv.includes("--apply")) {
      if (await Bun.file(statePath).exists()) {
        const previous = (await Bun.file(statePath).json()) as DebateState;
        if (
          previous.channelId !== configured.channelId ||
          previous.guildId !== configured.guildId ||
          previous.botId !== configured.botId
        )
          throw new Error("Existing state identity mismatch");
        await saveState(statePath, { ...previous, ...configured });
      } else await saveState(statePath, configured);
    }
    console.log(
      JSON.stringify({
        configured: true,
        apply: process.argv.includes("--apply"),
        channelId: configured.channelId,
      }),
    );
    process.exit(0);
  }
  if (configured.channelId === "planned" || !(await Bun.file(statePath).exists()))
    throw new Error("Configure the debate channel first");
  const state = (await Bun.file(statePath).json()) as DebateState;
  for (const name of ["guildId", "channelId", "botId", "adminRoleId", "researcherRoleId"] as const)
    if (state[name] !== configured[name]) throw new Error("Debate state identity mismatch");
  await refreshShenron(state, policy, api);
  await saveState(statePath, state);
  if (process.argv.includes("--guide")) {
    const content =
      "**Aphrody ↔ Shenron : rivalité Dragon Ball**\nAphrody, <question> ou Shenron, <question>, ainsi que leurs @, ouvrent ou poursuivent le débat. !debat <sujet et continuité> et !argument <thèse> restent disponibles.\nAphrody est le développeur et critique de Shenron ; Shenron se spécialise en Dragon Ball. Chaque rival peut choisir d’intervenir spontanément : une occasion toutes les 15 minutes, quatre initiatives maximum par débat. Un premier débat peut s’ouvrir dès que les deux comptes bots sont présents. Les messages de bots ne déclenchent aucune boucle.\n!pause / !reprendre contrôle les initiatives ; !fin clôture. !agent codex|agy|claude <texte> relaie une contribution humaine, en attendant les endpoints A2A qualifiés. !valider <ID> permet aux administrateurs d’évaluer une réponse Shenron pour le dataset privé.\nLes références viennent du RAG Shenron existant sur DBFR ; manga, databooks, anime, films et jeux restent distincts. Les réponses évaluées doivent passer les gardes gold/secrets d’aphrody train sur le WSL d’Omar. Aucun poids n’est modifié automatiquement. Tant que le vrai bot Shenron n’est pas installé, ses réponses portent explicitement la mention de relais par Aphrody.";
    if (state.guideId)
      await api(`/channels/${state.channelId}/messages/${state.guideId}`, "PATCH", {
        content,
        allowed_mentions: { parse: [] },
      });
    if (!state.guideId) {
      const posted = await api<{ id: string }>(`/channels/${state.channelId}/messages`, "POST", {
        content,
        allowed_mentions: { parse: [] },
        nonce: `debate-guide-${state.channelId}`.slice(0, 25),
        enforce_nonce: true,
      });
      state.guideId = posted.id;
      await saveState(statePath, state);
    }
    console.log(JSON.stringify({ guideId: state.guideId }));
    process.exit(0);
  }
  const backend = makeBackend(policy);
  if (process.argv.includes("--probe")) {
    const sources = await backend.search("Son Goku");
    if (!sources.length) throw new Error("RAG returned no sources");
    const ready: string[] = [];
    for (const speaker of ["shenron", "gemma"] as const) {
      if (!(await backend.answer(speaker, "Réponds exactement DEBATE_OK.")))
        throw new Error("Probe empty answer");
      ready.push(speaker);
    }
    console.log(
      JSON.stringify({
        ready,
        shenronDiscordAvailable: state.shenronAvailable,
        sourceCount: sources.length,
        sources: sources.map((s) => ({ sourceId: s.sourceId, kind: s.kind })),
      }),
    );
    process.exit(0);
  }
  const persist = async () => {
    await saveState(statePath, state);
    if (!state.session) return;
    const id = state.session.id;
    if (!/^\d+$/.test(id)) throw new Error("Invalid session identity");
    await saveState(resolve(store, "sessions", `${id}.json`), state.session);
    const rows = approvedRollouts(state);
    if (rows.length) {
      const path = resolve(store, "training-input", `${id}.jsonl`);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await Bun.write(`${path}.tmp`, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
      await chmod(`${path}.tmp`, 0o600);
      await import("node:fs/promises").then(({ rename }) => rename(`${path}.tmp`, path));
    }
  };
  if (!state.after) {
    const latest = await api<LabMessage[]>(`/channels/${state.channelId}/messages?limit=1`);
    state.after = latest[0]?.id ?? String(BigInt(Date.now() - 1420070400000) << 22n);
    await persist();
  }
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      stopping = true;
    });
  console.log(JSON.stringify({ ready: true, guildId: state.guildId, channelId: state.channelId }));
  let nextBotProbeAt = Date.now() + 300_000;
  while (true) {
    if (stopping) break;
    try {
      if (Date.now() >= nextBotProbeAt) {
        await refreshShenron(state, policy, api);
        await persist();
        nextBotProbeAt = Date.now() + 300_000;
      }
      const messages: LabMessage[] = await api<LabMessage[]>(
        `/channels/${state.channelId}/messages?after=${state.after}&limit=100`,
      );
      for (const message of messages.toSorted((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
        if (stopping) break;
        await handleMessage(message, state, policy, api, backend, persist);
        state.after = message.id;
        await persist();
      }
      if (!stopping) await maybeInitiate(state, policy, api, backend, persist);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "debate-retry",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
    if (!stopping) await Bun.sleep(policy.pollSeconds * 1000);
  }
}
