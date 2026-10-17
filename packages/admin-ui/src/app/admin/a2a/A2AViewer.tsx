"use client";

// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useRef, useState } from "react";
import {
  A2A_ADMIN_KINDS,
  A2A_ADMIN_TARGETS,
  createSequentialPoller,
  describeA2AFailure,
  describeA2ANetworkFailure,
  describeA2AUnreadable,
  formatEnvelopeTime,
  type A2AAdminKind,
  type A2AAdminTarget,
  type A2AFailure,
  type Envelope,
  type Poller,
} from "./a2a-view";

/**
 * Lecture et envoi passent par `/api/admin/a2a` (session admin, jeton A2A jamais côté navigateur).
 * `/api/a2a` reste la surface des pairs : sous `SHENRON_A2A_ENFORCE` elle exigerait un Bearer.
 */
const ADMIN_A2A_URL = "/api/admin/a2a";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_INTERVAL_MS = 30_000;

type SendStatus = { tone: "pending" | "ok" | "error"; text: string };

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const data: unknown = await res.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

export function A2AViewer() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [failure, setFailure] = useState<A2AFailure | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<A2AAdminTarget>("ocr");
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState<A2AAdminKind>("ask");
  const [filterPeer, setFilterPeer] = useState<string>("all");
  const [lastStatus, setLastStatus] = useState<SendStatus | null>(null);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    const poller = createSequentialPoller({
      intervalMs: POLL_INTERVAL_MS,
      maxIntervalMs: POLL_MAX_INTERVAL_MS,
      isVisible: () => document.visibilityState === "visible",
      run: async signal => {
        setSyncing(true);
        try {
          const res = await fetch(ADMIN_A2A_URL, {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          });
          const data = await readJson(res);
          if (signal.aborted) return "ok";
          if (!res.ok) {
            const next = describeA2AFailure(res.status, typeof data?.error === "string" ? data.error : null);
            setFailure(next);
            return next.terminal ? "halt" : "error";
          }
          if (!Array.isArray(data?.envelopes)) {
            setFailure(describeA2AUnreadable());
            return "error";
          }
          setEnvelopes(data.envelopes as Envelope[]);
          setLoaded(true);
          setFailure(null);
          setLastSyncAt(typeof data.fetchedAt === "string" ? data.fetchedAt : new Date().toISOString());
          return "ok";
        } catch {
          if (signal.aborted) return "ok";
          setFailure(describeA2ANetworkFailure());
          return "error";
        } finally {
          if (!signal.aborted) setSyncing(false);
        }
      },
    });
    pollerRef.current = poller;
    const onVisibilityChange = () => poller.setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    poller.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      poller.stop();
      pollerRef.current = null;
    };
  }, []);

  const retry = () => {
    void pollerRef.current?.refresh();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = instruction.trim();
    if (!text || sending) return;

    setSending(true);
    setLastStatus({
      tone: "pending",
      text: "Envoi en cours via protocole A2A...",
    });
    try {
      const res = await fetch(ADMIN_A2A_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, kind, instruction: text }),
      });
      const data = await readJson(res);
      if (res.ok && data?.ok === true) {
        const ref = typeof data.id === "string" ? ` (${data.id})` : "";
        setLastStatus({
          tone: "ok",
          text: `✓ Ordre ${kind} déposé pour ${target}${ref} : en file, aucun traitement confirmé`,
        });
        setInstruction("");
        retry();
      } else {
        const next = describeA2AFailure(res.status, typeof data?.error === "string" ? data.error : null);
        setLastStatus({ tone: "error", text: `✗ ${next.text}` });
      }
    } catch {
      setLastStatus({
        tone: "error",
        text: `✗ ${describeA2ANetworkFailure().text}`,
      });
    } finally {
      setSending(false);
    }
  };

  const filteredEnvelopes = envelopes.filter(env => {
    if (filterPeer === "all") return true;
    return env.from === filterPeer || env.to === filterPeer;
  });

  const syncedAt = lastSyncAt ? formatEnvelopeTime(lastSyncAt) : null;

  return (
    <div className="space-y-6">
      {/* En-tête Statut A2A */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-border bg-card/60">
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Protocole</span>
          <div className="text-xl font-bold mt-1 text-primary">A2A 1.0.0</div>
          <div className="text-xs text-muted-foreground mt-0.5">ai.json v1 • .coord Mailbox</div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card/60">
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Hub Principal</span>
          <div className="text-xl font-bold mt-1 text-primary">Shenron Core</div>
          {/* mcp.dragonballfr.com a été retiré le 2026-09-25 (shenron-mcp fusionné
					    dans aphrody-mcp dragonball.*, sans hôte HTTP public). */}
          <div className="text-xs text-muted-foreground mt-0.5">aphrody-mcp (dragonball.*)</div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card/60">
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Doctrine</span>
          <div className="text-xl font-bold mt-1 text-emerald-400">YOLO Zero-HITL</div>
          <div className="text-xs text-muted-foreground mt-0.5">Format Bimodal • #bot-admin</div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card/60">
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Enveloppes Actives</span>
          <div className="text-xl font-bold mt-1 text-amber-400">{loaded ? envelopes.length : "—"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {syncedAt ? `Synchronisé à ${syncedAt}` : "Canal fichier & RPC unifié"}
          </div>
        </div>
      </div>

      {/* Formulaire d'envoi d'ordres A2A */}
      <div className="p-5 rounded-xl border border-border bg-card/40 space-y-4">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <span>⚡ Console d'Ordres A2A (Dispatch Déterministe)</span>
        </h3>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Cible A2A</label>
              <select
                value={target}
                onChange={e => {
                  const next = A2A_ADMIN_TARGETS.find(entry => entry.id === e.target.value);
                  if (next) setTarget(next.id);
                }}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary"
              >
                {A2A_ADMIN_TARGETS.map(entry => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Nature de l'ordre</label>
              <select
                value={kind}
                onChange={e => {
                  const next = A2A_ADMIN_KINDS.find(entry => entry.id === e.target.value);
                  if (next) setKind(next.id);
                }}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary"
              >
                {A2A_ADMIN_KINDS.map(entry => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={sending || !instruction.trim()}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
              >
                {sending ? "Transmission en cours..." : "🚀 Émettre l'Ordre A2A"}
              </button>
            </div>
          </div>
          <div>
            <textarea
              rows={2}
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              aria-label="Instruction à transmettre"
              placeholder="Instruction technique à transmettre aux pairs A2A..."
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary"
            />
          </div>
          {lastStatus && (
            <div
              role={lastStatus.tone === "error" ? "alert" : "status"}
              className={`text-xs font-mono p-2 rounded ${lastStatus.tone === "ok" ? "text-emerald-400 bg-emerald-950/40" : "text-amber-400 bg-amber-950/40"}`}
            >
              {lastStatus.text}
            </div>
          )}
        </form>
      </div>

      {/* Visualiseur de flux A2A UI */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <span>📡 Flux des Enveloppes A2A (.coord)</span>
            {loaded && <span className="text-xs text-muted-foreground">({filteredEnvelopes.length} messages)</span>}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filtrer par pair :</span>
            <select
              value={filterPeer}
              onChange={e => setFilterPeer(e.target.value)}
              aria-label="Filtrer par pair"
              className="bg-background border border-input rounded px-2 py-1 text-xs"
            >
              <option value="all">Tous les pairs</option>
              <option value="codex">codex</option>
              <option value="agycli">agycli</option>
              <option value="claude">claude</option>
              <option value="ocr">ocr</option>
              <option value="rag">rag</option>
              <option value="shenron-dragonball">shenron-dragonball</option>
            </select>
          </div>
        </div>

        {failure && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300"
          >
            <span>
              {failure.text}
              {loaded && syncedAt ? ` Les enveloppes affichées datent de ${syncedAt}.` : ""}
            </span>
            <button
              type="button"
              onClick={retry}
              disabled={syncing}
              className="rounded border border-red-500/50 px-3 py-1 font-semibold hover:bg-red-950/60 disabled:opacity-50"
            >
              {syncing ? "Actualisation..." : "Réessayer"}
            </button>
          </div>
        )}

        {!loaded ? (
          failure ? null : (
            <div className="text-sm text-muted-foreground py-8 text-center">Chargement des enveloppes A2A...</div>
          )
        ) : filteredEnvelopes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-xl">
            Aucune enveloppe A2A enregistrée dans la boîte locale.
          </div>
        ) : (
          <div className="space-y-2.5 font-mono text-xs">
            {filteredEnvelopes.map((env, index) => {
              const kindBorder =
                env.kind === "fact"
                  ? "border-l-4 border-l-emerald-500"
                  : env.kind === "ask"
                    ? "border-l-4 border-l-amber-500"
                    : env.kind === "ack"
                      ? "border-l-4 border-l-blue-500"
                      : env.kind === "ping"
                        ? "border-l-4 border-l-purple-500"
                        : "border-l-4 border-l-red-500";

              const badgeStyle =
                env.kind === "fact"
                  ? "text-emerald-400 bg-emerald-950/60 border-emerald-800/60"
                  : env.kind === "ask"
                    ? "text-amber-400 bg-amber-950/60 border-amber-800/60"
                    : env.kind === "ack"
                      ? "text-blue-400 bg-blue-950/60 border-blue-800/60"
                      : env.kind === "ping"
                        ? "text-purple-400 bg-purple-950/60 border-purple-800/60"
                        : "text-red-400 bg-red-950/60 border-red-800/60";

              return (
                <div
                  key={`${env.id}:${index}`}
                  className={`p-3.5 rounded-lg border border-border bg-[#0d1117] text-[#e6edf3] ${kindBorder} space-y-2`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#79c0ff]">{env.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-bold text-[#79c0ff]/80">{env.to}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${badgeStyle}`}
                      >
                        {env.kind || "?"}
                      </span>
                      <span className="text-muted-foreground/60 text-[10px]">({env.id})</span>
                    </div>
                    <span className="text-muted-foreground text-[11px]">{formatEnvelopeTime(env.ts)}</span>
                  </div>

                  {env.topic && <div className="font-semibold text-sm text-[#e6edf3]">{env.topic}</div>}

                  {env.body && (
                    <div className="text-xs text-[#8b949e] whitespace-pre-wrap break-words bg-[#161b22] p-2.5 rounded border border-[#21262d] max-h-48 overflow-y-auto">
                      {env.body}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
