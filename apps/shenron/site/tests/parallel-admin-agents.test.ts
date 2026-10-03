/**
 * Lot admin agents et A2A.
 *
 * - `/admin/agents` : une lecture PostgreSQL en échec n'est plus rendue comme une liste vide.
 * - `/admin/a2a` : la console passe par `/api/admin/a2a` (session admin), jamais par `/api/a2a` qui
 *   exige un Bearer sous `SHENRON_A2A_ENFORCE` ; scrutation sans requêtes concurrentes ni onglet masqué.
 *
 * L'amont A2A est un serveur Bun local éphémère : aucun ordre n'atteint un vrai pair ni Discord.
 * Aucun test de retrieval ici, donc pas de RAG.
 */
// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { A2A_ENFORCE_ENV, A2A_TOKEN_ENV } from "@shenron/auth/a2a";
import { A2A_TARGETS } from "@shenron/pipeline/aphrody/a2a";
import type { AgentAuditView, AgentKeyView } from "@shenron/db/repos/agent-keys";
import * as view from "../src/app/admin/a2a/a2a-view";
import { describeLoadFailure, loadSource } from "../src/app/admin/agents/agents-load";

mock.module("server-only", () => ({}));

let currentUser: unknown = null;
let sessionCalls = 0;
let requireAdminError: unknown = null;
mock.module("@/lib/session", () => ({
  getCurrentUser: async () => {
    sessionCalls++;
    return currentUser;
  },
  requireAdmin: async () => {
    if (requireAdminError) throw requireAdminError;
    return currentUser;
  },
}));

let keysImpl: () => Promise<AgentKeyView[]> = async () => [];
let auditImpl: (limit: number) => Promise<AgentAuditView[]> = async () => [];
let revokeImpl: (id: string) => Promise<boolean> = async () => true;
let scopesImpl: (id: string, scopes: string[]) => Promise<boolean> = async () => true;
mock.module("@/lib/agent-keys", () => ({
  listAgentKeys: () => keysImpl(),
  listAgentAudit: (limit: number) => auditImpl(limit),
  createAgentKey: async () => ({ token: "unused", name: "unused", prefix: "unused" }),
  revokeAgentKey: (id: string) => revokeImpl(id),
  updateAgentKeyScopes: (id: string, scopes: string[]) => scopesImpl(id, scopes),
  parseScopes: (scopes: string[]) => scopes,
}));
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
const revalidated: string[] = [];
mock.module("next/cache", () => ({
  revalidatePath: (path: string) => void revalidated.push(path),
}));

// ---------------------------------------------------------------------------
// Amont A2A simulé
// ---------------------------------------------------------------------------

interface UpstreamCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}
const upstreamCalls: UpstreamCall[] = [];
let upstreamMode: "ok" | "rpc-error" | "http-500" = "ok";
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => null) : null;
    upstreamCalls.push({
      method: req.method,
      path: pathname,
      authorization: req.headers.get("authorization"),
      body,
    });
    if (upstreamMode === "http-500")
      return Response.json({ error: "disk /srv/coord full" }, { status: 500 });
    if (pathname === "/coord") {
      return new Response(
        [
          JSON.stringify({
            id: "e1",
            from: "codex",
            to: "claude",
            kind: "ask",
            topic: "t",
            body: "b",
            ts: "2026-10-03T10:00:00Z",
          }),
          "not-json",
          JSON.stringify({ from: "no-id" }),
          JSON.stringify(["array"]),
          JSON.stringify({ id: "e2", from: "agy", to: 7, kind: "ack", body: { nested: true } }),
        ].join("\n"),
      );
    }
    if (pathname === "/msg")
      return Response.json({ ok: true, id: (body as { id?: string } | null)?.id ?? "x" });
    if (upstreamMode === "rpc-error") {
      return Response.json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "mailbox: /home/aphro/.coord/outbox.jsonl permission denied",
        },
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: (body as { id?: unknown } | null)?.id ?? null,
      result: { status: "queued", envelope: { id: "env-abcd1234" }, ack: { id: "env-ack" } },
    });
  },
});
const savedUrl = process.env.APHRODY_A2A_URL;
process.env.APHRODY_A2A_URL = `http://127.0.0.1:${upstream.port}/`;
afterAll(() => {
  upstream.stop(true);
  if (savedUrl === undefined) delete process.env.APHRODY_A2A_URL;
  else process.env.APHRODY_A2A_URL = savedUrl;
});

