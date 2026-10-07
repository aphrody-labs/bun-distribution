// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  addressedPrompt,
  answerFailureClass,
  groundedPrompt,
  maybeInitiate,
  approvedRollouts,
  citedSources,
  handleMessage,
  normalizeSources,
  type Backend,
  type DebatePolicy,
  type DebateState,
  type Source,
} from "./debate.ts";
import { configureDebate, debateMessages, makeBackend } from "./worker.ts";
import type { LabApi } from "../../../../packages/discord/kit/src/lab/ai-lab.ts";
import type { LabMessage } from "../../../../packages/discord/kit/src/lab/assistant.ts";

// These scenarios deliberately exercise ordered state transitions.
/* oxlint-disable no-await-in-loop */

const policy = (await Bun.file(
  new URL("../../../../tools/config/host/discord-debate.json", import.meta.url),
).json()) as DebatePolicy;
const source: Source = {
  id: "chapter-1",
  sourceId: "shenron:manga:1",
  title: "Manga chapitre 1",
  url: "https://dragonballfr.com/wiki/manga/1",
  kind: "manga_page",
  snippet: "Un extrait du manga.",
};
const message = (id: string, content: string, author = "omar"): LabMessage => ({
  id,
  channel_id: "debate",
  author: { id: author },
  content,
});
test("failure telemetry identifies technical classes without returning private error bodies", () => {
  expect(answerFailureClass(new Error("native deadline: private prompt text"))).toBe("deadline");
  expect(answerFailureClass(new Error("the selected Agent Home has no SOUL.md"))).toBe(
    "profile-configuration",
  );
  expect(answerFailureClass(new Error("model is not installed in the protected model store"))).toBe(
    "model-configuration",
  );
  expect(answerFailureClass(new Error("Native manifest missing at /private/path"))).toBe(
    "native-binding",
  );
  expect(answerFailureClass(new Error("credential=must-not-appear"))).toBe("backend-unavailable");
});
function fixture(roles = ["researcher"]) {
  const posts: { content: string; allowed_mentions: { parse: string[] }; nonce: string }[] = [];
  let inferences = 0;
  const state: DebateState = {
    guildId: policy.guildId,
    botId: "bot",
    channelId: "debate",
    adminRoleId: "admin",
    researcherRoleId: "researcher",
  };
  const api = (async (path: string, method?: string, body?: unknown) => {
    if (method === "POST") {
      posts.push(body as (typeof posts)[number]);
      return { id: String(900000000000000001n + BigInt(posts.length)) };
    }
    if (path.includes("/members/")) return { roles };
    throw new Error("Unexpected route");
  }) as LabApi;
  const backend: Backend = {
    search: async () => [source],
    answer: async () => {
      inferences++;
      return "Une thèse à vérifier [S1].";
    },
  };
  const processMessage = (m: LabMessage) =>
    handleMessage(m, state, policy, api, backend, async () => {});
  return { state, posts, api, backend, message, processMessage, inferences: () => inferences };
}

