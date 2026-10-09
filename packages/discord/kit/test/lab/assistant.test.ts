import { describe, expect, test } from "bun:test";
import {
  askModel,
  eligiblePrompt,
  errorSummary,
  MODEL_UNAVAILABLE_REPLY,
  processMessage,
  type LabMessage,
} from "../../src/lab/assistant.ts";
import type { LabApi, LabPolicy, LabState } from "../../src/lab/ai-lab.ts";
import type { LocalAIInput, LocalAISelection } from "../../src/lab/local-ai.ts";

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
    model: "gemma-4-e2b-it-q4km",
    profile: "aphrody",
    systemPrompt: "Lab",
    maxTokens: 384,
  },
} as LabPolicy;
const researcherApi: LabApi = async <T>() => ({ roles: ["researcher"] }) as T;
const emptyRolesApi: LabApi = async <T>() => ({ roles: [] }) as T;
const unavailableApi: LabApi = async () => {
  throw new Error("Discord 503");
};
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
  test("migration targets general and accepts an explicit Aphrody address", async () => {
    const migrated = { ...policy, assistant: { ...policy.assistant, channelId: "general" } };
    let calls = 0;
    const infer = async () => {
      calls++;
      return "answer";
    };
    expect(await processMessage(message, state, migrated, "admin", researcherApi, infer)).toBe(
      false,
    );
    expect(
      await processMessage(
        { ...message, channel_id: "general", content: "Aphrody, bonjour", mentions: [] },
        state,
        migrated,
        "admin",
        researcherApi,
        infer,
      ),
    ).toBe(true);
    expect(calls).toBe(1);
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
  test("missing model backend answers once and releases the message", async () => {
    let payload: Record<string, unknown> | undefined;
    const api: LabApi = async <T>(_path: string, method?: string, body?: unknown) => {
      if (method === "POST") payload = body as Record<string, unknown>;
      return { roles: ["researcher"] } as T;
    };
    expect(
      await processMessage(message, state, policy, "admin", api, async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
      }),
    ).toBe(true);
    expect(payload!.content).toBe(MODEL_UNAVAILABLE_REPLY);
    expect(payload!.allowed_mentions).toEqual({ parse: [], replied_user: false });
    expect(payload!.nonce).toBe("1");
    expect(payload!.enforce_nonce).toBe(true);
  });
  test("discord failures still propagate for retry", async () => {
    await expect(
      processMessage(message, state, policy, "admin", unavailableApi, async () => "answer"),
    ).rejects.toThrow("Discord 503");
  });
  test("error summary is bounded and masks credentials", () => {
    const summary = errorSummary(
      new Error(
        `Bot abc.def failed ${"MTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ.ZnCjm1XVW7vRze4b7Cq4se7kKWs"} ${"x".repeat(400)}`,
      ),
    );
    expect(summary.length).toBe(200);
    expect(summary.startsWith("Error: Bot [masqué] failed [masqué] ")).toBe(true);
    expect(errorSummary("plain")).toBe("plain");
  });
  test("assistant preserves selected model/profile and system instructions through native adapter", async () => {
    let selection: LocalAISelection | undefined;
    let input: LocalAIInput | undefined;
    const inference = {
      async chat(selected: LocalAISelection, request: LocalAIInput) {
        selection = selected;
        input = request;
        return {
          text: " LAB_OK ",
          model: selected.model,
          profile: selected.profile,
          usage: null,
          finishReason: null,
        };
      },
    };
    expect(await askModel(policy, "test", inference)).toBe("LAB_OK");
    expect(selection).toMatchObject({ model: "gemma-4-e2b-it-q4km", profile: "aphrody" });
    expect(input).toMatchObject({ system: "Lab", messages: [{ role: "user", content: "test" }] });
    await expect(
      askModel(policy, "test", {
        async chat() {
          throw new Error("Missing native inference ABI");
        },
      }),
    ).rejects.toThrow("Missing native inference ABI");
  });
});