const A2A_TOKEN = "site-a2a-token-0123456789abcdef";
const savedEnv = { enforce: process.env[A2A_ENFORCE_ENV], token: process.env[A2A_TOKEN_ENV] };
const quietError = console.error;
const quietWarn = console.warn;
let errorLogs: unknown[][] = [];

beforeEach(() => {
  upstreamCalls.length = 0;
  upstreamMode = "ok";
  sessionCalls = 0;
  currentUser = { sessionUserId: "s1", discordId: "1", user: { id: "u1", roleAdmin: true } };
  requireAdminError = null;
  keysImpl = async () => [];
  auditImpl = async () => [];
  revokeImpl = async () => true;
  scopesImpl = async () => true;
  errorLogs = [];
  revalidated.length = 0;
  console.error = (...args: unknown[]) => {
    errorLogs.push(args);
  };
  console.warn = () => {};
  process.env[A2A_ENFORCE_ENV] = "1";
  process.env[A2A_TOKEN_ENV] = A2A_TOKEN;
});
afterEach(() => {
  console.error = quietError;
  console.warn = quietWarn;
  for (const [name, value] of [
    [A2A_ENFORCE_ENV, savedEnv.enforce],
    [A2A_TOKEN_ENV, savedEnv.token],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const adminRoute = await import("../src/app/api/admin/a2a/route");
const { GET, POST } = adminRoute;

// ---------------------------------------------------------------------------
// Contrat et logique d'affichage de la console A2A
// ---------------------------------------------------------------------------

const reject = (raw: unknown) => {
  const parsed = view.parseDispatchBody(raw);
  return parsed.ok ? "ok" : parsed.error;
};

describe("contrat des ordres admin", () => {
  test("les cibles de la console sont exactement celles du hub (anti-dérive)", () => {
    expect(view.A2A_ADMIN_TARGETS.map((target) => target.id).toSorted()).toEqual(
      A2A_TARGETS.toSorted(),
    );
  });

  test("accepte un ordre valide et ne garde que cible, nature et instruction nettoyée", () => {
    const parsed = view.parseDispatchBody({
      target: "codex",
      kind: "fact",
      instruction: "  état du lot  ",
      sourceAgent: "usurpé",
      method: "CancelTask",
      yolo: false,
    });
    expect(parsed).toEqual({
      ok: true,
      body: { target: "codex", kind: "fact", instruction: "état du lot" },
    });
  });

  test("rejette corps, cible, nature et instruction invalides", () => {
    expect(reject(null)).toBe("invalid_body");
    expect(reject([])).toBe("invalid_body");
    expect(reject({ target: "constructor", kind: "ask", instruction: "x" })).toBe("invalid_target");
    expect(reject({ target: "ocr", kind: "error", instruction: "x" })).toBe("invalid_kind");
    expect(reject({ target: "ocr", kind: "ask", instruction: 12 })).toBe("invalid_instruction");
    expect(reject({ target: "ocr", kind: "ask", instruction: "   " })).toBe("invalid_instruction");
    expect(
      reject({
        target: "ocr",
        kind: "ask",
        instruction: "x".repeat(view.A2A_INSTRUCTION_MAX_CHARS + 1),
      }),
    ).toBe("invalid_instruction");
    expect(
      reject({
        target: "ocr",
        kind: "ask",
        instruction: "x".repeat(view.A2A_INSTRUCTION_MAX_CHARS),
      }),
    ).toBe("ok");
  });

  test("une ligne de boîte aux lettres illisible n'est pas une enveloppe", () => {
    expect(view.normalizeEnvelope(null)).toBeNull();
    expect(view.normalizeEnvelope([])).toBeNull();
    expect(view.normalizeEnvelope({ from: "x" })).toBeNull();
    expect(view.normalizeEnvelope({ id: "e", from: "" })).toBeNull();
    expect(
      view.normalizeEnvelope({ id: "e", from: "codex", to: 7, body: { a: 1 }, re: "e0", v: 1 }),
    ).toEqual({
      v: 1,
      ts: "",
      id: "e",
      from: "codex",
      to: "",
      kind: "",
      topic: "",
      body: "",
      re: "e0",
    });
  });

  test("l'heure d'une enveloppe n'affiche jamais « Invalid Date »", () => {
    expect(view.formatEnvelopeTime("pas une date")).toBe("—");
    expect(view.formatEnvelopeTime("")).toBe("—");
    expect(view.formatEnvelopeTime("2026-10-03T10:00:00Z")).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("états d'échec de la console A2A", () => {
  test("session expirée et droits refusés sont terminaux : inutile de relancer la scrutation", () => {
    expect(view.describeA2AFailure(401)).toMatchObject({ kind: "unauthenticated", terminal: true });
    expect(view.describeA2AFailure(403, "agent_key_not_allowed")).toMatchObject({
      kind: "forbidden",
      terminal: true,
    });
  });

  test("hub injoignable, hub en erreur, ordre refusé et erreur serveur se distinguent", () => {
    expect(view.describeA2AFailure(502, "a2a_upstream_unreachable")).toMatchObject({
      kind: "upstream",
      terminal: false,
    });
    expect(view.describeA2AFailure(502, "a2a_upstream_error").text).toContain("erreur");
    expect(view.describeA2AFailure(502, "a2a_upstream_rejected")).toMatchObject({
      kind: "rejected",
    });
    expect(view.describeA2AFailure(400, "invalid_target")).toMatchObject({ kind: "rejected" });
    expect(view.describeA2AFailure(500)).toEqual({
      kind: "server",
      text: "Erreur serveur (HTTP 500).",
      terminal: false,
    });
    expect(view.describeA2ANetworkFailure().kind).toBe("network");
    expect(view.describeA2AUnreadable().kind).toBe("server");
  });

  test("le texte affiché ne reprend jamais un message amont", () => {
    const failure = view.describeA2AFailure(
      502,
      "connect ECONNREFUSED 127.0.0.1:8788 /home/aphro/.coord",
    );
    expect(failure.text).not.toMatch(/127\.0\.0\.1|\/home\/|ECONNREFUSED/);
  });
});

// ---------------------------------------------------------------------------
// Scrutation séquentielle
// ---------------------------------------------------------------------------

class FakeTimers {
  private next = 1;
  readonly pending = new Map<number, { callback: () => void; ms: number }>();
  readonly delays: number[] = [];
  set = (callback: () => void, ms: number): number => {
    const id = this.next++;
    this.pending.set(id, { callback, ms });
    this.delays.push(ms);
    return id;
  };
  clear = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };
  /** Déclenche la minuterie en attente (il n'y en a jamais plus d'une). */
  fire(): void {
    const [id, entry] = [...this.pending.entries()][0] ?? [];
    if (id === undefined || !entry) throw new Error("aucune minuterie en attente");
    this.pending.delete(id);
    entry.callback();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  // Laisse les microtâches du poller se vider ; l'ordre séquentiel est le but.
  for (let i = 0; i < 5; i++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- cession volontaire, une microtâche à la fois
    await Promise.resolve();
  }
};

function makePoller(
  outcomes: Array<view.PollOutcome | "throw"> | ((call: number) => Promise<view.PollOutcome>),
) {
  const timers = new FakeTimers();
  let visible = true;
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const signals: AbortSignal[] = [];
  const poller = view.createSequentialPoller({
    intervalMs: 3000,
    maxIntervalMs: 30_000,
    isVisible: () => visible,
    timers,
    run: async (signal) => {
      signals.push(signal);
      const call = ++calls;
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (typeof outcomes === "function") return await outcomes(call);
        const outcome = outcomes[Math.min(call - 1, outcomes.length - 1)] ?? "ok";
        if (outcome === "throw") throw new Error("boom");
        return outcome;
      } finally {
        active--;
      }
    },
  });
  return {
    poller,
    timers,
    signals,
    setVisible: (next: boolean) => {
      visible = next;
      poller.setVisible(next);
    },
    stats: () => ({ calls, maxActive }),
  };
}

describe("scrutation de la console A2A", () => {
  test("planifie la requête suivante seulement après la fin de la précédente", async () => {
    const gate = deferred<view.PollOutcome>();
    const ctx = makePoller(() => gate.promise);
    ctx.poller.start();
    await flush();
    expect(ctx.stats().calls).toBe(1);
    expect(ctx.timers.pending.size).toBe(0);
    gate.resolve("ok");
    await flush();
    expect(ctx.timers.delays).toEqual([3000]);
    ctx.timers.fire();
    await flush();
    expect(ctx.stats()).toEqual({ calls: 2, maxActive: 1 });
    ctx.poller.stop();
  });

  test("refresh pendant une requête en vol ne lance pas de requête parallèle : une seule relance suit", async () => {
    const gates = [deferred<view.PollOutcome>(), deferred<view.PollOutcome>()];
    const ctx = makePoller((call) => gates[call - 1]!.promise);
    ctx.poller.start();
    await flush();
    void ctx.poller.refresh();
    void ctx.poller.refresh();
    void ctx.poller.refresh();
    await flush();
    expect(ctx.stats().calls).toBe(1);
    gates[0]!.resolve("ok");
    await flush();
    expect(ctx.stats().calls).toBe(2);
    expect(ctx.timers.pending.size).toBe(0);
    gates[1]!.resolve("ok");
    await flush();
    expect(ctx.stats()).toEqual({ calls: 2, maxActive: 1 });
    expect(ctx.timers.pending.size).toBe(1);
    ctx.poller.stop();
  });

  test("onglet masqué : aucune requête au démarrage, aucune minuterie, reprise immédiate au retour", async () => {
    const ctx = makePoller(["ok"]);
    ctx.setVisible(false);
    ctx.poller.start();
    await flush();
    expect(ctx.stats().calls).toBe(0);
    expect(ctx.timers.pending.size).toBe(0);
    ctx.setVisible(true);
    await flush();
    expect(ctx.stats().calls).toBe(1);
    expect(ctx.timers.pending.size).toBe(1);
    ctx.setVisible(false);
    expect(ctx.timers.pending.size).toBe(0);
    ctx.poller.stop();
  });

  test("une requête qui se termine onglet masqué ne planifie rien", async () => {
    const gate = deferred<view.PollOutcome>();
    const ctx = makePoller(() => gate.promise);
    ctx.poller.start();
    await flush();
    ctx.setVisible(false);
    gate.resolve("ok");
    await flush();
    expect(ctx.timers.pending.size).toBe(0);
    ctx.setVisible(true);
    await flush();
    expect(ctx.stats().calls).toBe(2);
    ctx.poller.stop();
  });

  test("une relance mise en file attend le retour de l'onglet visible", async () => {
    const gate = deferred<view.PollOutcome>();
    const ctx = makePoller((call) => (call === 1 ? gate.promise : Promise.resolve("ok")));
    ctx.poller.start();
    await flush();
    void ctx.poller.refresh();
    ctx.setVisible(false);
    gate.resolve("ok");
    await flush();
    expect(ctx.stats().calls).toBe(1);
    expect(ctx.timers.pending.size).toBe(0);
    ctx.setVisible(true);
    await flush();
    expect(ctx.stats()).toEqual({ calls: 2, maxActive: 1 });
    ctx.poller.stop();
  });

  test("les échecs consécutifs espacent les requêtes jusqu'au plafond, un succès remet l'intervalle", async () => {
    const ctx = makePoller(["error", "throw", "error", "error", "error", "error", "ok", "ok"]);
    ctx.poller.start();
    await flush();
    for (let i = 0; i < 7; i++) {
      ctx.timers.fire();
      // oxlint-disable-next-line eslint/no-await-in-loop -- chaque minuterie doit se résoudre avant la suivante
      await flush();
    }
    expect(ctx.timers.delays).toEqual([6000, 12_000, 24_000, 30_000, 30_000, 30_000, 3000, 3000]);
    ctx.poller.stop();
  });

  test("un échec terminal arrête la scrutation, un refresh manuel la relance", async () => {
    const ctx = makePoller(["halt", "ok"]);
    ctx.poller.start();
    await flush();
    expect(ctx.stats().calls).toBe(1);
    expect(ctx.timers.pending.size).toBe(0);
    await ctx.poller.refresh();
    expect(ctx.stats().calls).toBe(2);
    expect(ctx.timers.pending.size).toBe(1);
    ctx.poller.stop();
  });

  test("stop annule la requête en vol et n'en replanifie aucune", async () => {
    const gate = deferred<view.PollOutcome>();
    const ctx = makePoller(() => gate.promise);
    ctx.poller.start();
    await flush();
    ctx.poller.stop();
    expect(ctx.signals[0]?.aborted).toBe(true);
    gate.resolve("ok");
    await flush();
    expect(ctx.timers.pending.size).toBe(0);
    await ctx.poller.refresh();
    expect(ctx.stats().calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Route admin
// ---------------------------------------------------------------------------

const BASE = "https://dragonballfr.com/api/admin/a2a";

function adminPost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/admin/a2a : garde", () => {
  test("anonyme : 401 ; compte non admin : 403 ; aucun appel amont dans les deux cas", async () => {
    currentUser = null;
    const anonymous = await GET(new Request(BASE));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });
    expect((await POST(adminPost({ target: "ocr", kind: "ask", instruction: "x" }))).status).toBe(
      401,
    );

    currentUser = { sessionUserId: "s2", discordId: "2", user: { id: "u2", roleAdmin: false } };
    const member = await GET(new Request(BASE));
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({ error: "forbidden" });
    expect((await POST(adminPost({ target: "ocr", kind: "ask", instruction: "x" }))).status).toBe(
      403,
    );

    currentUser = { sessionUserId: "s3", discordId: "", user: null };
    expect((await GET(new Request(BASE))).status).toBe(403);
    expect(upstreamCalls).toEqual([]);
  });

  test("une clé d'agent est refusée avant toute lecture de session, même si elle élèverait en admin", async () => {
    const headers = { authorization: "Bearer dbfr_agent_0123456789abcdef" };
    const read = await GET(new Request(BASE, { headers }));
    expect(read.status).toBe(403);
    expect(await read.json()).toEqual({ error: "agent_key_not_allowed" });
    const write = await POST(adminPost({ target: "ocr", kind: "ask", instruction: "x" }, headers));
    expect(write.status).toBe(403);
    expect(sessionCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  test("écriture : requête inter-sites et corps non JSON déclaré refusés, même avec une session admin", async () => {
    const order = { target: "ocr", kind: "ask", instruction: "x" };
    const crossSite = await POST(adminPost(order, { "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "cross_site_denied" });
    const sameSite = await POST(adminPost(order, { "sec-fetch-site": "same-site" }));
    expect(sameSite.status).toBe(403);
    const plain = await POST(adminPost(order, { "content-type": "text/plain" }));
    expect(plain.status).toBe(415);
    expect(upstreamCalls).toEqual([]);
    const ok = await POST(adminPost(order, { "sec-fetch-site": "same-origin" }));
    expect(ok.status).toBe(200);
  });

  test("les réponses ne sont jamais mises en cache et n'ouvrent pas de CORS", async () => {
    const res = await GET(new Request(BASE));
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("/api/admin/a2a : sous SHENRON_A2A_ENFORCE, sans jeton côté navigateur", () => {
  test("la boîte aux lettres se lit avec la seule session ; aucun Bearer n'est envoyé à l'amont ni renvoyé", async () => {
    const res = await GET(new Request(BASE));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      envelopes: Array<Record<string, unknown>>;
      total: number;
      fetchedAt: string;
    };
    expect(body.total).toBe(2);
    expect(body.envelopes.map((envelope) => envelope.id)).toEqual(["e1", "e2"]);
    expect(body.envelopes[1]).toMatchObject({
      id: "e2",
      from: "agy",
      to: "",
      kind: "ack",
      body: "",
    });
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
    expect(text).not.toContain(A2A_TOKEN);
    expect(upstreamCalls).toEqual([
      { method: "GET", path: "/coord", authorization: null, body: null },
    ]);

    // Le même appel sur la route publique est refusé : c'était le défaut de la console.
    const { GET: publicGet } = await import("../src/app/api/a2a/route");
    expect(
      (await publicGet(new Request("https://dragonballfr.com/api/a2a?envelopes=1"))).status,
    ).toBe(401);
  });

  test("ask : message/send avec émetteur et mode fixés côté serveur, champs usurpés ignorés", async () => {
    const res = await POST(
      adminPost({
        target: "claude",
        kind: "ask",
        instruction: "  lance le contrôle  ",
        sourceAgent: "usurpé",
        method: "CancelTask",
        yolo: false,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: "env-abcd1234",
      kind: "ask",
      target: "claude",
    });
    expect(upstreamCalls).toHaveLength(1);
    const call = upstreamCalls[0]!;
    expect(call).toMatchObject({ method: "POST", path: "/a2a", authorization: null });
    expect(call.body).toMatchObject({
      jsonrpc: "2.0",
      method: "message/send",
      params: {
        target: "claude",
        sourceAgent: "admin-ui",
        instruction: "lance le contrôle",
        yolo: true,
      },
    });
  });

  test("fact et ping partent en enveloppe .coord avec la nature choisie (le sélecteur n'est plus ignoré)", async () => {
    for (const kind of ["fact", "ping"] as const) {
      upstreamCalls.length = 0;
      // oxlint-disable-next-line eslint/no-await-in-loop -- upstreamCalls est partagé : un envoi à la fois
      const res = await POST(adminPost({ target: "ocr", kind, instruction: "statut" }));
      expect(res.status).toBe(200);
      // oxlint-disable-next-line eslint/no-await-in-loop -- idem
      const body = (await res.json()) as { ok: boolean; id: string };
      expect(body.ok).toBe(true);
      expect(body.id).toMatch(/^env-[0-9a-f]{8}$/);
      expect(upstreamCalls).toHaveLength(1);
      expect(upstreamCalls[0]).toMatchObject({ method: "POST", path: "/msg" });
      expect(upstreamCalls[0]!.body).toMatchObject({
        v: 1,
        id: body.id,
        from: "admin-ui",
        to: "ocr",
        kind,
        topic: `admin.${kind}`,
        body: "statut",
      });
    }
  });

  test("corps invalide : 400 sans appel amont", async () => {
    expect((await POST(adminPost("{"))).status).toBe(400);
    const badTarget = await POST(adminPost({ target: "ghost", kind: "ask", instruction: "x" }));
    expect(badTarget.status).toBe(400);
    expect(await badTarget.json()).toEqual({ error: "invalid_target" });
    expect((await POST(adminPost({ target: "ocr", kind: "ask", instruction: "" }))).status).toBe(
      400,
    );
    expect(upstreamCalls).toEqual([]);
  });
});

describe("/api/admin/a2a : pannes amont", () => {
  test("hub injoignable : 502 a2a_upstream_unreachable sans adresse ni message interne", async () => {
    const saved = process.env.APHRODY_A2A_URL;
    process.env.APHRODY_A2A_URL = "http://127.0.0.1:1";
    try {
      for (const res of [
        await GET(new Request(BASE)),
        await POST(adminPost({ target: "ocr", kind: "ask", instruction: "x" })),
      ]) {
        expect(res.status).toBe(502);
        // oxlint-disable-next-line eslint/no-await-in-loop -- deux réponses, lecture ordonnée
        const text = await res.text();
        expect(JSON.parse(text)).toMatchObject({
          error: "a2a_upstream_unreachable",
          upstreamStatus: 502,
        });
        expect(text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|connect/i);
      }
      expect(errorLogs.length).toBe(2);
    } finally {
      process.env.APHRODY_A2A_URL = saved;
    }
  });

  test("amont en HTTP 500 : 502 a2a_upstream_error, le corps amont n'est pas relayé", async () => {
    upstreamMode = "http-500";
    const read = await GET(new Request(BASE));
    expect(read.status).toBe(502);
    const text = await read.text();
    expect(JSON.parse(text)).toEqual({ error: "a2a_upstream_error", upstreamStatus: 500 });
    expect(text).not.toContain("/srv/coord");
    const write = await POST(adminPost({ target: "ocr", kind: "fact", instruction: "x" }));
    expect(write.status).toBe(502);
    expect(await write.json()).toEqual({ error: "a2a_upstream_error", upstreamStatus: 500 });
  });

  test("erreur JSON-RPC du pont (HTTP 200 amont) : 502 a2a_upstream_rejected avec le seul code", async () => {
    upstreamMode = "rpc-error";
    const res = await POST(adminPost({ target: "ocr", kind: "ask", instruction: "x" }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "a2a_upstream_rejected", rpcCode: -32603 });
    expect(text).not.toContain("/home/aphro");
    expect(errorLogs.some((entry) => JSON.stringify(entry).includes("permission denied"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Sources du composant A2A
// ---------------------------------------------------------------------------

const readSource = (relative: string) =>
  Bun.file(new URL(`../src/${relative}`, import.meta.url)).text();
/** Le code sans ses commentaires : une phrase qui cite `/api/a2a` n'est pas un appel à `/api/a2a`. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("A2AViewer", () => {
  test("n'appelle plus /api/a2a, ne manipule aucun jeton et ne scrute plus par setInterval", async () => {
    const source = withoutComments(await readSource("app/admin/a2a/A2AViewer.tsx"));
    expect(source).not.toMatch(/["'`]\/api\/a2a(?:[?"'`])/);
    expect(source).toContain("/api/admin/a2a");
    expect(source).not.toMatch(/SHENRON_A2A|NEXT_PUBLIC|setInterval/);
    expect(source).toContain("visibilitychange");
    expect(source).not.toContain("sourceAgent");
  });

  test("rend l'état initial sans enveloppe fictive : chargement, compteur inconnu, aucune liste vide affirmée", async () => {
    const { A2AViewer } = await import("../src/app/admin/a2a/A2AViewer");
    const html = renderToStaticMarkup(createElement(A2AViewer));
    expect(html).toContain("Chargement des enveloppes A2A");
    expect(html).not.toContain("Aucune enveloppe A2A enregistrée");
    expect(html).toContain(">—<");
    for (const target of view.A2A_ADMIN_TARGETS) expect(html).toContain(`value="${target.id}"`);
  });
});

// ---------------------------------------------------------------------------
// /admin/agents
// ---------------------------------------------------------------------------

const keyFixture: AgentKeyView = {
  id: "k1",
  name: "Rédacteur Daima",
  prefix: "dbfr_agent_ab12",
  scopes: ["read", "write:articles"],
  note: null,
  createdBy: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  rateLimitPerHour: null,
  calls24h: 3,
};
const auditFixture: AgentAuditView = {
  id: 1,
  keyName: "Rédacteur Daima",
  method: "POST",
  path: "/api/agent/v1/comments",
  status: 201,
  summary: "commentaire créé",
  createdAt: "2026-10-03T09:00:00.000Z",
};
const dbDown = () =>
  Object.assign(new Error("connect ECONNREFUSED postgres://admin:s3cret@10.0.0.5:5432/shenron"), {
    code: "ECONNREFUSED",
  });

async function renderAgentsPage(): Promise<string> {
  const { default: AdminAgentsPage } = await import("../src/app/admin/agents/page");
  return renderToStaticMarkup(await AdminAgentsPage());
}

describe("lecture d'une source /admin/agents", () => {
  test("une lecture réussie garde ses données, y compris une liste vide légitime", async () => {
    expect(await loadSource("clés", async () => [])).toEqual({ ok: true, data: [] });
    expect(await loadSource("clés", async () => [keyFixture])).toEqual({
      ok: true,
      data: [keyFixture],
    });
  });

  test("un échec reste un échec : journalisé en détail, code court seul exposé", async () => {
    const logs: unknown[][] = [];
    const state = await loadSource(
      "clés",
      () => Promise.reject(dbDown()),
      (...args) => logs.push(args),
    );
    expect(state).toEqual({ ok: false, code: "ECONNREFUSED" });
    expect(JSON.stringify(state)).not.toMatch(/s3cret|10\.0\.0\.5/);
    expect(logs).toHaveLength(1);
    expect(String(logs[0]![0])).toContain("clés");
  });

  test("le code se lit dans la chaîne cause (erreur du pilote enveloppée) et rien d'autre ne passe", () => {
    expect(describeLoadFailure(new Error("x", { cause: { code: "08006" } }))).toBe("08006");
    expect(
      describeLoadFailure(new Error("x", { cause: new Error("y", { cause: { code: "57P01" } }) })),
    ).toBe("57P01");
    expect(describeLoadFailure(new Error("mot de passe incorrect"))).toBeNull();
    expect(describeLoadFailure({ code: "has spaces and a secret" })).toBeNull();
    expect(describeLoadFailure("texte")).toBeNull();
    expect(describeLoadFailure(null)).toBeNull();
  });
});

describe("page /admin/agents", () => {
  test("PostgreSQL injoignable : état d'échec et nouvelle tentative, jamais « aucune clé » ni « aucun appel »", async () => {
    keysImpl = () => Promise.reject(dbDown());
    auditImpl = () => Promise.reject(dbDown());
    const html = await renderAgentsPage();
    expect(html).toContain("Clés d&#x27;agent indisponibles");
    expect(html).toContain("Journal indisponible");
    expect(html.match(/Réessayer/g)).toHaveLength(2);
    expect(html).toContain("ECONNREFUSED");
    expect(html).not.toContain("Aucune clé");
    expect(html).not.toContain("Aucun appel pour l");
    expect(html).not.toContain("Nouvelle clé");
    expect(html).not.toMatch(/s3cret|10\.0\.0\.5|postgres:\/\//);
    expect(errorLogs.some((entry) => String(entry[1]).includes("s3cret"))).toBe(true);
  });

  test("seul le journal en panne : les clés restent gérables, le journal signale son échec", async () => {
    keysImpl = async () => [keyFixture];
    auditImpl = () => Promise.reject(dbDown());
    const html = await renderAgentsPage();
    expect(html).toContain("Rédacteur Daima");
    expect(html).toContain("Nouvelle clé");
    expect(html).toContain("Journal indisponible");
    expect(html).not.toContain("Aucun appel pour l");
    expect(html).not.toContain("Clés d&#x27;agent indisponibles");
  });

  test("seules les clés en panne : le journal reste lisible", async () => {
    keysImpl = () => Promise.reject(dbDown());
    auditImpl = async () => [auditFixture];
    const html = await renderAgentsPage();
    expect(html).toContain("Clés d&#x27;agent indisponibles");
    expect(html).toContain("/api/agent/v1/comments");
    expect(html).not.toContain("Journal indisponible");
  });

  test("données réellement vides : les états vides restent affichés", async () => {
    const html = await renderAgentsPage();
    expect(html).toContain("Aucune clé");
    expect(html).toContain("Aucun appel pour l");
    expect(html).not.toContain("indisponible");
    expect(html).not.toContain("Réessayer");
  });

  test("la page ne contient plus de repli silencieux vers une liste vide", async () => {
    const source = await readSource("app/admin/agents/page.tsx");
    expect(source).not.toMatch(/\.catch\(\s*\(\)\s*=>\s*\[\]\s*\)/);
  });
});

describe("actions des clés d'agent", () => {
  test("une panne de base devient un échec renvoyé, pas une exception côté écran", async () => {
    revokeImpl = () => Promise.reject(dbDown());
    scopesImpl = () => Promise.reject(dbDown());
    const { revokeAgentKeyAction, updateScopesAction } =
      await import("../src/app/admin/agents/_actions");
    const revoked = await revokeAgentKeyAction("k1");
    expect(revoked.ok).toBe(false);
    expect(revoked.error).toContain("réessayez");
    const scoped = await updateScopesAction("k1", ["read"]);
    expect(scoped.ok).toBe(false);
    expect(JSON.stringify([revoked, scoped])).not.toMatch(/s3cret|10\.0\.0\.5/);
    expect(errorLogs).toHaveLength(2);
    expect(revalidated).toEqual([]);
  });

  test("le refus d'accès admin (redirection) n'est jamais avalé", async () => {
    requireAdminError = new Error("NEXT_REDIRECT");
    const { revokeAgentKeyAction, updateScopesAction } =
      await import("../src/app/admin/agents/_actions");
    await expect(revokeAgentKeyAction("k1")).rejects.toThrow("NEXT_REDIRECT");
    await expect(updateScopesAction("k1", ["read"])).rejects.toThrow("NEXT_REDIRECT");
  });

  test("clé inconnue : message métier conservé", async () => {
    revokeImpl = async () => false;
    const { revokeAgentKeyAction } = await import("../src/app/admin/agents/_actions");
    expect(await revokeAgentKeyAction("absent")).toEqual({
      ok: false,
      error: "Clé inconnue ou déjà révoquée.",
    });
    expect(revalidated).toEqual(["/admin/agents"]);
  });

  test("succès : la page est invalidée et l'action répond ok", async () => {
    const { revokeAgentKeyAction, updateScopesAction } =
      await import("../src/app/admin/agents/_actions");
    expect(await revokeAgentKeyAction("k1")).toEqual({ ok: true });
    expect(await updateScopesAction("k1", ["read"])).toEqual({ ok: true });
    expect(revalidated).toEqual(["/admin/agents", "/admin/agents"]);
  });
});
