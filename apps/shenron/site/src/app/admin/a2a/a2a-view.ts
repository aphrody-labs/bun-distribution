// SPDX-License-Identifier: Apache-2.0
// Contrat navigateur ↔ `/api/admin/a2a` et logique d'affichage de la console A2A. Aucun React ni
// import serveur : `bun test` le couvre directement, A2AViewer.tsx reste un rendu mince et la route
// admin y valide ses corps de requête.

/** Cibles proposées à la console. `tests/parallel-admin-agents.test.ts` les compare à `A2A_TARGETS`. */
export const A2A_ADMIN_TARGETS = [
  { id: "ocr", label: "ocr (état mesuré ou ordre en attente d'un worker)" },
  { id: "translation", label: "translation (état mesuré de la traduction)" },
  { id: "rag", label: "rag (recherche réelle, passages et URL)" },
  { id: "subagents", label: "subagents (ordre en attente de résultat)" },
  { id: "codex", label: "codex (ordre en attente de résultat)" },
  { id: "agycli", label: "agycli (ordre en attente de résultat)" },
  { id: "claude", label: "claude (ordre en attente de résultat)" },
  { id: "local_model", label: "local_model (ordre en attente d'un worker local)" },
  { id: "broadcast", label: "broadcast (Tous les pairs)" },
] as const;

export const A2A_ADMIN_KINDS = [
  { id: "ask", label: "ask (Requête / Ordre de travail)" },
  { id: "fact", label: "fact (Information factuelle / Statut)" },
  { id: "ping", label: "ping (Sonde de vitalité heartbeat)" },
] as const;

export type A2AAdminTarget = (typeof A2A_ADMIN_TARGETS)[number]["id"];
export type A2AAdminKind = (typeof A2A_ADMIN_KINDS)[number]["id"];

/** Émetteur fixé côté serveur : le navigateur ne choisit jamais l'identité de l'ordre. */
export const A2A_ADMIN_SOURCE = "admin-ui";
export const A2A_INSTRUCTION_MAX_CHARS = 4000;

export interface A2ADispatchBody {
  target: A2AAdminTarget;
  kind: A2AAdminKind;
  instruction: string;
}

export type A2ADispatchParse =
  | { ok: true; body: A2ADispatchBody }
  | {
      ok: false;
      error: "invalid_body" | "invalid_target" | "invalid_kind" | "invalid_instruction";
    };

/** Corps d'un ordre admin : allowlist stricte, aucune clé inconnue n'atteint le hub. */
export function parseDispatchBody(raw: unknown): A2ADispatchParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "invalid_body" };
  const { target, kind, instruction } = raw as Record<string, unknown>;
  const targetId = A2A_ADMIN_TARGETS.find((entry) => entry.id === target)?.id;
  if (!targetId) return { ok: false, error: "invalid_target" };
  const kindId = A2A_ADMIN_KINDS.find((entry) => entry.id === kind)?.id;
  if (!kindId) return { ok: false, error: "invalid_kind" };
  if (typeof instruction !== "string") return { ok: false, error: "invalid_instruction" };
  const text = instruction.trim();
  if (!text || text.length > A2A_INSTRUCTION_MAX_CHARS)
    return { ok: false, error: "invalid_instruction" };
  return { ok: true, body: { target: targetId, kind: kindId, instruction: text } };
}

export interface Envelope {
  v?: number;
  ts: string;
  id: string;
  from: string;
  to: string;
  kind: string;
  topic: string;
  body: string;
  re?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Une ligne de boîte aux lettres est un JSON non fiable : sans `id` ni `from` ce n'est pas une
 * enveloppe (le contrat Rust les exige), et tout champ texte est ramené à une chaîne.
 */
export function normalizeEnvelope(raw: unknown): Envelope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id || typeof row.from !== "string" || !row.from)
    return null;
  return {
    ...(typeof row.v === "number" ? { v: row.v } : {}),
    ts: text(row.ts),
    id: row.id,
    from: row.from,
    to: text(row.to),
    kind: text(row.kind),
    topic: text(row.topic),
    body: text(row.body),
    ...(typeof row.re === "string" && row.re ? { re: row.re } : {}),
  };
}

export type A2AFailureKind =
  | "unauthenticated"
  | "forbidden"
  | "upstream"
  | "rejected"
  | "server"
  | "network";

export interface A2AFailure {
  kind: A2AFailureKind;
  text: string;
  /** Réessayer immédiatement ne sert à rien tant que l'utilisateur n'a pas agi (reconnexion, droits). */
  terminal: boolean;
}

/**
 * Transforme une réponse non 2xx de `/api/admin/a2a` en état affichable. Le texte vient du statut et
 * du code d'erreur, jamais d'un message amont : aucune adresse ni aucun chemin interne n'atteint l'écran.
 */
