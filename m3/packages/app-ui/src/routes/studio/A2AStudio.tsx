// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { loadAgentInventory, type AgentInventory } from "../../backend-inventory";

const serverLabels: Record<string, string> = {
  disabled: "Désactivé",
  unknown: "Connexion non vérifiée",
  connected: "Connecté",
  disconnected: "Déconnecté",
  ready: "Disponible",
  error: "Connexion en échec",
};

export function A2AStudio() {
  const [inventory, setInventory] = useState<AgentInventory | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect -- the loading state resets before each inventory load, which the effect starts on mount and on every refresh
    setLoading(true);
    setFailed(false);
    setInventory(null);
    void loadAgentInventory()
      .then((result) => {
        if (active) setInventory(result);
        return undefined;
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- revision is the refresh trigger that reloads the inventory; the effect body does not read it
  }, [revision]);

  const tools = inventory?.tools.filter((tool) =>
    (tool.name + " " + tool.description)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase().trim()),
  );

  return (
    <div className="flex flex-col gap-6" aria-busy={loading}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-headline-small">Outils des agents</h2>
          <p className="mt-2 max-w-prose text-on-surface-variant">
            Consultez les outils disponibles pour vos conversations et les connexions configurées.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
          className="min-h-12 rounded-full bg-primary px-6 text-on-primary disabled:opacity-50"
        >
          {loading ? "Chargement…" : failed ? "Réessayer" : "Actualiser"}
        </button>
      </header>
      {loading && <output className="block">Lecture des outils disponibles…</output>}
      {failed && (
        <p role="alert" className="rounded-2xl bg-error-container p-5 text-on-error-container">
          Impossible de lire les outils. Vérifiez la connexion au service puis réessayez.
        </p>
      )}
      {inventory && (
        <>
          <section aria-labelledby="agent-connections">
            <h3 id="agent-connections" className="text-title-large">
              Connexions
            </h3>
            {inventory.servers.length === 0 ? (
              <p className="mt-3 text-on-surface-variant">Aucune connexion externe configurée.</p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {inventory.servers.map((server, index) => (
                  <li
                    // oxlint-disable-next-line react/no-array-index-key -- servers come from the inventory without an id, and the index keeps repeated names distinct
                    key={server.name + index}
                    className="flex flex-wrap justify-between gap-3 rounded-2xl border border-outline-variant p-4"
                  >
                    <span className="break-words font-medium">{server.name}</span>
                    <span className="text-on-surface-variant">
                      {serverLabels[server.status] ?? "État non reconnu"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="agent-tools">
            <h3 id="agent-tools" className="text-title-large">
              Outils disponibles ({inventory.tools.length})
            </h3>
            <label className="mt-4 flex flex-col gap-2">
              Rechercher un outil
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-outline bg-surface-container px-4 text-on-surface"
              />
            </label>
            {tools?.length === 0 ? (
              <output className="block mt-4 text-on-surface-variant">
                {inventory.tools.length === 0
                  ? "Le service ne propose aucun outil."
                  : "Aucun outil ne correspond à votre recherche."}
              </output>
            ) : (
              <ul className="mt-4 grid gap-4 lg:grid-cols-2">
                {tools?.map((tool, index) => (
                  <li
                    // oxlint-disable-next-line react/no-array-index-key -- tools come from the inventory without an id, and the index keeps repeated names distinct
                    key={tool.name + index}
                    className="min-w-0 rounded-2xl border border-outline-variant bg-surface-container-low p-5"
                  >
                    <h4 className="break-words font-semibold">{tool.name}</h4>
                    {tool.description && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-on-surface-variant">
                        {tool.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
