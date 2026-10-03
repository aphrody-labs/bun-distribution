// SPDX-License-Identifier: Apache-2.0
/**
 * A2AStudio — Multi-Agent Fleet Coordinator, Task Timeline & Generative MCP-UI Workspace.
 *
 * Provides real-time visibility and control over:
 * - A2A 1.0 Peer Fleet (agy, codex, claude, shenron) & OS claim locks (.coord/claims)
 * - Multi-Agent Task Timeline & delegation handoff traces
 * - Sandboxed interactive MCP-UI applications (SEP-1724 / mcp-ui)
 * - AG-UI Event Streaming Accumulator & A2UI Declarative Interface synthesis
 */

import { useState, useMemo, useEffect } from "react";
import {
  A2APeerInspector,
  A2ATaskTimeline,
  McpAppCard,
  AgUiEventAccumulator,
  EventType,
  type AgentPeer,
  type TimelineStep,
  type CoordEnvelope,
} from "@aphrody/m3-ai";
import { Card, Button } from "@aphrody/m3-primitives";
import { PageHeader } from "@shenron/ui/layout/PageHeader";
import { SectionHeading } from "@shenron/ui/layout/SectionHeading";
import { fetchA2AFleetStatus, sendA2AEnvelope } from "../../tauri-bridge";

