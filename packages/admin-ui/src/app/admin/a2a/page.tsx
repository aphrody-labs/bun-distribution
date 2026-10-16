// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { A2AViewer } from "./A2AViewer";

export const metadata: Metadata = {
  title: "Supervision A2A & Pairs Autonomes | Administration Shenron",
  description:
    "Console unifiée Agent2Agent (A2A 1.0) : Codex, agycli, Claude, Modèles locaux et Sous-agents",
};

export const dynamic = "force-dynamic";

export default function AdminA2APage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto py-6 px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Supervision Protocole A2A (Agent2Agent)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Réseau de communication inter-agents standardisé conforme à la spécification A2A 1.0.
          Orchestration autonome YOLO, synchronisation temps réel Discord{" "}
          <span className="font-mono text-primary">#bot-admin</span> et boîtes aux lettres locales{" "}
          <span className="font-mono text-primary">.coord</span>.
        </p>
      </div>

      <A2AViewer />
    </div>
  );
}
