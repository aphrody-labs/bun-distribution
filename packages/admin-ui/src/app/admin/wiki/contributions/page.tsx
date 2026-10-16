"use client";

/**
 * /admin/wiki/contributions — relecture des propositions de la communauté.
 *
 * Un écran, une décision : le diff mot à mot entre le texte en ligne et celui
 * que propose le contributeur, ses sources, puis accepter ou refuser. Accepter
 * applique la valeur par le chemin d'écriture normal et journalise la révision
 * **au nom du contributeur** — donc annulable depuis /admin/wiki/history comme
 * n'importe quelle édition.
 *
 * Refuser sans note est possible mais découragé : la note est la seule réponse
 * que recevra la personne qui a pris le temps de lire une planche.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chargement, Coche, Croix, LienExterne } from "@shenron/ui/icones";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlainField } from "@/components/editor/PlainField";
import { ContributionRightsPanel } from "@aphrody/admin-ui/components/admin/ContributionRightsPanel";
import {
  CONTRIBUTABLE_COLUMNS,
  CONTRIBUTION_STATUS_LABELS,
  type ContributionStatusKey,
} from "@/lib/contributions-shared";

interface Row {
  id: string;
  createdAt: string;
  authorName: string | null;
  tableName: string;
  rowId: string;
  columnName: string;
  entityLabel: string | null;
  entityPath: string | null;
  valueBefore: string | null;
  valueAfter: string;
  comment: string | null;
  sources: string | null;
  status: ContributionStatusKey;
  reviewerName: string | null;
  reviewNote: string | null;
  revisionId: string | null;
}

type Reponse = { rows: Row[]; total: number; counts: Record<string, number> };

const ONGLETS: { key: string; label: string }[] = [
  { key: "pending", label: "En attente" },
  { key: "accepted", label: "Acceptées" },
  { key: "rejected", label: "Refusées" },
  { key: "superseded", label: "Obsolètes" },
  { key: "", label: "Toutes" },
];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Diff par LIGNES, pas par caractères : une correction porte presque toujours
 * sur une phrase, et un diff caractère à caractère sur 20 Ko de markdown est
 * illisible. Algorithme volontairement naïf (préfixe/suffixe communs) — il
 * suffit à isoler le passage touché, ce qui est tout ce qu'on demande ici.
 */