export function A2AStudio() {
  const [activeTab, setActiveTab] = useState<"fleet" | "timeline" | "mcp_apps" | "agui_stream">("fleet");

  // Initial fleet state
  const [peers, setPeers] = useState<AgentPeer[]>([
    {
      id: "agy",
      name: "Antigravity CLI (agy)",
      role: "Lead Systems & UI Agent",
      status: "busy",
      version: "2.0.0",
      skills: ["bun", "rust", "m3", "tauri", "ag-ui", "mcp-ui"],
      activeClaim: ".coord/claims/native-integration.json",
    },
    {
      id: "codex",
      name: "Codex CLI",
      role: "Backend & Systems Integrator",
      status: "busy",
      version: "1.4.0",
      skills: ["rust", "cargo", "torch", "cef", "bindings"],
      activeClaim: "crates/koharu/koharu-torch",
    },
    {
      id: "claude",
      name: "Claude Code",
      role: "Core Monorepo Architect",
      status: "idle",
      version: "3.7.0",
      skills: ["refactoring", "monorepo", "architecture", "coordination"],
    },
    {
      id: "shenron",
      name: "Shenron AI",
      role: "RAG & Knowledge Domain Agent",
      status: "idle",
      version: "2.1.0",
      skills: ["rag", "embeddings", "dragonball", "databooks", "ocr"],
    },
  ]);

  const [envelopes, setEnvelopes] = useState<CoordEnvelope[]>([
    {
      v: 1,
      ts: new Date().toISOString(),
      id: "env-init-01",
      from: "agy",
      to: "codex",
      kind: "fact",
      topic: "a2a.agui.integrated",
      body: "AG-UI Protocol & MCP-UI suites fully integrated natively in Aphrody monorepo (pure Bun, TypeScript 7). All 543 unit tests passing.",
    },
    {
      v: 1,
      ts: new Date(Date.now() - 3600000).toISOString(),
      id: "env-init-02",
      from: "claude",
      to: "agy",
      kind: "ask",
      topic: "a2a.coord.claim",
      body: "Requesting verification on @aphrody/m3-ai and desktop app-ui bindings.",
    },
  ]);

  // Multi-agent delegation timeline sample
  const timelineSteps: TimelineStep[] = useMemo(() => [
    {
      id: "step-1",
      from: "user",
      to: "agy",
      title: "AG-UI & MCP-UI Upstream Fork & Pure Bun Port",
      status: "completed",
      timestamp: "01:30:15",
      description: "Forked ag-ui and mcp-ui, converted to pure Bun (>=1.4.2) and TypeScript 7 (7.0.2). Fixed TS7 baseUrl and isolated linker imports.",
      envelope: {
        ts: "01:30:15",
        id: "env-001",
        from: "user",
        to: "agy",
        kind: "ask",
        topic: "port.agui",
        body: "Fork https://github.com/ag-ui-protocol/ag-ui and https://github.com/MCP-UI-Org/mcp-ui, make pure Bun & TS 7.",
      },
    },
    {
      id: "step-2",
      from: "agy",
      to: "agy",
      title: "Unit Test & Typecheck Validation Gate",
      status: "completed",
      timestamp: "01:54:20",
      description: "543 unit tests passing in Bun (419 ag-ui + 74 mcp-ui + 50 m3-ai). Clean typecheck across all 9 workspaces.",
    },
    {
      id: "step-3",
      from: "agy",
      to: "agy",
      title: "Serialized Cargo Check Gate",
      status: "completed",
      timestamp: "01:59:30",
      description: "scripts/build/rust/cargo-serial.sh check -p aphrody-m3-tokens -p aphrody-app passed with zero errors.",
    },
    {
      id: "step-4",
      from: "agy",
      to: "codex",
      title: "Koharu Cef & DynRuntime Host Unification",
      status: "running",
      timestamp: "02:00:10",
      description: "Active integration in crates/ui/app and koharu-app with unified feature flags.",
      claim: "crates/koharu/koharu-torch",
    },
  ], []);

  // Interactive sample MCP tool apps
  const sampleMcpApps = [
    {
      toolName: "chart_generator",
      title: "Agent Performance & Token Velocity",
      toolResourceUri: "ui://mcp.aphrody.local/metrics-chart.html",
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1.25rem; color: #1d1b20; background: transparent; }
    @media (prefers-color-scheme: dark) { body { color: #e6e1e5; } }
    .card { background: rgba(103, 80, 164, 0.08); border-radius: 1rem; padding: 1rem; margin-bottom: 0.75rem; border: 1px solid rgba(103, 80, 164, 0.2); }
    .metric { font-size: 1.75rem; font-weight: 700; color: #6750a4; margin: 0.25rem 0; }
    @media (prefers-color-scheme: dark) { .metric { color: #d0bcff; } }
    .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
    .bars { display: flex; gap: 0.5rem; align-items: flex-end; height: 100px; margin-top: 1rem; padding-top: 0.5rem; border-bottom: 1px solid rgba(0,0,0,0.1); }
    .bar { flex: 1; background: #6750a4; border-radius: 4px 4px 0 0; transition: height 0.3s; position: relative; }
    @media (prefers-color-scheme: dark) { .bar { background: #d0bcff; } }
    .bar:hover { opacity: 0.8; cursor: pointer; }
    .bar::after { content: attr(data-val); position: absolute; top: -1.25rem; left: 50%; transform: translateX(-50%); font-size: 0.65rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="label">Vitesse de streaming AG-UI (Tokens / seconde)</div>
    <div class="metric">148.6 tok/s</div>
    <div class="bars">
      <div class="bar" style="height: 45%;" data-val="72"></div>
      <div class="bar" style="height: 60%;" data-val="98"></div>
      <div class="bar" style="height: 85%;" data-val="135"></div>
      <div class="bar" style="height: 100%;" data-val="148"></div>
      <div class="bar" style="height: 90%;" data-val="142"></div>
      <div class="bar" style="height: 95%;" data-val="146"></div>
    </div>
  </div>
</body>
</html>`,
      toolInput: { metric: "tokens_per_sec", interval: "100ms", agent: "agy" },
      toolResult: { status: "active", current: 148.6, unit: "tok/s" },
    },
    {
      toolName: "color_scheme_explorer",
      title: "Générateur Dynamique Material Design 3",
      toolResourceUri: "ui://mcp.aphrody.local/m3-palette.html",
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1.25rem; color: #1d1b20; background: transparent; }
    @media (prefers-color-scheme: dark) { body { color: #e6e1e5; } }
    .swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.75rem; }
    .swatch { border-radius: 0.75rem; padding: 0.75rem; font-size: 0.75rem; font-weight: 600; display: flex; flex-direction: column; justify-content: space-between; height: 60px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .primary { background: #6750a4; color: #ffffff; }
    .primary-container { background: #eaddff; color: #21005d; }
    .secondary-container { background: #e8def8; color: #1d192b; }
    .tertiary-container { background: #ffd8e4; color: #31111d; }
  </style>
</head>
<body>
  <div class="swatches">
    <div class="swatch primary"><span>Primary</span><span>#6750a4</span></div>
    <div class="swatch primary-container"><span>Primary Cont.</span><span>#eaddff</span></div>
    <div class="swatch secondary-container"><span>Secondary Cont.</span><span>#e8def8</span></div>
    <div class="swatch tertiary-container"><span>Tertiary Cont.</span><span>#ffd8e4</span></div>
  </div>
</body>
</html>`,
      toolInput: { sourceColor: "#6750a4", variant: "expressive" },
      toolResult: { primary: "#6750a4", primaryContainer: "#eaddff" },
    },
  ];

  // AG-UI Event accumulator demonstrator
  const [eventLog, setEventLog] = useState<string[]>([
    "RUN_STARTED: run_id=run-8820",
    "TEXT_MESSAGE_CONTENT: delta='Connexion au protocole AG-UI établie avec succès.'",
    "TOOL_CALL_START: tool=a2a_dispatch, id=call_01",
    "TOOL_CALL_RESULT: tool=a2a_dispatch, status=delivered",
    "RUN_FINISHED: outcome=success",
  ]);

  // Sync with native Rust A2A backend and .coord mailboxes
  useEffect(() => {
    let mounted = true;
    const syncFleet = async () => {
      try {
        const res = await fetchA2AFleetStatus();
        if (res && mounted) {
          if (res.peers && res.peers.length > 0) {
            setPeers(res.peers);
          }
          if (res.envelopes && res.envelopes.length > 0) {
            setEnvelopes(res.envelopes as unknown as CoordEnvelope[]);
          }
        }
      } catch (e) {
        console.warn("Notice: native A2A sync running in fallback mode:", e);
      }
    };

    void syncFleet();
    const interval = setInterval(syncFleet, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDispatchMessage = (to: string, topic: string, body: string) => {
    const newEnvelope: CoordEnvelope = {
      v: 1,
      ts: new Date().toISOString(),
      id: `env-${Math.random().toString(36).substring(2, 9)}`,
      from: "agy",
      to,
      kind: "ask",
      topic,
      body,
    };
    setEnvelopes((prev) => [newEnvelope, ...prev]);
    setPeers((prev) =>
      prev.map((p) => (p.id === to ? { ...p, status: "busy" } : p)),
    );

    // Write to native Rust .coord mailbox if running on desktop
    void sendA2AEnvelope(newEnvelope as unknown as Record<string, unknown>).catch((err) => {
      console.warn("Failed to persist envelope natively:", err);
    });
  };

  const handleSimulateAgUiStream = () => {
    const accumulator = new AgUiEventAccumulator();
    const now = Date.now();

    accumulator.push({ type: EventType.RUN_STARTED, timestamp: now });
    accumulator.push({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: "Délégation de la vérification de conformité à l'agent Codex... ",
      timestamp: now + 50,
    });
    accumulator.push({
      type: EventType.TOOL_CALL_START,
      toolCallId: "call_subagent_check",
      toolCallName: "a2a_coord_verify",
      timestamp: now + 100,
    });
    accumulator.push({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "call_subagent_check",
      content: JSON.stringify({ verified: true, gates: ["cargo-serial", "bun-test", "typecheck"] }),
      messageId: "msg_sub_01",
      timestamp: now + 200,
    });
    accumulator.push({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: "Toutes les vérifications sont au vert.",
      timestamp: now + 250,
    });
    accumulator.push({ type: EventType.RUN_FINISHED, timestamp: now + 300 });

    const state = accumulator.getState();
    setEventLog((prev) => [
      `[SIMULATION STREAM ${new Date().toLocaleTimeString()}] Résultat : ${state.steps.length} étapes, texte="${state.currentText}"`,
      ...prev,
    ]);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Aphrody A2A"
        title="Flotte A2A, Chronologie Multi-Agents & Apps MCP-UI"
        subtitle="Espace de pilotage en temps réel interconnectant les agents pairs (agy, codex, claude, shenron), les flux d'événements AG-UI Protocol et les applications génératives sandboxed MCP-UI."
      />

      {/* Tabs bar */}
      <div className="flex items-center gap-2 border-b border-outline-variant/30 pb-2">
        <Button
          variant={activeTab === "fleet" ? "filled" : "outlined"}
          size="sm"
          onClick={() => setActiveTab("fleet")}
        >
          <span className="material-symbols-outlined text-sm mr-1.5">hub</span>
          Inspecteur Flotte A2A & Claims
        </Button>

        <Button
          variant={activeTab === "timeline" ? "filled" : "outlined"}
          size="sm"
          onClick={() => setActiveTab("timeline")}
        >
          <span className="material-symbols-outlined text-sm mr-1.5">timeline</span>
          Chronologie de Délégation ({timelineSteps.length})
        </Button>

        <Button
          variant={activeTab === "mcp_apps" ? "filled" : "outlined"}
          size="sm"
          onClick={() => setActiveTab("mcp_apps")}
        >
          <span className="material-symbols-outlined text-sm mr-1.5">widgets</span>
          Bac à sable Apps MCP-UI ({sampleMcpApps.length})
        </Button>

        <Button
          variant={activeTab === "agui_stream" ? "filled" : "outlined"}
          size="sm"
          onClick={() => setActiveTab("agui_stream")}
        >
          <span className="material-symbols-outlined text-sm mr-1.5">stream</span>
          Flux d'Événements AG-UI
        </Button>
      </div>

      {/* Active Tab Panel */}
      {activeTab === "fleet" && (
        <div className="flex flex-col gap-6">
          <A2APeerInspector
            peers={peers}
            envelopes={envelopes}
            onSendEnvelope={(env) => {
              handleDispatchMessage(env.to || "codex", env.topic, env.body);
            }}
          />
        </div>
      )}

      {activeTab === "timeline" && (
        <Card variant="outlined" className="p-6">
          <SectionHeading
            title="Délégations & Transitions Multi-Agents"
            standfirst="Visualisation continue des passages de relais inter-agents, statuts d'exécution et inspection des enveloppes A2A."
          />
          <div className="mt-4">
            <A2ATaskTimeline steps={timelineSteps} currentStepId="step-4" />
          </div>
        </Card>
      )}

      {activeTab === "mcp_apps" && (
        <div className="flex flex-col gap-6">
          <SectionHeading
            title="Applications Interactives MCP-UI (SEP-1724)"
            standfirst="Composants et vues dynamiques générés par les outils de l'agent et exécutés hermétiquement dans des iframes isolées avec transmission du thème M3."
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sampleMcpApps.map((app) => (
              <McpAppCard
                key={app.toolName}
                toolName={app.toolName}
                title={app.title}
                html={app.html}
                toolResourceUri={app.toolResourceUri}
                toolInput={app.toolInput}
                toolResult={app.toolResult}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === "agui_stream" && (
        <Card variant="outlined" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading
              title="Accumulateur d'Événements Streaming AG-UI"
              standfirst="Démonstrateur du moteur AgUiEventAccumulator transformant les chunks de texte, appels d'outils et traces subagent en étapes de transcription structurées."
            />
            <Button variant="filled" size="sm" onClick={handleSimulateAgUiStream}>
              <span className="material-symbols-outlined text-sm mr-1.5">play_arrow</span>
              Simuler Flux Streaming
            </Button>
          </div>

          <div className="rounded-2xl bg-surface-container-highest/60 border border-outline-variant/30 p-4 font-mono text-xs overflow-auto max-h-96">
            {eventLog.map((log, i) => (
              <div key={i} className="py-1 border-b border-outline-variant/15 flex items-center gap-2">
                <span className="text-primary font-bold">[{i + 1}]</span>
                <span className="text-on-surface">{log}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