test("rejects bots, webhooks, wrong channel and unauthorized members", async () => {
  const f = fixture([]);
  for (const candidate of [
    f.message("1", "!debat Goku"),
    { ...f.message("2", "!debat Goku"), author: { id: "bot", bot: true } },
    { ...f.message("3", "!debat Goku"), webhook_id: "hook" },
    { ...f.message("4", "!debat Goku"), channel_id: "elsewhere" },
  ])
    expect(await f.processMessage(candidate)).toBe(false);
  expect(f.posts).toHaveLength(0);
  expect(f.inferences()).toBe(0);
});
test("grounds sequential Shenron/Gemma responses and disables mentions", async () => {
  const f = fixture();
  await f.processMessage(f.message("10", "!debat Goku contre Vegeta dans le manga"));
  expect(f.state.session?.turns.map((t) => t.speaker)).toEqual(["human:omar", "shenron", "gemma"]);
  expect(f.posts).toHaveLength(2);
  expect(f.posts[0]?.content).toContain("[S1] Manga chapitre 1");
  expect(
    f.posts.every((p) => p.allowed_mentions.parse.length === 0 && p.content.length <= 1900),
  ).toBe(true);
  expect(approvedRollouts(f.state)).toEqual([]);
});
test("publication distinguishes secondary references from primary manga passages", async () => {
  const f = fixture();
  f.backend.search = async () => [{ ...source, kind: "character" }];
  await f.processMessage(f.message("secondary", "!debat Une comparaison sourcée"));
  expect(f.posts.every((post) => post.content.includes("Passage primaire absent"))).toBe(true);
  const primary = fixture();
  await primary.processMessage(primary.message("primary", "!debat Une comparaison sourcée"));
  expect(primary.posts.every((post) => !post.content.includes("Passage primaire absent"))).toBe(
    true,
  );
});
test("a human topic replaces and archives an automatic topic without stale context", async () => {
  const f = fixture();
  f.state.session = {
    id: "automatic",
    topic: "Goku contre Vegeta",
    rounds: 1,
    closed: false,
    turns: [
      {
        id: "automatic:human",
        speaker: "initiative:gemma",
        text: "Goku",
        prompt: "Goku",
        sources: [],
      },
    ],
  };
  const snapshots: DebateState[] = [];
  const prompts: string[] = [];
  f.backend.answer = async (_speaker, prompt) => {
    prompts.push(prompt);
    return "Une thèse [S1].";
  };
  await handleMessage(
    f.message("human-topic", "!debat Cell contre Gohan"),
    f.state,
    policy,
    f.api,
    f.backend,
    async () => {
      snapshots.push(structuredClone(f.state));
    },
  );
  expect(snapshots[0]?.session?.id).toBe("automatic");
  expect(snapshots[0]?.session?.closed).toBe(true);
  expect(f.state.session?.topic).toBe("Cell contre Gohan");
  expect(f.state.session?.rounds).toBe(1);
  expect(prompts.every((prompt) => !prompt.includes("Goku contre Vegeta"))).toBe(true);
  expect(f.posts).toHaveLength(2);
});
test("a new topic preserves an already open human debate", async () => {
  const f = fixture();
  await f.processMessage(f.message("first", "!debat Cell contre Gohan"));
  await f.processMessage(f.message("second", "!debat Buu"));
  expect(f.state.session?.id).toBe("first");
  expect(f.state.session?.topic).toBe("Cell contre Gohan");
  expect(f.inferences()).toBe(2);
  expect(f.posts.at(-1)?.content).toContain("Un débat est ouvert");
});
test("bounds grounded CPU context while keeping citation identities", () => {
  const longSource = { ...source, snippet: "x".repeat(2400), title: "t".repeat(600) };
  const turns = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    speaker: "shenron",
    text: "h".repeat(1200),
    prompt: "private prompt omitted",
    sources: [longSource],
  }));
  const prompt = groundedPrompt(
    "Goku",
    "Une objection",
    turns,
    Array.from({ length: 6 }, () => ({ ...longSource })),
  );
  const data = JSON.parse(prompt.split("\n").at(-1)!) as {
    history: { text: string }[];
    sources: { sourceId: string; citation: string; snippet: string }[];
  };
  expect(data.history).toHaveLength(3);
  expect(data.history.every((turn) => turn.text.length === 400)).toBe(true);
  expect(data.sources[5]?.citation).toBe("[S6]");
  expect(data.sources.every((item) => item.snippet.length === 600)).toBe(true);
  expect(data.sources[0]?.sourceId).toBe(source.sourceId);
  expect(prompt.length).toBeLessThan(9_000);
});
test("local model autonomy lives in a system message with truthful execution boundaries", () => {
  const messages = debateMessages("Données sources synthétiques");
  expect(messages.map((item) => item.role)).toEqual(["system", "user"]);
  expect(messages[0]?.content).toContain("sans confirmation intermédiaire");
  expect(messages[0]?.content).toContain("NHITL ne crée aucune authentification");
  expect(messages[1]?.content).toBe("Données sources synthétiques");
});
test("both models use the shared native adapter with isolated profiles and bounded generation", async () => {
  const calls: { model: string; profile: string; maxTokens?: number; system?: string }[] = [];
  const backend = makeBackend(policy, {
    async chat(selection, input) {
      calls.push({
        model: selection.model,
        profile: selection.profile,
        maxTokens: input.maxTokens,
        system: input.system,
      });
      expect(input.messages).toEqual([{ role: "user", content: "Question synthétique" }]);
      return {
        text: "Réponse native",
        model: selection.model,
        profile: selection.profile,
        usage: null,
        finishReason: "stop",
      };
    },
  });
  for (const speaker of ["shenron", "gemma"] as const)
    expect(await backend.answer(speaker, "Question synthétique")).toBe("Réponse native");
  expect(calls.map((call) => call.model)).toEqual([
    "qwen3-4b-instruct-2507-q4km",
    "gemma-4-e2b-it-q4km",
  ]);
  expect(calls.map((call) => call.profile)).toEqual(["dbfr", "aphrody"]);
  expect(calls.every((call) => call.maxTokens === 256)).toBe(true);
  expect(calls.every((call) => call.system?.includes("sans confirmation intermédiaire"))).toBe(
    true,
  );
});
test("only administrators can validate a cited Shenron response", async () => {
  const f = fixture();
  await f.processMessage(f.message("10", "!debat Goku"));
  expect(await f.processMessage(f.message("11", "!valider 10:shenron"))).toBe(false);
  await f.processMessage(f.message("12", "!valider 10:shenron", policy.ownerId));
  const rows = approvedRollouts(f.state) as {
    item: { type: string; message?: { role: string } };
  }[];
  expect(rows).toHaveLength(4);
  expect(rows[2]?.item.message?.role).toBe("model");
  expect(f.state.session?.turns.find((t) => t.speaker === "gemma")?.approvedBy).toBeUndefined();
});
test("refuses unknown citations and unsupported factual responses", async () => {
  const f = fixture(["admin"]);
  f.backend.answer = async () => "Affirmation non sourcée [S9].";
  await f.processMessage(f.message("10", "!debat Goku"));
  await f.processMessage(f.message("12", "!valider 10:shenron"));
  expect(approvedRollouts(f.state)).toEqual([]);
  expect(f.posts.at(-1)?.content).toContain("Validation refusée");
});
test("fails closed when retrieval is empty or unavailable", async () => {
  for (const failed of [false, true]) {
    const f = fixture();
    f.backend.search = async () => {
      if (failed) throw new Error("unavailable");
      return [];
    };
    await f.processMessage(f.message("10", "!debat Goku"));
    expect(f.inferences()).toBe(0);
    expect(f.posts).toHaveLength(1);
  }
});
test("keeps Gemma available when Shenron fails without exporting its answer", async () => {
  const f = fixture();
  f.backend.answer = async (speaker) => {
    if (speaker === "shenron") throw new Error("failed");
    return "Réponse [S1]";
  };
  await f.processMessage(f.message("10", "!debat Goku"));
  expect(f.state.session?.turns.map((t) => t.speaker)).toEqual(["human:omar", "gemma"]);
  expect(approvedRollouts(f.state)).toEqual([]);
});
test("does not regenerate existing argument turns during a delivery retry", async () => {
  const f = fixture();
  await f.processMessage(f.message("10", "!debat Goku"));
  await f.processMessage(f.message("10", "!debat Goku"));
  await f.processMessage(f.message("11", "!argument Une hypothèse"));
  await f.processMessage(f.message("11", "!argument Une hypothèse"));
  expect(f.inferences()).toBe(4);
  expect(f.state.session?.rounds).toBe(2);
  expect(f.posts).toHaveLength(4);
  expect(f.state.session?.turns.filter((turn) => turn.messageId)).toHaveLength(4);
});
test("restart after the second delivery fails preserves the first real message receipt", async () => {
  const f = fixture();
  let saved = structuredClone(f.state);
  let failed = false;
  const flakyApi = (async (path: string, method?: string, body?: unknown) => {
    if (
      method === "POST" &&
      !failed &&
      (body as { content: string }).content.includes("développeur de Shenron")
    ) {
      failed = true;
      throw new Error("Temporary Discord delivery failure");
    }
    return f.api(path, method, body);
  }) as LabApi;
  await expect(
    handleMessage(
      f.message("10", "!debat Goku"),
      f.state,
      policy,
      flakyApi,
      f.backend,
      async () => {
        saved = structuredClone(f.state);
      },
    ),
  ).rejects.toThrow("Temporary Discord delivery failure");
  expect(saved.session?.turns.find((turn) => turn.speaker === "shenron")?.messageId).toMatch(
    /^\d+$/,
  );
  expect(saved.session?.turns.find((turn) => turn.speaker === "gemma")?.messageId).toBeUndefined();
  await handleMessage(
    f.message("10", "!debat Goku"),
    saved,
    policy,
    flakyApi,
    f.backend,
    async () => {},
  );
  expect(f.posts).toHaveLength(2);
  expect(f.inferences()).toBe(2);
  expect(saved.session?.turns.filter((turn) => turn.messageId)).toHaveLength(2);
});
test("bounds rounds, prevents replacement and restricts closure", async () => {
  const f = fixture();
  await f.processMessage(f.message("10", "!debat Goku"));
  await f.processMessage(f.message("11", "!debat autre sujet"));
  expect(f.state.session?.topic).toBe("Goku");
  f.state.session!.rounds = policy.maxRounds;
  await f.processMessage(f.message("12", "!argument hypothèse"));
  expect(f.inferences()).toBe(2);
  expect(await f.processMessage(f.message("13", "!fin"))).toBe(false);
  await f.processMessage(f.message("14", "!fin", policy.ownerId));
  expect(f.state.session?.closed).toBe(true);
});
test("labels coding-agent contributions as human relays", async () => {
  const f = fixture(["admin"]);
  await f.processMessage(f.message("10", "!debat Goku"));
  await f.processMessage(f.message("11", "!agent codex Une contradiction"));
  expect(f.state.session?.turns[3]?.speaker).toBe("human-relay:codex");
});
test("search respects the canonical 512-byte query limit", async () => {
  const f = fixture();
  f.backend.search = async (q) => {
    expect(Buffer.byteLength(q)).toBeLessThanOrEqual(512);
    return [source];
  };
  await f.processMessage(f.message("10", `!debat ${"悟".repeat(1500)}`));
});
test("rejects Fandom, duplicates and unsafe URLs, preserves stable IDs", () => {
  const hit = {
    sourceId: source.sourceId,
    url: source.url,
    title: source.title,
    content: "passage",
  };
  const body = {
    results: [
      hit,
      hit,
      { ...hit, url: "https://dragonball.fandom.com/wiki/Goku" },
      { ...hit, url: "file:///private" },
      { ...hit, url: "invalid" },
    ],
  };
  expect(normalizeSources(body, 6)).toHaveLength(1);
  expect(
    citedSources({ id: "1", speaker: "shenron", text: "[S0]", sources: [source], prompt: "x" }),
  ).toEqual([]);
});
test("configuration creates only the requested channel without editing the lab", async () => {
  const mutations: string[] = [];
  const api = (async (path: string, method?: string) => {
    if (method) {
      mutations.push(path);
      return { id: "new-channel" };
    }
    if (path === `/guilds/${policy.guildId}`)
      return { id: policy.guildId, owner_id: policy.ownerId };
    if (path === "/users/@me") return { id: "bot" };
    if (path.endsWith("/roles"))
      return [
        { id: "a", name: policy.adminRole, permissions: "8" },
        { id: "r", name: policy.researcherRole, permissions: "0" },
      ];
    if (path.endsWith("/channels")) return [{ id: "parent", name: policy.category, type: 4 }];
    throw new Error("unknown path");
  }) as LabApi;
  expect((await configureDebate(policy, api, false)).channelId).toBe("planned");
  expect(mutations).toHaveLength(0);
  expect((await configureDebate(policy, api, true)).channelId).toBe("new-channel");
  expect(mutations).toEqual([`/guilds/${policy.guildId}/channels`]);
});

