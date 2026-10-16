"use client";

/**
 * Édition en place pour les pages db-universe (vues server-rendered).
 * Bolt-on sur n'importe quelle table : édite/supprime une ligne ou en ajoute
 * une via l'API CRUD générique du bot (`/api/database/:table[/:id]`), puis
 * `router.refresh()` pour recharger la vue server. Les pages restent des RSC.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Alerte,
  Corbeille,
  Crayon,
  Croix,
  Enregistrer,
  Plus,
} from "@/components/icones";
import { SmartField } from "@aphrody/admin-ui/components/admin/SmartField";
import { api, apiAt } from "@aphrody/admin-ui/client";
import { colLabel } from "@/lib/db-labels";
import { buildSubmitBody, isStudioTable } from "@/lib/wiki-fields";
import { WIKI_TABLE_SPECS, crudBase, isWikiTable } from "@/lib/wiki-tables";

interface TableSpec {
  name: string;
  pk: string;
  readonly: boolean;
  mutableColumns: string[];
  description: string | null;
}

/**
 * Client + chemin CRUD pour une table :
 *   - wiki éditoriale → `apiAt("/api/wiki-admin")` + `/:table[/:id]` (Neon direct)
 *   - sinon → `api` (proxy bot) + `/database/:table[/:id]`
 */
function useCrud(table: string) {
  const wiki = isWikiTable(table);
  const client = wiki ? apiAt(crudBase(table)) : api;
  const collection = wiki ? `/${table}` : `/database/${table}`;
  const row = (id: string | number) =>
    `${collection}/${encodeURIComponent(String(id))}`;
  return { client, collection, row };
}

function useTableSpec(table: string): TableSpec | undefined {
  // Tables wiki : schéma statique (camelCase), aucun appel au bot.
  const wikiSpec = WIKI_TABLE_SPECS[table];
  const q = useQuery({
    queryKey: ["db", "tables"],
    queryFn: () => api.get<{ tables: TableSpec[] }>("/database/tables"),
    staleTime: 5 * 60_000,
    enabled: !wikiSpec,
  });
  if (wikiSpec) {
    return {
      name: wikiSpec.name,
      pk: Array.isArray(wikiSpec.pk) ? wikiSpec.pk.join(",") : wikiSpec.pk,
      readonly: false,
      mutableColumns: wikiSpec.mutableColumns,
      description: null,
    };
  }
  return q.data?.tables.find((t) => t.name === table);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function fireToast(type: "success" | "error", msg: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("dbcrud-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "dbcrud-toast";
    el.className = "fixed top-4 right-4 z-[100]";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="rounded-lg border px-4 py-3 text-sm shadow-xl ${
    type === "success"
      ? "border-green-500/50 bg-dbz-card text-green-300"
      : "border-red-500/50 bg-dbz-card text-red-300"
  }">${msg.replace(/</g, "&lt;")}</div>`;
  if (toastTimer) clearTimeout(toastTimer);
  const node = el;
  toastTimer = setTimeout(() => {
    node.innerHTML = "";
  }, 3500);
}

// ── Bouton "Ajouter une entrée" (création) ────────────────────────────────
export function DbAddButton({
  table,
  label = "Ajouter",
}: {
  table: string;
  label?: string;
}) {
  const spec = useTableSpec(table);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const crud = useCrud(table);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      crud.client.post(crud.collection, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["db", table] });
      setOpen(false);
      fireToast("success", "Entrée créée.");
      router.refresh();
    },
    onError: (err: Error) => fireToast("error", `Échec : ${err.message}`),
  });

  if (!spec || spec.readonly) return null;

  // Entités « contenu » → studio visuel (form + aperçu live + upload images).
  if (isStudioTable(table)) {
    return (
      <Link
        href={`/admin/wiki/studio/${table}/new`}
        className="dbz-button inline-flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        {label}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="dbz-button inline-flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>
      {open && (
        <FieldModal
          table={table}
          mode="create"
          title="Nouvelle entrée"
          subtitle={spec.name}
          columns={spec.mutableColumns}
          initial={{}}
          saving={create.isPending}
          onClose={() => setOpen(false)}
          onSave={(body) => create.mutate(body)}
        />
      )}
    </>
  );
}

