"use client";

/**
 * Studio d'édition visuelle d'une entité wiki (`db_*`) : formulaire à gauche
 * (champs typés + upload d'images drag-and-drop), aperçu live de la page publique
 * à droite. Charge la ligne via `/api/wiki-admin/:table/:id`, enregistre via le
 * même CRUD (Neon). `id === "new"` → création.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alerte, CocheCercle, Enregistrer, FlecheGauche, Historique, LienExterne, Oeil } from "@shenron/ui/icones";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RelationsPanel } from "@aphrody/admin-ui/components/admin/RelationsPanel";
import { SmartField } from "@aphrody/admin-ui/components/admin/SmartField";
import { WikiEntityPreview } from "@aphrody/admin-ui/components/admin/WikiEntityPreview";
import { WikiHistory } from "@aphrody/admin-ui/components/admin/WikiHistory";
import { WikiSectionsPanel } from "@aphrody/admin-ui/components/admin/WikiSectionsPanel";
import { WikiAiAssistant } from "@aphrody/admin-ui/components/admin/WikiAiAssistant";
import { DatabookPagesPanel } from "@aphrody/admin-ui/components/admin/DatabookPagesPanel";
import { GameMediaPanel } from "@aphrody/admin-ui/components/admin/GameMediaPanel";
import { CharacterStatsPanel } from "@aphrody/admin-ui/components/admin/CharacterStatsPanel";
import { TransformationsPanel } from "@aphrody/admin-ui/components/admin/TransformationsPanel";
import { apiAt } from "@aphrody/admin-ui/client";
import { colLabel, TABLE_LABELS } from "@/lib/db-labels";
import { buildSubmitBody, entityRelations, isStudioTable, publicEntityUrl, sectionEntityType } from "@/lib/wiki-fields";
import { crudBase, WIKI_TABLE_SPECS } from "@/lib/wiki-tables";

/** jsonb gérés par un panneau dédié — pas de champ SmartField (sinon corruption string). */
const JSONB_PANEL_COLS = /^(pages|media|stats|links|articleSources|frames|players|subtitles)$/;

interface Props {
  table: string;
  id: string;
}

type Row = Record<string, unknown>;

function toDraft(cols: string[], row: Row | null): Record<string, string> {
  return Object.fromEntries(cols.map(c => [c, row?.[c] != null ? String(row[c]) : ""]));
}