export function describeA2AFailure(status: number, code?: string | null): A2AFailure {
  if (status === 401) {
    return {
      kind: "unauthenticated",
      text: "Session expirée : reconnectez-vous pour reprendre la supervision A2A.",
      terminal: true,
    };
  }
  if (status === 403) {
    return {
      kind: "forbidden",
      text: "Accès refusé : cette console exige une session administrateur.",
      terminal: true,
    };
  }
  if (code === "a2a_upstream_unreachable") {
    return {
      kind: "upstream",
      text: "Hub A2A injoignable : le serveur `aphrody a2a serve` ne répond pas.",
      terminal: false,
    };
  }
  if (code === "a2a_upstream_rejected") {
    return { kind: "rejected", text: "Le hub A2A a refusé l'ordre.", terminal: false };
  }
  if (code === "a2a_upstream_error") {
    return { kind: "upstream", text: "Le hub A2A a répondu en erreur.", terminal: false };
  }
  if (status === 400 || status === 415) {
    return {
      kind: "rejected",
      text: "Ordre invalide : vérifiez la cible, la nature et l'instruction.",
      terminal: false,
    };
  }
  return { kind: "server", text: `Erreur serveur (HTTP ${status}).`, terminal: false };
}

export function describeA2ANetworkFailure(): A2AFailure {
  return {
    kind: "network",
    text: "Réseau indisponible : la requête n'a pas abouti.",
    terminal: false,
  };
}

/** Réponse 2xx dont le corps n'a pas la forme attendue (proxy intermédiaire, page HTML…). */
export function describeA2AUnreadable(): A2AFailure {
  return { kind: "server", text: "Réponse illisible du serveur.", terminal: false };
}

const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Heure d'une enveloppe ; `ts` vient d'une boîte aux lettres non fiable, jamais « Invalid Date ». */
export function formatEnvelopeTime(ts: string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "—" : timeFormat.format(date);
}

// ---------------------------------------------------------------------------
// Scrutation séquentielle
// ---------------------------------------------------------------------------

/** `ok` : planifier la suite ; `error` : planifier avec recul ; `halt` : ne rien planifier (session, droits). */
export type PollOutcome = "ok" | "error" | "halt";

export interface PollTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface PollerOptions {
  run(signal: AbortSignal): Promise<PollOutcome>;
  intervalMs: number;
  maxIntervalMs?: number;
  isVisible(): boolean;
  timers?: PollTimers;
}

export interface Poller {
  start(): void;
  /** Lance une requête maintenant ; pendant une requête en cours, une seule relance est mise en file. */
  refresh(): Promise<void>;
  setVisible(visible: boolean): void;
  stop(): void;
}

const GLOBAL_TIMERS: PollTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Chaîne de `setTimeout` plutôt qu'un `setInterval` : la requête suivante n'est planifiée qu'une fois
 * la précédente terminée, donc jamais deux en vol. Onglet masqué : rien n'est planifié, la reprise est
 * immédiate au retour. Échecs consécutifs : l'intervalle double jusqu'à `maxIntervalMs`.
 */
export function createSequentialPoller(options: PollerOptions): Poller {
  const timers = options.timers ?? GLOBAL_TIMERS;
  const maxIntervalMs = options.maxIntervalMs ?? options.intervalMs * 10;
  let timer: unknown = null;
  let inflight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let rerun = false;
  let failures = 0;
  let started = false;
  let stopped = false;

  function clearTimer(): void {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  function schedule(outcome: PollOutcome): void {
    clearTimer();
    if (stopped || !started || outcome === "halt" || !options.isVisible()) return;
    const delay = Math.min(maxIntervalMs, options.intervalMs * 2 ** failures);
    timer = timers.set(() => {
      timer = null;
      void runNow();
    }, delay);
  }

  async function settle(current: AbortController): Promise<void> {
    let outcome: PollOutcome;
    try {
      outcome = await options.run(current.signal);
    } catch {
      outcome = "error";
    }
    failures = outcome === "error" ? failures + 1 : 0;
    inflight = null;
    controller = null;
    if (stopped) return;
    const refreshQueued = rerun;
    rerun = false;
    if (refreshQueued && options.isVisible()) {
      void runNow();
      return;
    }
    schedule(outcome);
  }

  function runNow(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inflight) {
      rerun = true;
      return inflight;
    }
    clearTimer();
    const current = new AbortController();
    controller = current;
    // `settle` ne rend la main qu'à son premier `await` : `inflight` est posé avant sa fin.
    inflight = settle(current);
    return inflight;
  }

  return {
    start() {
      if (stopped || started) return;
      started = true;
      if (options.isVisible()) void runNow();
    },
    refresh: runNow,
    setVisible(visible) {
      if (stopped || !started) return;
      if (!visible) {
        clearTimer();
        return;
      }
      if (!inflight) void runNow();
    },
    stop() {
      stopped = true;
      clearTimer();
      controller?.abort();
    },
  };
}