test("both bot names and Discord mentions open or continue the debate", async () => {
  for (const content of [
    "Aphrody, Goku contre Vegeta",
    "Shenron: Goku contre Vegeta",
    "<@bot> Goku contre Vegeta",
    `<@!${policy.shenron.botId}> Goku contre Vegeta`,
  ]) {
    const f = fixture();
    await f.processMessage(f.message("10", content));
    expect(f.state.session?.topic).toBe("Goku contre Vegeta");
    expect(f.inferences()).toBe(2);
  }
  expect(
    addressedPrompt(
      { ...message("11", "Shenron: débat"), author: { id: "bot", bot: true } },
      "bot",
      policy.shenron.botId,
    ),
  ).toBeUndefined();
});

test("sends Shenron answers through his real bot transport when available", async () => {
  const f = fixture();
  f.state.shenronAvailable = true;
  const nativeMessages: unknown[] = [];
  f.backend.sendShenron = async (channelId, body) => {
    expect(channelId).toBe("debate");
    nativeMessages.push(body);
    return { messageId: "900000000000000100" };
  };
  await f.processMessage(f.message("10", "Shenron, Goku"));
  expect(nativeMessages).toHaveLength(1);
  expect(f.posts).toHaveLength(1);
  expect(f.posts[0]?.content).toContain("développeur de Shenron");
});