export function WikiStudio({ table, id }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const spec = WIKI_TABLE_SPECS[table];
  const client = useMemo(() => apiAt(crudBase(table)), [table]);
  const mode: "create" | "edit" = id === "new" ? "create" : "edit";
  // `spec` est une constante de module → `mutableColumns` a une identité stable.
  // On exclut les jsonb gérés par un panneau dédié (pages databook, media jeux…).
  const cols = useMemo(() => (spec?.mutableColumns ?? []).filter(c => !JSONB_PANEL_COLS.test(c)), [spec]);

  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(cols, null));
  const [toast, setToast] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Chargement de la ligne (édition). Pas de refetch en arrière-plan : le
  // formulaire est l'état maître une fois hydraté (sinon un refetch focus/save
  // écraserait les saisies en cours).
  const rowQuery = useQuery({
    queryKey: ["wiki-studio", table, id],
    queryFn: () => client.get<Row>(`/${table}/${encodeURIComponent(id)}`),
    enabled: mode === "edit" && !!spec,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Hydrate le brouillon UNE fois par id (au premier chargement de la ligne) :
  // ne ré-écrase jamais les saisies en cours sur un nouveau référent de données.
  const hydratedId = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "edit" && rowQuery.data && hydratedId.current !== id) {
      setDraft(toDraft(cols, rowQuery.data));
      hydratedId.current = id;
    }
  }, [rowQuery.data, cols, mode, id]);

  const row = mode === "edit" ? (rowQuery.data ?? null) : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = buildSubmitBody(draft, row, cols, { mode });
      if (mode === "create") return client.post<{ ok: boolean; row?: Row }>(`/${table}`, body);
      return client.put<{ ok: boolean; row?: Row }>(`/${table}/${encodeURIComponent(id)}`, body);
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ["db", table] });
      setToast({ type: "success", msg: "Enregistré." });
      const savedRow = res?.row;
      const newId = savedRow?.[spec?.pk as string];
      // Met le cache à jour SANS refetch (qui écraserait le brouillon).
      if (savedRow != null && newId != null) qc.setQueryData(["wiki-studio", table, String(newId)], savedRow);
      // Création → bascule sur l'URL d'édition de la nouvelle entrée.
      if (mode === "create" && newId != null)
        router.replace(`/admin/wiki/studio/${table}/${encodeURIComponent(String(newId))}`);
    },
    onError: (err: Error) => setToast({ type: "error", msg: `Erreur : ${err.message}` }),
  });

  // Le studio ne pilote que les entités « contenu » à pk simple (cf. STUDIO_TABLES) ;
  // les tables utilitaires / à pk composite restent sur l'éditeur générique.
  if (!spec || !isStudioTable(table)) {
    return (
      <div className="card py-12 text-center">
        <p className="mb-1 font-saiyan uppercase text-dbz-orange">Table non éditable ici</p>
        <p className="text-sm text-white/50">
          <code className="font-mono">{table}</code> n&apos;est pas une entité wiki gérée par le studio.{" "}
          <a href={`/admin/database/${table}`} className="text-dbz-orange hover:underline">
            Ouvrir l&apos;éditeur classique
          </a>
          .
        </p>
      </div>
    );
  }

  const humanTable = TABLE_LABELS[table] ?? table;
  const title = (draft.name ?? draft.title ?? "").trim();
  const publicUrl = mode === "edit" ? publicEntityUrl(table, { id, slug: draft.slug }) : null;
  // En édition, on ne peut enregistrer qu'une fois la ligne chargée (sinon le
  // body serait vide → écrasement potentiel par valeurs vides).
  const notReady = mode === "edit" && !rowQuery.data;
  const hasRelations = entityRelations(table).length > 0;
  const secType = sectionEntityType(table);

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            toast.type === "success"
              ? "border-green-500/50 bg-dbz-card text-green-300"
              : "border-red-500/50 bg-dbz-card text-red-300"
          }`}
        >
          {toast.type === "success" ? (
            <CocheCercle className="h-4 w-4 shrink-0" />
          ) : (
            <Alerte className="h-4 w-4 shrink-0" />
          )}
          {toast.msg}
        </div>
      )}

      {/* En-tête */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            typeof window !== "undefined" && window.history.length > 1
              ? router.back()
              : router.push(`/admin/database/${table}`)
          }
          className="btn btn-ghost"
        >
          <FlecheGauche className="h-4 w-4" />
          <span className="sr-only">Retour à la liste</span>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-saiyan text-xl uppercase text-dbz-orange">
            {mode === "create" ? `Nouvelle entrée · ${humanTable}` : title || humanTable}
          </h2>
          <code className="font-mono text-[10px] text-white/25">
            {table}
            {mode === "edit" ? ` · ${spec.pk} = ${id}` : ""}
          </code>
        </div>
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
            <LienExterne className="h-3.5 w-3.5" />
            Page publique
          </a>
        )}
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || notReady}
          className="btn btn-primary"
        >
          <Enregistrer className="h-4 w-4" />
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {mode === "edit" && rowQuery.isLoading ? (
        <div className="card h-96 animate-pulse" />
      ) : mode === "edit" && rowQuery.isError ? (
        <div className="card py-12 text-center">
          <p className="mb-1 font-saiyan uppercase text-dbz-orange">Entrée introuvable</p>
          <p className="text-sm text-white/50">Impossible de charger cette ligne.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Formulaire */}
          <form
            onSubmit={e => {
              e.preventDefault();
              save.mutate();
            }}
            className="dbz-panel space-y-4 p-5"
          >
            {cols.map(c => (
              <Field
                key={c}
                table={table}
                col={c}
                value={draft[c] ?? ""}
                original={row?.[c]}
                onChange={v => setDraft(d => ({ ...d, [c]: v }))}
              />
            ))}
            <button type="submit" disabled={save.isPending || notReady} className="btn btn-primary w-full">
              <Enregistrer className="h-4 w-4" />
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </form>

          {/* Aperçu live + relations (sticky sur grand écran) */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <div className="dbz-panel p-6">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
                <Oeil className="h-3.5 w-3.5" /> Aperçu live
              </div>
              <WikiEntityPreview table={table} draft={draft} />
            </div>
            {hasRelations &&
              (mode === "edit" ? (
                <RelationsPanel table={table} entityId={id} />
              ) : (
                <div className="dbz-panel p-5 text-xs text-white/50">
                  Enregistre d&apos;abord cette entrée pour gérer ses relations (techniques, personnages…).
                </div>
              ))}
            {secType &&
              (mode === "edit" ? (
                <>
                  <WikiSectionsPanel table={table} entityId={id} entityType={secType} />
                  <WikiAiAssistant
                    entityType={secType}
                    entityId={id}
                    entityName={String(
                      (draft as Record<string, unknown>)?.name ?? (draft as Record<string, unknown>)?.title ?? "",
                    )}
                  />
                </>
              ) : (
                <div className="dbz-panel p-5 text-xs text-white/50">
                  Enregistre d&apos;abord cette entrée pour ajouter ses sections de contenu (histoire, personnalité,
                  anecdotes…).
                </div>
              ))}
            {mode === "edit" && (
              <details className="dbz-panel p-5">
                <summary className="flex cursor-pointer items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
                  <Historique className="h-3.5 w-3.5" /> Historique des révisions
                </summary>
                <div className="mt-4">
                  <WikiHistory table={table} rowId={id} compact />
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Pages du lecteur databook — panneau dédié (jsonb `pages`). */}
      {table === "db_databooks" &&
        (mode === "edit" ? (
          <div className="mt-2">
            <DatabookPagesPanel databookId={id} />
          </div>
        ) : (
          <div className="dbz-panel mt-2 p-5 text-xs text-white/50">
            Enregistre d&apos;abord cette entrée pour ajouter les pages du lecteur (numéro + image + texte sous chaque
            planche).
          </div>
        ))}

      {/* Galerie médias jeu (images + YouTube) — panneau dédié (jsonb `media`). */}
      {table === "db_games" &&
        (mode === "edit" ? (
          <div className="mt-2">
            <GameMediaPanel gameId={id} />
          </div>
        ) : (
          <div className="dbz-panel mt-2 p-5 text-xs text-white/50">
            Enregistre d&apos;abord ce jeu pour ajouter la galerie (screenshots + trailers YouTube).
          </div>
        ))}

      {/* Stats scouter + transformations d'un personnage. */}
      {table === "db_characters" &&
        (mode === "edit" ? (
          <div className="mt-2 space-y-4">
            <CharacterStatsPanel characterId={id} />
            <TransformationsPanel characterId={id} />
          </div>
        ) : (
          <div className="dbz-panel mt-2 p-5 text-xs text-white/50">
            Enregistre d&apos;abord ce personnage pour gérer ses stats scouter et ses transformations.
          </div>
        ))}
    </div>
  );
}

/** Un champ du formulaire (label + contrôle human-first via SmartField). */
function Field({
  table,
  col,
  value,
  original,
  onChange,
}: {
  table: string;
  col: string;
  value: string;
  original?: unknown;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-dbz-blue-light">
        {colLabel(col)}
        <span className="ml-2 font-mono font-normal normal-case text-white/25">{col}</span>
      </label>
      <SmartField table={table} col={col} value={value} original={original} onChange={onChange} />
    </div>
  );
}
