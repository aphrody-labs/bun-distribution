// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/m3-ai - A2APeerInspector
 *
 * Material Design 3 Agent-to-Agent (A2A 1.0) Fleet Inspector:
 * - Visualizes connected peer agents (codex, claude, agycli, nie, ocr, rag, ...).
 * - Displays AgentCard interface, capabilities, and active tasks.
 * - Live inspection of .coord mailbox envelopes (ask, fact, ack, ping, error).
 * - File lock & resource claims view (.coord/claims).
 */

import React, { useState } from "react";
import { clsx } from "clsx";
import type { CoordEnvelope, EnvelopeKind } from "./AgUiEventStream";

export interface AgentPeer {
  id: string;
  name: string;
  role: string;
  status: "idle" | "busy" | "offline";
  version?: string;
  skills?: string[];
  activeClaim?: string;
}

export interface SendEnvelopePayload {
  from: string;
  to?: string;
  kind: EnvelopeKind | string;
  topic: string;
  body: string;
  re?: string;
  channel_hint?: string[];
  v?: number;
  [key: string]: unknown;
}

export interface A2APeerInspectorProps {
  peers?: AgentPeer[];
  envelopes?: CoordEnvelope[];
  selectedPeerId?: string;
  onSelectPeer?: (peerId: string) => void;
  onSendEnvelope?: (envelope: SendEnvelopePayload) => void;
  className?: string;
}

const EMPTY_ENVELOPES: CoordEnvelope[] = [];

const DEFAULT_PEERS: AgentPeer[] = [
  {
    id: "agy",
    name: "Antigravity Core",
    role: "Integrator & UI / Rust Lead",
    status: "busy",
    version: "2.0.0",
    skills: ["m3-ui", "rust-serial", "bun-native", "a2a-coord"],
    activeClaim: ".coord/claims/native-integration.json",
  },
  {
    id: "codex",
    name: "Codex Peer",
    role: "Backend & Systems Worker",
    status: "busy",
    version: "1.4.0",
    skills: ["native-wiring", "wsl-probe", "kernel-ffi"],
  },
  {
    id: "claude",
    name: "Claude Peer",
    role: "Architecture & Verification",
    status: "idle",
    version: "3.7.0",
    skills: ["design-tokens", "docs-audit", "review"],
  },
];

const KIND_COLORS: Record<
  EnvelopeKind,
  { bg: string; text: string; border: string }
> = {
  ask: {
    bg: "bg-[var(--md-sys-color-primary-container,#eaddff)]",
    text: "text-[var(--md-sys-color-on-primary-container,#21005d)]",
    border: "border-[var(--md-sys-color-primary,#6750a4)]",
  },
  fact: {
    bg: "bg-[var(--md-sys-color-tertiary-container,#ffd8e4)]",
    text: "text-[var(--md-sys-color-on-tertiary-container,#31111d)]",
    border: "border-[var(--md-sys-color-tertiary,#7d5260)]",
  },
  ack: {
    bg: "bg-[var(--md-sys-color-secondary-container,#e8def8)]",
    text: "text-[var(--md-sys-color-on-secondary-container,#1d192b)]",
    border: "border-[var(--md-sys-color-secondary,#625b71)]",
  },
  ping: {
    bg: "bg-[var(--md-sys-color-surface-container-high,#ece6f0)]",
    text: "text-[var(--md-sys-color-on-surface-variant,#49454f)]",
    border: "border-[var(--md-sys-color-outline-variant,#cac4d0)]",
  },
  error: {
    bg: "bg-[var(--md-sys-color-error-container,#f9dedc)]",
    text: "text-[var(--md-sys-color-on-error-container,#410e0b)]",
    border: "border-[var(--md-sys-color-error,#b3261e)]",
  },
};