// ── Actions par ligne (éditer / supprimer) ────────────────────────────────
export function DbRowActions({
  table,
  id,
}: {
  table: string;
  id: string | number;
}) {
  const spec = useTableSpec(table);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const crud = useCrud(table);

  // Charge la ligne canonique (casing API) à l'ouverture de l'édition.
  const row = useQuery({
    queryKey: ["db", table, "row", id],
    queryFn: () => crud.client.get<Record<string, unknown>>(crud.row(id)),
    enabled: editing,
  });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      crud.client.put(crud.row(id), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["db", table] });
      setEditing(false);
      fireToast("success", "Entrée modifiée.");
      router.refresh();
    },
    onError: (err: Error) => fireToast("error", `Échec : ${err.message}`),
  });

  const remove = useMutation({
    mutationFn: () => crud.client.delete(crud.row(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["db", table] });
      setConfirming(false);
      fireToast("success", "Entrée supprimée.");
      router.refresh();
    },
    onError: (err: Error) => {
      setConfirming(false);
      fireToast("error", `Échec : ${err.message}`);
    },
  });

  if (!spec || spec.readonly) return null;

  const studio = isStudioTable(table);

  return (
    <div className="flex justify-end gap-1">
      {studio ? (
        <Link
          href={`/admin/wiki/studio/${table}/${encodeURIComponent(String(id))}`}
          title="Modifier (studio visuel)"
          className="inline-flex items-center justify-center w-7 h-7 rounded border border-dbz-border text-dbz-blue-light hover:border-dbz-orange hover:text-dbz-orange transition-colors"
        >
          <Crayon className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Modifier"
          className="inline-flex items-center justify-center w-7 h-7 rounded border border-dbz-border text-dbz-blue-light hover:border-dbz-orange hover:text-dbz-orange transition-colors"
        >
          <Crayon className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Supprimer"
        className="inline-flex items-center justify-center w-7 h-7 rounded border border-dbz-border text-red-400 hover:border-red-500/60 hover:bg-red-500/10 transition-colors"
      >
        <Corbeille className="h-3.5 w-3.5" />
      </button>

      {editing && !studio && (
        <FieldModal
          table={table}
          mode="edit"
          title="Modifier l'entrée"
          subtitle={`${spec.name} · ${spec.pk} = ${id}`}
          columns={spec.mutableColumns}
          initial={row.data ?? {}}
          loading={row.isLoading}
          saving={update.isPending}
          onClose={() => setEditing(false)}
          onSave={(body) => update.mutate(body)}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur">
          <div className="dbz-panel w-full max-w-md p-6">
            <div className="mb-4 flex items-center gap-3">
              <Alerte className="h-6 w-6 text-red-400 shrink-0" />
              <h3 className="font-saiyan text-lg uppercase text-red-400">
                Supprimer cette entrée ?
              </h3>
            </div>
            <p className="mb-1 text-sm text-white/70">
              Entrée{" "}
              <code className="font-mono text-xs text-dbz-orange">{id}</code> de{" "}
              <strong className="text-white">{spec.name}</strong>.
            </p>
            <p className="mb-6 text-sm font-semibold text-red-400/80">
              Cette action est irréversible.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={remove.isPending}
                className="btn btn-ghost"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="btn btn-danger"
              >
                <Corbeille className="h-3.5 w-3.5" />
                {remove.isPending ? "Suppression…" : "Oui, supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modale de formulaire (création + édition) ─────────────────────────────
function FieldModal({
  table,
  mode,
  title,
  subtitle,
  columns,
  initial,
  onClose,
  onSave,
  saving,
  loading,
}: {
  table: string;
  mode: "create" | "edit";
  title: string;
  subtitle: string;
  columns: string[];
  initial: Record<string, unknown>;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  saving: boolean;
  loading?: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Réhydrate quand la ligne canonique arrive (édition).
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        columns.map((c) => [c, initial[c] != null ? String(initial[c]) : ""]),
      ),
    );
  }, [columns, initial]);

  const submit = () => {
    onSave(buildSubmitBody(draft, initial, columns, { mode }));
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <div className="dbz-panel max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="font-saiyan text-lg uppercase text-dbz-orange">
              {title}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-white/50">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost px-2"
            aria-label="Fermer"
          >
            <Croix className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-white/50">
            Chargement…
          </div>
        ) : (
          <div className="space-y-3">
            {columns.map((c) => (
              <div key={c}>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-dbz-blue-light">
                  {colLabel(c)}
                  <span className="ml-2 font-mono text-white/25 normal-case font-normal">
                    {c}
                  </span>
                </label>
                <SmartField
                  table={table}
                  col={c}
                  value={draft[c] ?? ""}
                  original={initial[c]}
                  onChange={(v) => setDraft((d) => ({ ...d, [c]: v }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-dbz-border/40 pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || loading}
            className="btn btn-primary"
          >
            <Enregistrer className="h-3 w-3" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
