// SPDX-License-Identifier: Apache-2.0
// IA + Agent Home batch (dbfr): admin IA API access (401 vs 403, body, evaluation size) and the
// `llm/chat` model adapter (blank model id, ignored call settings). Hermetic: no network, no
// retrieval, no private profile read. Retrieval checks belong to @shenron/pipeline/testing/live-rag.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateText, streamText } from "ai";
import { createAphrodyCompute } from "@shenron/pipeline/ai/aphrody";
import { createAphrodyChatModel, ignoredSettingWarnings } from "@shenron/pipeline/ai/chat";
import type { CurrentUser, SiteUser } from "@/lib/session";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

let me: CurrentUser | null = null;
mock.module("@/lib/session", () => ({
  getCurrentUser: async () => me,
  isCurrentUserAdmin: async () => me?.user?.roleAdmin === true,
  requireAdmin: async () => {},
}));
mock.module("@/lib/canon-config", () => ({
  getCanonConfig: async () => ({}),
  saveCanonConfig: async (patch: unknown) => patch,
}));
mock.module("@/lib/canon-preuves", () => ({ canonPreuves: async () => ({ references: [] }) }));
mock.module("@/lib/manga-api", () => ({ chercherPlanches: async () => [] }));
mock.module("@/lib/admin-lab", () => ({
  sendAdminLabMessage: async () => ({ id: "m1", ok: true }),
}));

const evalSamples: number[] = [];
mock.module("@/lib/ia-cockpit-server", () => ({
  CockpitActionError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  currentRagBackend: () => ({ value: "local", raw: null, engine: "Bot Shenron (index local)" }),
  createIaCockpitFetchers: () => ({}),
  runAphrodyOcr: async () => ({}),
  searchConfiguredRag: async () => {
    throw new Error("Retrieval requires admin-ia-rag-live.test.ts");
  },
  evaluateConfiguredRag: async (samples: number) => {
    evalSamples.push(samples);
    throw new Error("Evaluation requires admin-ia-rag-live.test.ts");
  },
  botCockpit: {},
}));
mock.module("@/lib/ia-cockpit", () => ({
  collectIaCockpit: async () => ({ sources: {} }),
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  probeSource: async () => ({ status: "ok", data: null }),
}));

const {
  iaAccess,
  parseEvalSamples,
  readJsonObject,
  requireIaAdmin,
  EVAL_DEFAULT_SAMPLES,
  EVAL_MAX_SAMPLES,
} = await import("../src/lib/ia-aphrody");
const { GET, POST } = await import("../src/app/api/admin/ia/route");
const { NextRequest } = await import("next/server");

function account(id: string, username: string, roleAdmin: boolean): CurrentUser {
  const user: SiteUser = {
    id,
    discordId: `d-${id}`,
    username,
    avatar: null,
    roleAdmin,
    createdAt: new Date(0),
  };
  return { sessionUserId: `s-${id}`, discordId: user.discordId, user };
}

const admin = account("u1", "Admin", true);
const member = account("u2", "Membre", false);
const unlinked: CurrentUser = { sessionUserId: "s-u3", discordId: "", user: null };

