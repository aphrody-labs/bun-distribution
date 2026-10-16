// SPDX-License-Identifier: Apache-2.0
// Discord mutations depend on IDs from the preceding response and stay serialized.
/* oxlint-disable no-await-in-loop */
import { mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { discordFetch } from "../rest.ts";
import type { LocalAISelection } from "./local-ai.ts";

export interface LabPolicy {
  guildId: string;
  ownerId: string;
  name: string;
  researcherRole: string;
  adminRole: string;
  categories: {
    name: string;
    adminOnly?: boolean;
    channels: { name: string; topic: string; guide?: string }[];
  }[];
  assistant: LocalAISelection & {
    channelId?: string;
    pollSeconds: number;
    maxTokens: number;
    systemPrompt: string;
    timeoutMs?: number;
  };
}
export interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id?: string;
  topic?: string;
  permission_overwrites?: unknown[];
}
interface Role {
  id: string;
  name: string;
  permissions: string;
}
export type LabApi = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
export interface LabState {
  guildId: string;
  botId: string;
  researcherRoleId: string;
  channels: Record<string, string>;
  guides: Record<string, string>;
}
const view = 1024;
const researcherPermissions = String(
  1024n |
    2048n |
    65536n |
    32768n |
    16384n |
    64n |
    1048576n |
    2097152n |
    34359738368n |
    274877906944n,
);

export function unique<T extends { name: string }>(items: T[], name: string): T | undefined {
  const matches = items.filter((item) => item.name === name);
  if (matches.length > 1) throw new Error(`Ambiguous Discord object: ${name}`);
  return matches[0];
}

export async function configureLab(
  policy: LabPolicy,
  api: LabApi,
  apply: boolean,
  previous?: LabState,
): Promise<LabState> {
  const guild = await api<{ id: string; name: string; owner_id: string }>(
    `/guilds/${policy.guildId}`,
  );
  if (guild.id !== policy.guildId || guild.owner_id !== policy.ownerId)
    throw new Error("Guild owner mismatch");
  const bot = await api<{ id: string }>("/users/@me");
  const channels = await api<Channel[]>(`/guilds/${policy.guildId}/channels`);
  const roles = await api<Role[]>(`/guilds/${policy.guildId}/roles`);
  const admin = unique(roles, policy.adminRole);
  if (!admin || !(BigInt(admin.permissions) & 8n))
    throw new Error("Verified administrator role required");
  let researcher = unique(roles, policy.researcherRole);
  if (!researcher && apply)
    researcher = await api<Role>(`/guilds/${policy.guildId}/roles`, "POST", {
      name: policy.researcherRole,
      permissions: researcherPermissions,
      mentionable: false,
    });
  const state: LabState = {
    guildId: guild.id,
    botId: bot.id,
    researcherRoleId: researcher?.id ?? "planned",
    channels: {},
    guides: { ...previous?.guides },
  };
  if (apply && guild.name !== policy.name)
    await api(`/guilds/${guild.id}`, "PATCH", { name: policy.name });
  for (const category of policy.categories) {
    const overwrites = [
      { id: guild.id, type: 0, deny: String(view), allow: "0" },
      { id: admin.id, type: 0, deny: "0", allow: String(view) },
      { id: bot.id, type: 1, deny: "0", allow: String(view | 2048 | 65536) },
      ...(category.adminOnly
        ? []
        : [{ id: state.researcherRoleId, type: 0, deny: "0", allow: String(view) }]),
    ];
    let parent = unique(channels, category.name);
    if (parent && parent.type !== 4) throw new Error("Category type mismatch");
    if (!parent && apply) {
      parent = await api<Channel>(`/guilds/${guild.id}/channels`, "POST", {
        name: category.name,
        type: 4,
        permission_overwrites: overwrites,
      });
      channels.push(parent);
    } else if (parent && apply)
      await api(`/channels/${parent.id}`, "PATCH", { permission_overwrites: overwrites });
    for (const spec of category.channels) {
      let channel = unique(channels, spec.name);
      if (channel && (channel.type !== 0 || channel.parent_id !== parent?.id))
        throw new Error(`Existing channel conflict: ${spec.name}`);
      if (!channel && apply) {
        channel = await api<Channel>(`/guilds/${guild.id}/channels`, "POST", {
          name: spec.name,
          type: 0,
          parent_id: parent?.id,
          topic: spec.topic,
          permission_overwrites: overwrites,
          rate_limit_per_user: spec.name === "assistant" ? 5 : 0,
        });
        channels.push(channel);
      } else if (channel && apply)
        await api(`/channels/${channel.id}`, "PATCH", {
          topic: spec.topic,
          permission_overwrites: overwrites,
        });
      state.channels[spec.name] = channel?.id ?? "planned";
      if (spec.guide && channel && apply && !state.guides[spec.name]) {
        const message = await api<{ id: string }>(`/channels/${channel.id}/messages`, "POST", {
          content: spec.guide,
          allowed_mentions: { parse: [] },
        });
        state.guides[spec.name] = message.id;
      }
    }
  }
  return state;
}

export async function loadCredentials(path: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const line of (await Bun.file(path).text()).split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return env;
}
export function makeApi(token: string): LabApi {
  return async <T>(path: string, method = "GET", body?: unknown): Promise<T> =>
    (await discordFetch<T>(path, { mode: "Bot", token, method, body })).data;
}
export async function saveState(path: string, state: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  await Bun.write(temp, JSON.stringify(state, null, 2) + "\n");
  await chmod(temp, 0o600);
  await import("node:fs/promises").then(({ rename }) => rename(temp, path));
}

const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (import.meta.main) {
  if (
    !process.argv.includes("--policy") ||
    !process.argv.includes("--env-file") ||
    !process.argv.includes("--state")
  )
    throw new Error("Required: --policy FILE --env-file FILE --state PRIVATE_FILE [--apply]");
  const policy = (await Bun.file(flag("--policy")!).json()) as LabPolicy;
  const env = await loadCredentials(flag("--env-file")!);
  if (env.DISCORD_GUILD_ID !== policy.guildId || !env.DISCORD_BOT_TOKEN)
    throw new Error("Declared credential guild mismatch");
  const statePath = flag("--state")!;
  const previous = (await Bun.file(statePath).exists())
    ? ((await Bun.file(statePath).json()) as LabState)
    : undefined;
  const state = await configureLab(
    policy,
    makeApi(env.DISCORD_BOT_TOKEN),
    process.argv.includes("--apply"),
    previous,
  );
  if (process.argv.includes("--apply")) await saveState(statePath, state);
  console.log(JSON.stringify({ apply: process.argv.includes("--apply"), ...state }));
}
