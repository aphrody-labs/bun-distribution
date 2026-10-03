// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { aphrodyRpc } from "../../tauri-bridge";

interface McpServer {
  name: string;
  status: string;
  toolCount: number;
}

/** Read the configured MCP inventory through the profile-isolated app-server. */
export function AgentToolsSettings() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const inventory = await aphrodyRpc("mcpServerStatus/list");
      if (!Array.isArray(inventory.servers))
        throw new Error("Inventaire des serveurs indisponible.");
      setServers(inventory.servers as McpServer[]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Registre d'outils indisponible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card variant="elevated" className="p-6 space-y-4">
      <h3 className="text-title-medium">Serveurs d'outils</h3>
      <p className="text-body-large text-on-surface-variant">
        Consultez les serveurs configurés pour cette session et leur état de connexion.
      </p>
      <Button variant="tonal" disabled={loading} onClick={() => void refresh()}>
        {loading ? "Actualisation…" : "Actualiser les outils"}
      </Button>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {servers && servers.length === 0 && <p role="status">Aucun serveur configuré.</p>}
      {servers && servers.length > 0 && (
        <ul className="space-y-3">
          {servers.map((server) => (
            <li key={server.name}>
              <span className="text-body-large font-medium">{server.name}</span>
              <p className="text-body-large text-on-surface-variant">
                {server.status === "disabled"
                  ? "Désactivé"
                  : server.status === "unknown"
                    ? "Connexion non vérifiée"
                    : server.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