function post(body: BodyInit | null) {
  return POST(
    new NextRequest("http://site.test/api/admin/ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

function readBody(body: string) {
  return readJsonObject(new Request("http://site.test/", { method: "POST", body }));
}

beforeEach(() => {
  me = admin;
  evalSamples.length = 0;
});

describe("iaAccess", () => {
  test("sépare session absente, compte non admin et administrateur", () => {
    expect(iaAccess(null)).toBe("unauthenticated");
    expect(iaAccess(member)).toBe("forbidden");
    expect(iaAccess(unlinked)).toBe("forbidden");
    expect(iaAccess(admin)).toBe("ok");
  });

  test("requireIaAdmin renvoie la réponse de refus ou l'utilisateur", async () => {
    me = null;
    const refused = await requireIaAdmin();
    expect(refused.ok).toBe(false);
    me = admin;
    const allowed = await requireIaAdmin();
    expect(allowed.ok && allowed.me.user.id).toBe("u1");
  });
});

describe("/api/admin/ia — accès", () => {
  test("session absente : 401 avec défi Bearer et sans cache", async () => {
    me = null;
    for (const res of [
      await GET(),
      await post(JSON.stringify({ action: "create_goal", title: "x" })),
    ]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect((await res.json()).error).toContain("Session requise");
    }
  });

  test("compte non administrateur : 403, y compris un compte pas encore lié", async () => {
    for (const refused of [member, unlinked]) {
      me = refused;
      for (const res of [
        await GET(),
        await post(JSON.stringify({ action: "create_goal", title: "x" })),
      ]) {
        expect(res.status).toBe(403);
        expect(res.headers.get("www-authenticate")).toBeNull();
        expect((await res.json()).error).toBe("Accès réservé aux administrateurs.");
      }
    }
  });

  test("administrateur : GET 200", async () => {
    expect((await GET()).status).toBe(200);
  });
});

describe("/api/admin/ia — corps", () => {
  test("un corps JSON null, tableau ou illisible donne 400 et non 500", async () => {
    for (const body of ["null", "[]", "42", '"x"', "{pas du json"]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Action non reconnue.");
    }
  });

  test("readJsonObject ne renvoie que des objets", async () => {
    expect(await readBody('{"action":"a"}')).toEqual({ action: "a" });
    expect(await readBody("null")).toEqual({});
    expect(await readBody("[1]")).toEqual({});
    expect(await readBody("pas du json")).toEqual({});
  });
});

describe("evaluate_rag — samples", () => {
  test("parseEvalSamples : défaut, 0 = tout, plafond, refus du reste", () => {
    expect(parseEvalSamples(undefined)).toBe(EVAL_DEFAULT_SAMPLES);
    expect(parseEvalSamples(null)).toBe(EVAL_DEFAULT_SAMPLES);
    expect(parseEvalSamples(0)).toBe(0);
    expect(parseEvalSamples(3)).toBe(3);
    expect(parseEvalSamples("7")).toBe(7);
    expect(parseEvalSamples(5_000)).toBe(EVAL_MAX_SAMPLES);
    for (const bad of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "",
      "  ",
      "abc",
      true,
      [],
      {},
    ]) {
      expect(parseEvalSamples(bad)).toBeNull();
    }
  });

  test("la route refuse une taille invalide au lieu de lancer tout le jeu doré", async () => {
    for (const samples of [-3, 2.5, "abc", "", true]) {
      const res = await post(JSON.stringify({ action: "evaluate_rag", samples }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("samples");
    }
    expect(evalSamples).toEqual([]);
  });
});

// A throwaway token of the minimum length: never a real credential.
const FAKE_TOKEN = "fake-token-".padEnd(48, "x");
const BASE = new URL(`http://${["127", "0", "0", "1"].join(".")}:18789`);

function chatSetup(modelId: string) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchStub = (async (_input: Request | URL | string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ answer: "Parle, mortel.", model: "serveur-defaut" }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const compute = createAphrodyCompute({ baseUrl: BASE, token: FAKE_TOKEN }, { fetch: fetchStub });
  return { bodies, model: createAphrodyChatModel(compute, { modelId }) };
}

describe("createAphrodyChatModel — identifiant de modèle", () => {
  test("un identifiant vide n'envoie aucun model et laisse Aphrody choisir", async () => {
    for (const blank of ["", "   "]) {
      const { bodies, model } = chatSetup(blank);
      const result = await generateText({ model, prompt: "Salut", maxRetries: 0 });
      expect(result.text).toBe("Parle, mortel.");
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).not.toHaveProperty("model");
      expect(result.response.modelId).toBe("serveur-defaut");
    }
  });

  test("un identifiant renseigné est envoyé sans espaces de bord", async () => {
    const { bodies, model } = chatSetup(" gemini-web/flash ");
    await generateText({ model, prompt: "Salut", maxRetries: 0 });
    expect(bodies[0]?.model).toBe("gemini-web/flash");
  });
});

describe("createAphrodyChatModel — réglages ignorés", () => {
  test("aucun avertissement quand rien n'est demandé", async () => {
    const { model } = chatSetup("gemini-web/flash");
    const result = await generateText({ model, prompt: "Salut", maxRetries: 0 });
    expect(result.warnings ?? []).toEqual([]);
  });

  test("temperature, maxOutputTokens et format JSON sont signalés, pas envoyés", async () => {
    const { bodies, model } = chatSetup("gemini-web/flash");
    const result = await generateText({
      model,
      prompt: "Salut",
      temperature: 0.2,
      maxOutputTokens: 64,
      maxRetries: 0,
    });
    expect(result.warnings?.map((w) => (w.type === "unsupported" ? w.feature : w.type))).toEqual([
      "maxOutputTokens",
      "temperature",
    ]);
    expect(Object.keys(bodies[0] ?? {}).toSorted()).toEqual(["messages", "model"]);

    const streamed = streamText({ model, prompt: "Salut", temperature: 0.2, maxRetries: 0 });
    expect(await streamed.text).toBe("Parle, mortel.");
    expect(
      (await streamed.warnings)?.map((w) => (w.type === "unsupported" ? w.feature : w.type)),
    ).toEqual(["temperature"]);

    expect(
      ignoredSettingWarnings({
        prompt: [],
        responseFormat: { type: "json" },
        stopSequences: [],
      }).map((w) => (w.type === "unsupported" ? w.feature : w.type)),
    ).toEqual(["responseFormat"]);
    expect(ignoredSettingWarnings({ prompt: [], responseFormat: { type: "text" } })).toEqual([]);
  });
});
