// SPDX-License-Identifier: Apache-2.0
import {
  loadCredentials,
  makeApi,
  saveState,
  type LabApi,
  type LabPolicy,
  type LabState,
} from "./ai-lab.ts";

export interface LabMessage {
  id: string;
  channel_id: string;
  author: { id: string; bot?: boolean };
  content: string;
  webhook_id?: string;
  mentions?: { id: string }[];
}
export function eligiblePrompt(message: LabMessage, state: LabState): string | undefined {
  if (
    message.channel_id !== state.channels.assistant ||
    message.author.bot ||
    message.webhook_id ||
    !message.mentions?.some((user) => user.id === state.botId)
  )
    return;
  return (
    message.content
      .replaceAll(`<@${state.botId}>`, "")
      .replaceAll(`<@!${state.botId}>`, "")
      .trim()
      .slice(0, 4000) || undefined
  );
}
export async function askModel(
  policy: LabPolicy,
  prompt: string,
  transport: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(policy.assistant.modelBaseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("Local inference endpoint required");
  const response = await transport(`${url.href.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: policy.assistant.model,
      messages: [
        { role: "system", content: policy.assistant.systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: policy.assistant.maxTokens,
      temperature: 0.3,
      stream: false,
    }),
    signal: AbortSignal.timeout(45000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Inference HTTP ${response.status}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = body.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Empty inference response");
  return answer;
}
export async function processMessage(
  message: LabMessage,
  state: LabState,
  policy: LabPolicy,
  adminRoleId: string,
  api: LabApi,
  infer = askModel,
): Promise<boolean> {
  const prompt = eligiblePrompt(message, state);
  if (!prompt) return false;
  const member = await api<{ roles: string[] }>(
    `/guilds/${state.guildId}/members/${message.author.id}`,
  );
  if (
    message.author.id !== policy.ownerId &&
    !member.roles.some((role) => role === adminRoleId || role === state.researcherRoleId)
  )
    return false;
  const answer = await infer(policy, prompt);
  // Discord messages are bounded; suppress mentions from model-generated text.
  await api(`/channels/${message.channel_id}/messages`, "POST", {
    content: answer.slice(0, 1900),
    message_reference: { message_id: message.id, fail_if_not_exists: false },
    allowed_mentions: { parse: [], replied_user: false },
    nonce: message.id,
    enforce_nonce: true,
  });
  return true;
}

const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (import.meta.main) {
  for (const name of ["--policy", "--env-file", "--state", "--cursor"])
    if (!process.argv.includes(name)) throw new Error(`Missing ${name}`);
  const policy = (await Bun.file(flag("--policy")!).json()) as LabPolicy;
  const state = (await Bun.file(flag("--state")!).json()) as LabState;
  const env = await loadCredentials(flag("--env-file")!);
  if (
    state.guildId !== policy.guildId ||
    env.DISCORD_GUILD_ID !== policy.guildId ||
    !env.DISCORD_BOT_TOKEN
  )
    throw new Error("Lab identity mismatch");
  const api = makeApi(env.DISCORD_BOT_TOKEN);
  const self = await api<{ id: string }>("/users/@me");
  if (self.id !== state.botId) throw new Error("Bot identity mismatch");
  const roles = await api<{ id: string; name: string; permissions: string }[]>(
    `/guilds/${policy.guildId}/roles`,
  );
  const admin = roles.find(
    (role) => role.name === policy.adminRole && BigInt(role.permissions) & 8n,
  );
  if (!admin) throw new Error("Admin role absent");
  if (process.argv.includes("--smoke")) {
    const answer = await askModel(policy, "Réponds exactement LAB_OK.");
    const posted = await api<{ id: string }>(
      `/channels/${state.channels["lab-status"]}/messages`,
      "POST",
      {
        content: `Assistant IA local vérifié : ${policy.assistant.model}. Réponse de contrôle : ${answer.slice(0, 100)}.\nDans <#${state.channels.assistant}>, mentionnez <@${state.botId}> avec votre question.`,
        allowed_mentions: { parse: [] },
      },
    );
    console.log(
      JSON.stringify({ smoke: true, model: policy.assistant.model, messageId: posted.id }),
    );
    process.exit(0);
  }
  const cursorPath = flag("--cursor")!;
  let cursor: string | undefined = (await Bun.file(cursorPath).exists())
    ? ((await Bun.file(cursorPath).json()) as { after: string }).after
    : undefined;
  if (!cursor) {
    const latest = await api<LabMessage[]>(
      `/channels/${state.channels.assistant}/messages?limit=1`,
    );
    cursor = latest[0]?.id ?? String(BigInt(Date.now() - 1420070400000) << 22n);
    await saveState(cursorPath, { after: cursor });
  }
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      stopping = true;
    });
  console.log(
    JSON.stringify({
      ready: true,
      guildId: state.guildId,
      channelId: state.channels.assistant,
      model: policy.assistant.model,
    }),
  );
  // Sequential inference bounds model load and preserves source-message ordering.
  /* oxlint-disable no-await-in-loop */
  while (true) {
    if (stopping) break;
    try {
      const messages: LabMessage[] = await api<LabMessage[]>(
        `/channels/${state.channels.assistant}/messages?after=${cursor}&limit=100`,
      );
      for (const message of messages.toSorted((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
        if (stopping) break;
        await processMessage(message, state, policy, admin.id, api);
        cursor = message.id;
        await saveState(cursorPath, { after: cursor });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "assistant-retry",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
    if (!stopping) await Bun.sleep(policy.assistant.pollSeconds * 1000);
  }
}
