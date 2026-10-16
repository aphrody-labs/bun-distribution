"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Play, ChevronDown, Wrench } from "lucide-react";
import { api } from "@aphrody/admin-ui/client";
import { PlainField } from "../../../components/editor/PlainField";

interface ServiceAction {
  service: string;
  action: string;
  description: string;
}

/** Traduit un nom technique de service en libellé lisible. */
function labelService(name: string): string {
  const labels: Record<string, string> = {
    settings: "Paramètres du bot",
    moderation: "Modération",
    levels: "Niveaux & XP",
    economy: "Économie (zénis)",
    tickets: "Tickets de support",
    giveaway: "Giveaways",
    bio: "Rôle bio",
    wiki: "Wiki DBZ",
  };
  return labels[name.toLowerCase()] ?? name;
}

export default function ServicesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: () => api.get<{ actions: ServiceAction[] }>("/services"),
  });

  if (isLoading) return <div className="text-zinc-500 text-sm">Chargement des fonctionnalités…</div>;

  // Regroupe par service
  const grouped = (data?.actions ?? []).reduce<Record<string, ServiceAction[]>>((acc, a) => {
    (acc[a.service] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <Wrench className="h-5 w-5 text-dbz-orange" />
          <h2 className="text-lg font-saiyan text-dbz-orange uppercase">Fonctionnalités du bot</h2>
        </div>
        <p className="text-sm text-zinc-300">
          Chaque fonctionnalité du bot expose des actions que vous pouvez déclencher manuellement depuis ici — sans
          passer par Discord. Utile pour forcer une mise à jour, recalculer des données ou tester un comportement.
        </p>
        <p className="mt-1 text-xs text-dbz-blue-light">
          Certaines actions modifient la base de données. Une confirmation vous sera demandée avant exécution.
        </p>
      </div>

      {Object.keys(grouped).length === 0 && (
        <div className="dbz-panel p-8 text-center text-zinc-500 text-sm">Aucune action disponible pour l'instant.</div>
      )}

      {Object.entries(grouped).map(([svc, actions]) => (
        <div key={svc} className="dbz-panel p-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-dbz-border">
            <h3 className="font-saiyan text-sm text-dbz-yellow uppercase tracking-wide">{labelService(svc)}</h3>
            <span className="text-xs text-zinc-500 font-mono">({svc})</span>
          </div>
          <div className="p-3 space-y-2">
            {actions.map(a => (
              <ActionRow key={`${a.service}-${a.action}`} action={a} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionRow({ action }: { action: ServiceAction }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("{}");
  const [result, setResult] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(body || "{}");
      return api.post(`/services/${action.service}/${action.action}`, parsed);
    },
    onSuccess: data => setResult(JSON.stringify(data, null, 2)),
    onError: err => setResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bodyPreview =
      body.trim() === "{}" || body.trim() === "" ? "sans paramètre" : `avec le paramètre : ${body.trim().slice(0, 60)}`;
    if (
      !confirm(
        `Exécuter l'action « ${action.action} » du service « ${action.service} » ${bodyPreview} ?\n\nCette action peut modifier des données.`,
      )
    )
      return;
    setResult(null);
    mutation.mutate();
  };

  return (
    <div className="rounded-lg border border-dbz-border bg-dbz-bg/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-dbz-blue-light/5"
      >
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 text-dbz-blue-light transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
        />
        <div className="flex-1">
          <code className="text-sm font-medium text-dbz-orange">{action.action}</code>
          <p className="mt-0.5 text-xs text-zinc-400">{action.description}</p>
        </div>
      </button>

      {open && (
        <form onSubmit={submit} className="space-y-2 border-t border-dbz-border p-3">
          <label className="block text-xs text-zinc-400">
            Paramètres (JSON) — laisser <code>{"{}"}</code> si l'action n'en a pas
          </label>
          <PlainField
            value={body}
            onChange={setBody}
            minRows={3}
            maxRows={16}
            monospace
            spellCheck={false}
            label="Paramètres JSON"
            hideLabel
          />
          <button type="submit" disabled={mutation.isPending} className="dbz-button !text-xs !px-3 !py-1.5">
            <Play className="h-3 w-3 inline-block mr-1" />
            {mutation.isPending ? "Exécution en cours…" : "Exécuter"}
          </button>
          {result && (
            <details className="mt-2" open={result.startsWith("Erreur")}>
              <summary className="text-xs text-zinc-400 cursor-pointer select-none">Résultat</summary>
              <pre
                className={`mt-1 overflow-x-auto rounded p-2 text-xs font-mono ${
                  result.startsWith("Erreur")
                    ? "bg-red-900/20 text-red-300 border border-red-800"
                    : "bg-dbz-bg border border-dbz-border text-zinc-200"
                }`}
              >
                {result}
              </pre>
            </details>
          )}
        </form>
      )}
    </div>
  );
}
