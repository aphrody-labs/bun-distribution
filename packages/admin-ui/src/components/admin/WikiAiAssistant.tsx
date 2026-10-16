"use client";

/**
 * Assistant wiki RAG-only : l'admin donne une instruction/requête, on récupère
 * des passages SOURCÉS du RAG (aucune génération LLM) et un brouillon markdown
 * stitché qu'il peut relire puis insérer comme section de la fiche. Monté dans le
 * studio à côté de WikiSectionsPanel.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Baguette,
  Chargement,
  Etincelle,
  LienExterne,
  Plus,
} from "@/components/icones";
import { apiAt } from "@aphrody/admin-ui/client";
import { sectionKeyFromLabel } from "@/lib/wiki-fields";
import { crudBase } from "@/lib/wiki-tables";
import { PlainField } from "@/components/editor/PlainField";

interface RagHit {
  title: string;
  url: string;
  snippet: string;
  score: number | null;
  kind: string;
}

export function WikiAiAssistant({
  entityType,
  entityId,
  entityName,
}: {
  entityType: string;
  entityId: string;
  entityName: string;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState(entityName);
  const [label, setLabel] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [hits, setHits] = useState<RagHit[]>([]);
  const client = apiAt(crudBase("db_wiki_sections"));

  const search = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch("/api/wiki-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, limit: 10 }),
      });
      if (!res.ok) throw new Error("Recherche échouée");
      return (await res.json()) as { results: RagHit[]; markdown: string };
    },
    onSuccess: (data) => {
      setHits(data.results);
      setMarkdown(data.markdown);
    },
  });

  const insert = useMutation({
    mutationFn: () => {
      const lbl = label.trim() || query.trim() || "Section";
      return client.post(`/db_wiki_sections`, {
        entityType,
        entityId,
        key: sectionKeyFromLabel(lbl),
        label: lbl,
        accent: "orange",
        body: markdown,
        sortOrder: 99,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["wiki-sections", entityType, entityId],
      });
      setMarkdown("");
      setHits([]);
    },
  });

  // Suggestions d'instructions précises (pré-remplissent la requête).
  const presets = [
    { label: "Powerscaling", q: `${entityName} puissance combat feats` },
    { label: "Histoire", q: `${entityName} histoire biographie` },
    { label: "Techniques", q: `${entityName} techniques attaques` },
    { label: "Transformations", q: `${entityName} transformations formes` },
    { label: "Relations", q: `${entityName} famille relations alliés` },
  ];

  return (
    <div className="dbz-panel space-y-4 p-5">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
        <Etincelle className="h-3.5 w-3.5" /> Assistant sources (RAG)
      </div>
      <p className="text-xs text-white/50">
        Donne une instruction : l&apos;assistant récupère des{" "}
        <strong>passages sourcés</strong> de la base (aucune IA générative —
        extraits réels + citations) et prépare un brouillon que tu relis puis
        insères comme section.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setQuery(p.q);
              setLabel(p.label);
              search.mutate(p.q);
            }}
            className="inline-flex items-center gap-1 rounded border border-dbz-border bg-dbz-card/60 px-2 py-1 text-xs text-white/80 hover:border-dbz-orange hover:text-white"
          >
            <Baguette className="h-3 w-3" /> {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder="Instruction / sujet (ex. « powerscaling de Goku »)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (query.trim()) search.mutate(query);
            }
          }}
        />
        <button
          type="button"
          onClick={() => query.trim() && search.mutate(query)}
          disabled={search.isPending || !query.trim()}
          className="btn btn-ghost shrink-0"
        >
          {search.isPending ? (
            <Chargement className="h-4 w-4 animate-spin" />
          ) : (
            "Chercher"
          )}
        </button>
      </div>

      {search.isError && (
        <p className="text-xs text-red-400">Recherche échouée.</p>
      )}

      {hits.length > 0 && (
        <>
          <div className="max-h-40 space-y-1.5 overflow-y-auto">
            {hits.map((h, i) => (
              <div
                key={i}
                className="rounded border border-dbz-border bg-dbz-bg/50 p-2 text-xs"
              >
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-white/80">
                    {h.title || "Source"}
                  </span>
                  {h.url && (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-dbz-blue-light hover:text-dbz-orange"
                    >
                      <LienExterne className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="line-clamp-2 text-white/55">{h.snippet}</p>
              </div>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Brouillon (markdown, sourcé) — relis/édite avant d&apos;insérer
            </label>
            <PlainField
              value={markdown}
              onChange={setMarkdown}
              minRows={8}
              maxRows={30}
              monospace
              label="Markdown proposé"
              hideLabel
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              className="input w-40 text-sm"
              placeholder="Titre de section"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              type="button"
              onClick={() => insert.mutate()}
              disabled={insert.isPending || !markdown.trim()}
              className="btn btn-primary"
            >
              {insert.isPending ? (
                <Chargement className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Insérer comme section
            </button>
            {insert.isSuccess && (
              <span className="text-xs text-green-400">Section créée ✓</span>
            )}
            {insert.isError && (
              <span className="text-xs text-red-400">Échec.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
