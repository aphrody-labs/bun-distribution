import { describe, expect, test } from "bun:test";
import {
  askModel,
  eligiblePrompt,
  processMessage,
  type LabMessage,
} from "../../src/lab/assistant.ts";
import type { LabApi, LabPolicy, LabState } from "../../src/lab/ai-lab.ts";

const state: LabState = {
  guildId: "guild",
  botId: "bot",
  researcherRoleId: "researcher",
  channels: { assistant: "channel" },
  guides: {},
};
const message: LabMessage = {
  id: "1",
  channel_id: "channel",
  author: { id: "human" },
  content: "<@bot> Explain",
  mentions: [{ id: "bot" }],
};
const policy = {
  ownerId: "owner",
  assistant: {
    modelBaseUrl: "http://127.0.0.1:8798/v1",
    model: "gemma4-e2b",
    systemPrompt: "Lab",
    maxTokens: 384,
  },
} as LabPolicy;
const emptyRolesApi: LabApi = async <T>() => ({ roles: [] }) as T;
describe("laboratory assistant boundary", () => {
  test("accept only explicit human mentions in configured channel", () => {
    expect(eligiblePrompt(message, state)).toBe("Explain");
    for (const invalid of [
      { ...message, channel_id: "other" },
      { ...message, author: { id: "human", bot: true } },
      { ...message, webhook_id: "hook" },
      { ...message, mentions: [] },
    ])
      expect(eligiblePrompt(invalid, state)).toBeUndefined();
  });
  test("unprivileged member cannot trigger model", async () => {
    let calls = 0;
    expect(
      await processMessage(message, state, policy, "admin", emptyRolesApi, async () => {
        calls++;
        return "answer";
      }),
    ).toBe(false);
    expect(calls).toBe(0);
  });
  test("researcher response is bounded, referenced and cannot ping anyone", async () => {
    let payload: Record<string, unknown> | undefined;
    const api: LabApi = async <T>(_path: string, method?: string, body?: unknown) => {
      if (method === "POST") payload = body as Record<string, unknown>;
      return { roles: ["researcher"] } as T;
    };
    expect(
      await processMessage(
        message,
        state,
        policy,
        "admin",
        api,
        async () => "@everyone " + "x".repeat(3000),
      ),
    ).toBe(true);
    expect((payload!.content as string).length).toBe(1900);
    expect(payload!.allowed_mentions).toEqual({ parse: [], replied_user: false });
    expect(payload!.enforce_nonce).toBe(true);
  });
  test("model uses declared local backend only", async () => {
    let body: Record<string, unknown> | undefined;
    const transport = (async (_url, init) => {
      body = JSON.parse(init!.body as string);
      return Response.json({ choices: [{ message: { content: "LAB_OK" } }] });
    }) as typeof fetch;
    expect(await askModel(policy, "test", transport)).toBe("LAB_OK");
    expect(body!.model).toBe("gemma4-e2b");
    await expect(
      askModel(
        {
          ...policy,
          assistant: { ...policy.assistant, modelBaseUrl: "https://external.invalid/v1" },
        },
        "test",
        transport,
      ),
    ).rejects.toThrow("Local inference");
  });
});