test("spontaneous rivalry is timed, bounded, paused and never attributed to a human", async () => {
  const f = fixture();
  await f.processMessage(f.message("10", "!debat Goku"));
  f.state.nextInitiativeAt = 0;
  const now = Date.now();
  f.backend.answer = async (_speaker, prompt) =>
    prompt.includes("Réponds PASSER") ? "Quel extrait justifie ta thèse ?" : "Réponse sourcée [S1]";
  expect(await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, now)).toBe(true);
  expect(f.state.session?.turns[3]?.speaker).toBe("initiative:gemma");
  expect(f.state.session?.spontaneousRounds).toBe(1);
  expect(await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, now + 1000)).toBe(
    false,
  );
  f.state.spontaneousPaused = true;
  expect(
    await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, now + 1000000),
  ).toBe(false);
  f.state.spontaneousPaused = false;
  f.state.session!.spontaneousRounds = policy.rivalry.maxSpontaneousRounds;
  expect(
    await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, now + 1000000),
  ).toBe(false);
});

test("either rival can decline an initiative without publishing or entering training", async () => {
  const f = fixture();
  await f.processMessage(f.message("10", "!debat Goku"));
  f.state.nextInitiativeAt = 0;
  const speakers: string[] = [];
  f.backend.answer = async (speaker) => {
    speakers.push(speaker);
    return "PASSER";
  };
  expect(await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, Date.now())).toBe(
    false,
  );
  expect(
    await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, Date.now() + 1000000),
  ).toBe(false);
  expect(speakers).toEqual(["gemma", "shenron"]);
  expect(f.posts).toHaveLength(2);
  expect(approvedRollouts(f.state)).toEqual([]);
});

test("the first autonomous debate waits for the actual second bot and a model decision", async () => {
  const f = fixture();
  f.backend.answer = async (_speaker, prompt) =>
    prompt.includes("PASSER ou OUVRIR") ? "OUVRIR" : "Réponse [S1]";
  const now = Date.now();
  expect(await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, now)).toBe(false);
  f.state.shenronAvailable = true;
  expect(await maybeInitiate(f.state, policy, f.api, f.backend, async () => {}, now)).toBe(true);
  expect(f.state.session?.turns[0]?.speaker).toBe("initiative:gemma");
  expect(f.state.session?.spontaneousRounds).toBe(1);
  expect(f.state.session?.topic).toBe(policy.rivalry.starterTopic);
  expect(approvedRollouts(f.state)).toEqual([]);
});