function diffLignes(avant: string, apres: string) {
  const a = avant.split("\n");
  const b = apres.split("\n");
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let fin = 0;
  while (fin < a.length - debut && fin < b.length - debut && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++;
  return {
    contexteAvant: a.slice(Math.max(0, debut - 2), debut),
    retire: a.slice(debut, a.length - fin),
    ajoute: b.slice(debut, b.length - fin),
    contexteApres: a.slice(a.length - fin, a.length - fin + 2),
    identique: debut === a.length && debut === b.length,
  };
}

export default function PageContributions() {
  const [statut, setStatut] = useState("pending");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Reponse>({
    queryKey: ["wiki-contributions", statut],
    queryFn: async () => {
      const url = `/api/admin/wiki-contributions?limit=100${statut ? `&status=${statut}` : ""}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`contributions ${res.status}`);
      return res.json() as Promise<Reponse>;
    },
  });

  const moderer = useMutation({
    mutationFn: async (v: { id: string; action: "accept" | "reject"; note?: string }) => {
      const res = await fetch("/api/admin/wiki-contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(v),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Échec");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-contributions"] }),
  });

  const counts = data?.counts ?? {};

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-saiyan text-2xl text-white">Contributions de la communauté</h1>
        <p className="mt-1 text-sm text-white/50">
          Les corrections proposées depuis les fiches. Une acceptation applique le texte et crédite son auteur dans{" "}
          <Link href="/admin/wiki/history" className="text-dbz-orange underline-offset-2 hover:underline">
            l&apos;historique
          </Link>
          .
        </p>
      </header>

      {/* Qui a le droit de proposer. Réglé ici, à côté de la file d'attente
			    qu'il alimente : c'est en voyant passer les propositions qu'on décide
			    de resserrer ou d'ouvrir. */}
      <details className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-5 py-3.5 font-display text-[14px] font-semibold text-white/85 transition-colors hover:text-white">
          Qui peut contribuer&nbsp;?
          <span className="ml-2 text-[12px] font-normal text-white/40">rôles et membres autorisés, par périmètre</span>
        </summary>
        <div className="border-t border-white/[0.08] p-5">
          <ContributionRightsPanel />
        </div>
      </details>

      <nav className="flex flex-wrap gap-2">
        {ONGLETS.map(o => {
          const n = o.key ? counts[o.key] : undefined;
          const actif = statut === o.key;
          return (
            <button
              key={o.key || "all"}
              type="button"
              onClick={() => setStatut(o.key)}
              className={
                actif
                  ? "rounded-full bg-dbz-orange px-4 py-1.5 text-xs font-bold text-black"
                  : "rounded-full border border-white/12 px-4 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:border-white/30 hover:text-white"
              }
            >
              {o.label}
              {n ? <span className="ml-1.5 opacity-70">{n}</span> : null}
            </button>
          );
        })}
      </nav>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-white/40">
          <Chargement className="h-4 w-4 animate-spin" /> Chargement…
        </p>
      ) : !data?.rows.length ? (
        <p className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-10 text-center text-sm text-white/40">
          {statut === "pending" ? "Aucune proposition en attente." : "Rien à afficher pour ce filtre."}
        </p>
      ) : (
        <ul className="space-y-4">
          {data.rows.map(r => (
            <CarteContribution
              key={r.id}
              row={r}
              onModerer={(action, note) => moderer.mutate({ id: r.id, action, note })}
              enCours={moderer.isPending}
              erreur={moderer.isError ? (moderer.error as Error).message : null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CarteContribution({
  row,
  onModerer,
  enCours,
  erreur,
}: {
  row: Row;
  onModerer: (action: "accept" | "reject", note?: string) => void;
  enCours: boolean;
  erreur: string | null;
}) {
  const [note, setNote] = useState("");
  const [deplie, setDeplie] = useState(false);
  const champ = CONTRIBUTABLE_COLUMNS[row.columnName];
  const diff = useMemo(() => diffLignes(row.valueBefore ?? "", row.valueAfter), [row.valueBefore, row.valueAfter]);

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white">
            {row.entityLabel ?? `${row.tableName} #${row.rowId}`}
            <span className="ml-2 rounded border border-white/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
              {champ?.label ?? row.columnName}
            </span>
          </h2>
          <p className="mt-1 text-xs text-white/45">
            {row.authorName ?? "Anonyme"} · {fmtDate(row.createdAt)}
            {row.status !== "pending" ? (
              <>
                {" · "}
                <span className="text-white/60">{CONTRIBUTION_STATUS_LABELS[row.status]}</span>
                {row.reviewerName ? ` par ${row.reviewerName}` : ""}
              </>
            ) : null}
          </p>
        </div>
        {row.entityPath ? (
          <a
            href={row.entityPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-white/45 transition-colors hover:text-dbz-orange"
          >
            <LienExterne className="h-3 w-3" /> Voir la fiche
          </a>
        ) : null}
      </div>

      {row.sources ? (
        <p className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs leading-relaxed text-emerald-200/80">
          <strong className="font-semibold">Sources :</strong> {row.sources}
        </p>
      ) : (
        <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200/75">
          Aucune source indiquée — à vérifier avant d&apos;accepter.
        </p>
      )}

      {row.comment ? <p className="mt-2 text-xs italic leading-relaxed text-white/55">« {row.comment} »</p> : null}

      <div className="mt-3 overflow-hidden rounded-lg border border-white/8 bg-black/40 font-mono text-[11px] leading-relaxed">
        {diff.contexteAvant.map((l, i) => (
          <pre key={`c-${i}`} className="whitespace-pre-wrap px-3 py-0.5 text-white/30">
            {l || " "}
          </pre>
        ))}
        {diff.retire.slice(0, deplie ? undefined : 12).map((l, i) => (
          <pre key={`r-${i}`} className="whitespace-pre-wrap bg-dbz-red/10 px-3 py-0.5 text-dbz-red/90">
            − {l}
          </pre>
        ))}
        {diff.ajoute.slice(0, deplie ? undefined : 12).map((l, i) => (
          <pre key={`a-${i}`} className="whitespace-pre-wrap bg-emerald-500/10 px-3 py-0.5 text-emerald-300/90">
            + {l}
          </pre>
        ))}
        {diff.contexteApres.map((l, i) => (
          <pre key={`d-${i}`} className="whitespace-pre-wrap px-3 py-0.5 text-white/30">
            {l || " "}
          </pre>
        ))}
        {!deplie && (diff.retire.length > 12 || diff.ajoute.length > 12) ? (
          <button
            type="button"
            onClick={() => setDeplie(true)}
            className="w-full bg-white/[0.03] px-3 py-1.5 text-center text-[11px] font-semibold text-white/50 hover:text-white"
          >
            Afficher les {Math.max(diff.retire.length, diff.ajoute.length) - 12} lignes restantes
          </button>
        ) : null}
      </div>

      {row.status === "pending" ? (
        <div className="mt-3 space-y-2">
          <PlainField
            name={`note-${row.id}`}
            label="Réponse au contributeur"
            hideLabel
            value={note}
            onChange={setNote}
            minRows={1}
            maxRows={4}
            maxLength={1000}
            placeholder="Un mot au contributeur (obligatoire si tu refuses)…"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={enCours}
              onClick={() => onModerer("accept", note)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Coche className="h-3.5 w-3.5" /> Accepter et publier
            </button>
            <button
              type="button"
              disabled={enCours || !note.trim()}
              title={note.trim() ? undefined : "Explique le refus : c'est la seule réponse qu'aura le contributeur."}
              onClick={() => onModerer("reject", note)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-dbz-red/50 hover:text-dbz-red disabled:opacity-40"
            >
              <Croix className="h-3.5 w-3.5" /> Refuser
            </button>
            {erreur ? <span className="text-xs text-dbz-red">{erreur}</span> : null}
          </div>
        </div>
      ) : row.reviewNote ? (
        <p className="mt-3 text-xs text-white/45">Réponse : {row.reviewNote}</p>
      ) : null}
    </li>
  );
}