export const A2APeerInspector: React.FC<A2APeerInspectorProps> = ({
  peers = DEFAULT_PEERS,
  envelopes = EMPTY_ENVELOPES,
  selectedPeerId: controlledPeerId,
  onSelectPeer,
  onSendEnvelope,
  className,
}) => {
  const [internalSelectedPeerId, setInternalSelectedPeerId] = useState<string>(
    peers[0]?.id || "agy",
  );
  const selectedPeerId = controlledPeerId ?? internalSelectedPeerId;

  // Form state for composing envelope
  const [composeTopic, setComposeTopic] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeKind, setComposeKind] = useState<EnvelopeKind>("ask");

  const currentPeer = peers.find((p) => p.id === selectedPeerId) || peers[0];

  const handleSelect = (peerId: string) => {
    setInternalSelectedPeerId(peerId);
    onSelectPeer?.(peerId);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeTopic.trim() || !composeBody.trim()) return;

    onSendEnvelope?.({
      from: "agy",
      to: selectedPeerId,
      kind: composeKind,
      topic: composeTopic.trim(),
      body: composeBody.trim(),
    });

    setComposeTopic("");
    setComposeBody("");
  };

  const filteredEnvelopes = envelopes.filter(
    (env) =>
      env.from === selectedPeerId ||
      env.to === selectedPeerId ||
      env.to === "fleet",
  );

  return (
    <div
      className={clsx(
        "flex flex-col gap-4 rounded-3xl p-5 border",
        "bg-[var(--md-sys-color-surface-container-lowest,#ffffff)]",
        "border-[var(--md-sys-color-outline-variant,#cac4d0)]",
        "text-[var(--md-sys-color-on-surface,#1d1b20)]",
        className,
      )}
    >
      {/* Header & Peer Chips */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-xl text-[var(--md-sys-color-primary,#6750a4)]">
              hub
            </span>
            <h2 className="text-base font-semibold tracking-tight">
              A2A Fleet Coordinator
            </h2>
            <span className="rounded-full bg-[var(--md-sys-color-surface-container-high,#ece6f0)] px-2 py-0.5 text-xs font-mono text-[var(--md-sys-color-on-surface-variant,#49454f)]">
              v1.0 (JSONL + RPC)
            </span>
          </div>
          <span className="text-xs text-[var(--md-sys-color-outline,#79747e)]">
            {peers.length} active peers
          </span>
        </div>

        {/* Peer selection chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {peers.map((peer) => {
            const isSelected = peer.id === selectedPeerId;
            return (
              <button
                key={peer.id}
                type="button"
                onClick={() => handleSelect(peer.id)}
                className={clsx(
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0",
                  isSelected
                    ? "bg-[var(--md-sys-color-secondary-container,#e8def8)] text-[var(--md-sys-color-on-secondary-container,#1d192b)] shadow-sm"
                    : "bg-[var(--md-sys-color-surface-container,#f3edf7)] text-[var(--md-sys-color-on-surface-variant,#49454f)] hover:bg-[var(--md-sys-color-surface-container-high,#ece6f0)]",
                )}
              >
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    peer.status === "busy"
                      ? "bg-amber-500 animate-pulse"
                      : peer.status === "idle"
                        ? "bg-emerald-500"
                        : "bg-slate-400",
                  )}
                />
                <span>{peer.name}</span>
                <span className="text-[10px] opacity-60">@{peer.id}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Peer Details Card */}
      {currentPeer && (
        <div className="flex flex-col gap-2 rounded-2xl bg-[var(--md-sys-color-surface-container-low,#f7f2fa)] p-4 border border-[var(--md-sys-color-outline-variant,#cac4d0)]/50">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">
                  {currentPeer.name}
                </span>
                <span className="text-xs text-[var(--md-sys-color-on-surface-variant,#49454f)]">
                  ({currentPeer.role})
                </span>
              </div>
              <div className="text-xs text-[var(--md-sys-color-outline,#79747e)] mt-0.5">
                Peer ID:{" "}
                <code className="font-mono text-xs">{currentPeer.id}</code> ·
                Version: {currentPeer.version || "1.0.0"}
              </div>
            </div>
            {currentPeer.activeClaim && (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400 border border-amber-500/20">
                <span className="material-symbols-outlined text-sm">lock</span>
                <span className="font-mono text-[11px]">
                  {currentPeer.activeClaim}
                </span>
              </div>
            )}
          </div>

          {currentPeer.skills && currentPeer.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {currentPeer.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-md bg-[var(--md-sys-color-surface-container-highest,#e6e0e9)] px-2 py-0.5 text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant,#49454f)]"
                >
                  #{skill}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Envelope Stream Section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant,#49454f)]">
            Coordination Envelopes ({filteredEnvelopes.length})
          </h3>
          <span className="text-[11px] text-[var(--md-sys-color-outline,#79747e)]">
            .coord/inbox & .coord/outbox
          </span>
        </div>

        {filteredEnvelopes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest,#ffffff)] border border-dashed border-[var(--md-sys-color-outline-variant,#cac4d0)] text-xs text-[var(--md-sys-color-outline,#79747e)]">
            <span className="material-symbols-outlined text-2xl mb-1 opacity-50">
              mark_email_read
            </span>
            No pending envelopes for @{selectedPeerId}. Fleet mailbox is
            synchronized.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {filteredEnvelopes.map((env) => {
              const kind = (
                env.kind in KIND_COLORS ? env.kind : "ping"
              ) as EnvelopeKind;
              const style = KIND_COLORS[kind];

              return (
                <div
                  key={env.id}
                  className={clsx(
                    "flex flex-col gap-1.5 rounded-xl p-3 border text-xs transition-shadow",
                    "bg-[var(--md-sys-color-surface-container-low,#f7f2fa)]",
                    style.border,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          style.bg,
                          style.text,
                        )}
                      >
                        {env.kind}
                      </span>
                      <span className="font-semibold">{env.topic}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--md-sys-color-outline,#79747e)]">
                      {env.from} → {env.to || "all"}
                    </span>
                  </div>

                  <p className="line-clamp-2 text-xs text-[var(--md-sys-color-on-surface-variant,#49454f)] font-mono whitespace-pre-wrap">
                    {env.body}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-[var(--md-sys-color-outline-variant,#cac4d0)]/30 text-[10px] text-[var(--md-sys-color-outline,#79747e)] font-mono">
                    <span>id: {env.id}</span>
                    {env.re && <span>re: {env.re}</span>}
                    <span>{new Date(env.ts).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Compose Form */}
      <form
        onSubmit={handleSend}
        className="flex flex-col gap-2.5 pt-2 border-t border-[var(--md-sys-color-outline-variant,#cac4d0)]/50"
      >
        <div className="flex items-center gap-2">
          <select
            value={composeKind}
            onChange={(e) => setComposeKind(e.target.value as EnvelopeKind)}
            className="rounded-xl border border-[var(--md-sys-color-outline-variant,#cac4d0)] bg-[var(--md-sys-color-surface-container-low,#f7f2fa)] px-2.5 py-1.5 text-xs font-medium text-[var(--md-sys-color-on-surface,#1d1b20)] focus:outline-none focus:ring-1 focus:ring-[var(--md-sys-color-primary,#6750a4)]"
          >
            <option value="ask">ASK</option>
            <option value="fact">FACT</option>
            <option value="ack">ACK</option>
            <option value="ping">PING</option>
            <option value="error">ERROR</option>
          </select>

          <input
            type="text"
            placeholder="Topic (e.g. work, claim-check, verification)..."
            value={composeTopic}
            onChange={(e) => setComposeTopic(e.target.value)}
            className="flex-1 rounded-xl border border-[var(--md-sys-color-outline-variant,#cac4d0)] bg-[var(--md-sys-color-surface-container-low,#f7f2fa)] px-3 py-1.5 text-xs text-[var(--md-sys-color-on-surface,#1d1b20)] placeholder-[var(--md-sys-color-outline,#79747e)] focus:outline-none focus:ring-1 focus:ring-[var(--md-sys-color-primary,#6750a4)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={`Message body to @${selectedPeerId}...`}
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            className="flex-1 rounded-xl border border-[var(--md-sys-color-outline-variant,#cac4d0)] bg-[var(--md-sys-color-surface-container-low,#f7f2fa)] px-3 py-1.5 text-xs text-[var(--md-sys-color-on-surface,#1d1b20)] placeholder-[var(--md-sys-color-outline,#79747e)] focus:outline-none focus:ring-1 focus:ring-[var(--md-sys-color-primary,#6750a4)]"
          />

          <button
            type="submit"
            disabled={!composeTopic.trim() || !composeBody.trim()}
            className={clsx(
              "flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold transition-all",
              composeTopic.trim() && composeBody.trim()
                ? "bg-[var(--md-sys-color-primary,#6750a4)] text-[var(--md-sys-color-on-primary,#ffffff)] hover:opacity-90 shadow-sm"
                : "bg-[var(--md-sys-color-surface-container-high,#ece6f0)] text-[var(--md-sys-color-outline,#79747e)] cursor-not-allowed",
            )}
          >
            <span>Dispatch</span>
            <span className="material-symbols-outlined text-sm">send</span>
          </button>
        </div>
      </form>
    </div>
  );
};
