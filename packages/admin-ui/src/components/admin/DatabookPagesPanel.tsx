"use client";

/**
 * Panneau studio : pages d'un databook / interview (jsonb `pages`).
 *
 * Format manga-like : chaque slot = numéro (auto, modifiable) + image
 * (optionnelle) + texte sous l'image. On fixe d'abord le **nombre de pages**
 * (slots réservés, pas besoin de tout remplir). Save dédiée (jsonb exclu de
 * SmartField / buildSubmitBody).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chargement, ChevronBas, ChevronHaut, Corbeille, Diese, Enregistrer, Plus } from "@shenron/ui/icones";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import { apiAt } from "@aphrody/admin-ui/client";
import { crudBase } from "@/lib/wiki-tables";
import { PlainField } from "../editor/PlainField";

export interface DatabookPageDraft {
  /** Clé React stable (jamais persistée). */
  _key: string;
  /** Numéro affiché (auto 1…N, éditable). Stocké en string dans le form. */
  number: string;
  image: string;
  text: string;
  /**
   * Drapeau « relue à l'image » posé par le relecteur (`TranscriptionRelecteur`).
   * Le panel ne l'édite pas, il le TRANSPORTE : cet écran renvoie le tableau
   * `pages` entier, donc toute clé qu'il ne relit pas est effacée au premier
   * enregistrement — la planche acquittée redeviendrait « à vérifier ».
   */
  verifiee: boolean;
}

let keySeq = 0;
/** Pages affichées d'un bloc ; « voir plus » élargit la fenêtre. */
const FENETRE = 20;

function newKey(): string {
  keySeq += 1;
  return `dbp-${Date.now().toString(36)}-${keySeq}`;
}

function parseNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) {
    return Math.trunc(Number(raw));
  }
  return fallback;
}

function normalizePages(raw: unknown): DatabookPageDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p, i) => ({
      _key: newKey(),
      number: String(parseNumber(p.number, i + 1)),
      image: typeof p.image === "string" ? p.image : "",
      text: typeof p.text === "string" ? p.text : "",
      verifiee: p.verifiee === true,
    }));
}

/** Prochain numéro libre = max des numéros existants + 1 (ou 1 si vide). */
function nextAutoNumber(pages: DatabookPageDraft[]): number {
  let max = 0;
  for (const p of pages) {
    const n = Number(p.number);
    if (Number.isFinite(n) && n > max) max = Math.trunc(n);
  }
  return max + 1;
}

function emptyPage(number: number): DatabookPageDraft {
  return {
    _key: newKey(),
    number: String(number),
    image: "",
    text: "",
    verifiee: false,
  };
}

/** Snapshot comparable (sans _key) pour dirty detection. */
function snapshot(pages: DatabookPageDraft[]): string {
  return JSON.stringify(
    pages.map(p => ({
      number: parseNumber(p.number, 0),
      image: p.image.trim(),
      text: p.text.trim(),
      verifiee: p.verifiee,
    })),
  );
}

export function DatabookPagesPanel({ databookId }: { databookId: string }) {
  const client = apiAt(crudBase("db_databooks"));
  const qc = useQueryClient();
  const [pages, setPages] = useState<DatabookPageDraft[]>([]);
  // Fenêtrage + filtre. Sans eux, le panneau rendait TOUTES les pages d'un coup,
  // chacune avec son champ image : 233 blocs et 233 images sur la fiche la plus
  // fournie. Ingérable — et la transcription de masse rendrait la relecture
  // (11 775 planches) impossible sans « n'afficher que ce qui reste à faire ».
  const [filtre, setFiltre] = useState<"tous" | "sans-texte" | "avec-texte">("tous");
  const [fenetre, setFenetre] = useState(FENETRE);

  const transcrites = pages.filter(p => p.text.trim().length > 0).length;
  // On conserve l'INDEX D'ORIGINE : tous les gestionnaires (renuméroter,
  // supprimer, déplacer) raisonnent sur la position réelle dans `pages`, pas
  // sur celle de la vue filtrée.
  const affichees = pages
    .map((page, i) => ({ page, i }))
    .filter(({ page }) =>
      filtre === "tous" ? true : filtre === "avec-texte" ? page.text.trim().length > 0 : page.text.trim().length === 0,
    );
  const [savedSnap, setSavedSnap] = useState("[]");
  const [countInput, setCountInput] = useState("0");
  const [startFrom, setStartFrom] = useState("1");
  const [toast, setToast] = useState<string | null>(null);
  const listEndRef = useRef<HTMLLIElement | null>(null);
  const scrollNew = useRef(false);

  // Pas de rafraîchissement en arrière-plan : une fois hydraté, le formulaire est
  // l'état maître. Avec les réglages par défaut du dashboard (staleTime 30 s +
  // refetch au retour de focus), un simple aller-retour vers un autre onglet
  // ré-hydratait le panneau et effaçait SANS AVERTIR toutes les planches saisies
  // depuis le dernier enregistrement — le garde `beforeunload` ne couvre que la
  // fermeture de l'onglet, pas ce cas-là. Même contrat que `WikiStudio`.
  const row = useQuery({
    queryKey: ["wiki-studio", "db_databooks", databookId, "pages"],
    queryFn: () => client.get<Record<string, unknown>>(`/db_databooks/${encodeURIComponent(databookId)}`),
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const hydrateId = useRef<string | null>(null);
  useEffect(() => {
    if (!row.data || hydrateId.current === databookId) return;
    hydrateId.current = databookId;
    const next = normalizePages(row.data.pages);
    setPages(next);
    setSavedSnap(snapshot(next));
    setCountInput(String(next.length));
    if (next.length > 0) {
      const first = Number(next[0]?.number);
      if (Number.isFinite(first)) setStartFrom(String(first));
    }
  }, [row.data, databookId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // Garde anti-fermeture d'onglet avec modifications non sauvées.
  const dirty = useMemo(() => snapshot(pages) !== savedSnap, [pages, savedSnap]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!scrollNew.current) return;
    scrollNew.current = false;
    listEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [pages.length]);

  const save = useMutation({
    mutationFn: async () => {
      const cleaned = pages.map((p, i) => {
        const out: {
          number: number;
          image?: string;
          text?: string;
          verifiee?: true;
        } = {
          number: parseNumber(p.number, i + 1),
        };
        const img = p.image.trim();
        const txt = p.text.trim();
        if (img) out.image = img;
        if (txt) out.text = txt;
        if (p.verifiee) out.verifiee = true;
        return out;
      });
      return client.put(`/db_databooks/${encodeURIComponent(databookId)}`, {
        pages: cleaned,
      });
    },
    onSuccess: () => {
      setSavedSnap(snapshot(pages));
      qc.invalidateQueries({
        queryKey: ["wiki-studio", "db_databooks", databookId],
      });
      setToast("Pages enregistrées — cache public revalidé.");
    },
    onError: (e: Error) => setToast(`Erreur : ${e.message}`),
  });

  // Confirmation, création de clés et écriture des champs voisins vivent HORS du
  // `setPages` : un updater de state doit rester pur. React peut le rejouer
  // (StrictMode, rendu concurrent) — la boîte de dialogue s'ouvrait alors deux
  // fois et `newKey()` brûlait des clés en double.
  const resizeTo = (n: number) => {
    // Certains databooks dépassent 300 planches (ex. illustration books) → plafond 400.
    const target = Math.max(0, Math.min(400, Math.floor(n)));
    if (target === pages.length) {
      setCountInput(String(pages.length));
      return;
    }
    if (target < pages.length) {
      const dropped = pages.slice(target);
      const lostFilled = dropped.some(p => p.image.trim() || p.text.trim());
      if (
        lostFilled &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Réduire à ${target} page(s) supprimera ${dropped.length} slot(s) dont du contenu rempli. Continuer ?`,
        )
      ) {
        setCountInput(String(pages.length));
        return;
      }
      setPages(arr => arr.slice(0, target));
      setCountInput(String(target));
      return;
    }
    const added: DatabookPageDraft[] = [];
    let nextN = nextAutoNumber(pages);
    for (let k = 0; k < target - pages.length; k++) {
      added.push(emptyPage(nextN));
      nextN += 1;
    }
    scrollNew.current = true;
    setPages(arr => [...arr, ...added]);
    setCountInput(String(target));
  };

  /** Renumérote à partir de `startFrom` dans l'ordre actuel. */
  const renumberFrom = () => {
    const start = Math.max(0, Math.trunc(Number(startFrom) || 1));
    setPages(arr => arr.map((p, i) => ({ ...p, number: String(start + i) })));
    setToast(`Numéros remis à ${start}…${start + Math.max(0, pages.length - 1)} (pense à enregistrer).`);
  };

  const update = (i: number, patch: Partial<DatabookPageDraft>) =>
    setPages(arr => arr.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const move = (i: number, dir: -1 | 1) =>
    setPages(arr => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      const current = next[i];
      const target = next[j];
      if (current === undefined || target === undefined) return arr;
      next[i] = target;
      next[j] = current;
      return next;
    });

  const remove = (i: number) => {
    const page = pages[i];
    if (
      page &&
      (page.image.trim() || page.text.trim()) &&
      typeof window !== "undefined" &&
      !window.confirm(`Supprimer la page n°${page.number || i + 1} (contenu non vide) ?`)
    ) {
      return;
    }
    setPages(arr => arr.filter((_, j) => j !== i));
    setCountInput(String(Math.max(0, pages.length - 1)));
  };

  const dupNumbers = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<string>();
    for (const p of pages) {
      const n = p.number.trim();
      if (!n) continue;
      if (seen.has(n)) dups.add(n);
      else seen.set(n, 1);
    }
    return dups;
  }, [pages]);

  if (row.isLoading) {
    return (
      <div className="dbz-panel flex items-center gap-2 p-5 text-sm text-white/50">
        <Chargement className="h-4 w-4 animate-spin" /> Chargement des pages…
      </div>
    );
  }

  if (row.isError) {
    return <div className="dbz-panel p-5 text-sm text-red-400">Impossible de charger les pages de ce databook.</div>;
  }

  const filled = pages.filter(p => p.image.trim() || p.text.trim()).length;

  return (
    <div className="dbz-panel space-y-4 p-5">
      {toast && (
        <div
          role="status"
          className="rounded border border-dbz-orange/40 bg-dbz-orange/10 px-3 py-2 text-xs text-dbz-orange"
        >
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-saiyan text-sm uppercase tracking-wider text-dbz-orange">Pages du lecteur</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-white/50">
            Comme le manga : une planche par page, avec un <strong className="text-white/60">numéro</strong> (auto,
            modifiable) et un <strong className="text-white/60">texte en dessous</strong>. Fixe le nombre de pages
            d&apos;abord — tu n&apos;es pas obligé de tout remplir. L&apos;ordre de lecture = ordre des slots ; le n°
            est juste l&apos;étiquette affichée.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Non enregistré
            </span>
          )}
          <span className="rounded border border-dbz-border/50 bg-white/[0.03] px-2 py-1 text-[10px] uppercase tracking-wider text-white/50">
            {filled}/{pages.length} remplie{pages.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {dupNumbers.size > 0 && (
        <p className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
          Numéros en double : {Array.from(dupNumbers).join(", ")}. Tu peux les garder (ex. recto/verso) ou les corriger
          / renuméroter.
        </p>
      )}

      {/* Nombre de pages + actions */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dbz-border/40 bg-black/20 p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
            Nombre de pages
          </span>
          <input
            type="number"
            min={0}
            max={400}
            value={countInput}
            onChange={e => setCountInput(e.target.value)}
            onBlur={() => {
              const n = Number(countInput);
              if (Number.isFinite(n)) resizeTo(n);
              else setCountInput(String(pages.length));
            }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                const n = Number(countInput);
                if (Number.isFinite(n)) resizeTo(n);
              }
            }}
            className="input h-9 w-24 text-center font-mono tabular-nums"
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost h-9 px-3 text-xs"
          onClick={() => {
            const n = Number(countInput);
            if (Number.isFinite(n)) resizeTo(n);
          }}
        >
          Appliquer
        </button>
        <button
          type="button"
          className="btn btn-ghost h-9 px-3 text-xs"
          onClick={() => {
            const page = emptyPage(nextAutoNumber(pages));
            scrollNew.current = true;
            setPages(arr => [...arr, page]);
            setCountInput(String(pages.length + 1));
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter
        </button>

        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
            Renuméroter depuis
          </span>
          <input
            type="number"
            min={0}
            value={startFrom}
            onChange={e => setStartFrom(e.target.value)}
            className="input h-9 w-20 text-center font-mono tabular-nums"
            title="Premier numéro de la séquence"
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost h-9 px-3 text-xs"
          disabled={pages.length === 0}
          onClick={renumberFrom}
          title="Remet les numéros en séquence à partir du départ choisi"
        >
          <Diese className="h-3.5 w-3.5" />
          Renuméroter
        </button>

        <button
          type="button"
          className="btn btn-primary ml-auto h-9 px-4 text-xs"
          disabled={save.isPending || !dirty}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Chargement className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Enregistrer className="h-3.5 w-3.5" />
          )}
          Enregistrer les pages
        </button>
      </div>

      {pages.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/50">
          Aucune page. Indique un nombre ci-dessus ou clique « Ajouter ».
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-white/70">
              {transcrites}/{pages.length} page(s) transcrite(s)
            </span>
            <div className="ml-auto flex gap-1" role="group" aria-label="Filtrer les pages">
              {(
                [
                  ["tous", `Toutes (${pages.length})`],
                  ["sans-texte", `À transcrire (${pages.length - transcrites})`],
                  ["avec-texte", `Transcrites (${transcrites})`],
                ] as const
              ).map(([cle, libelle]) => (
                <button
                  key={cle}
                  type="button"
                  onClick={() => {
                    setFiltre(cle);
                    setFenetre(FENETRE);
                  }}
                  aria-pressed={filtre === cle}
                  className={`rounded-md border px-2.5 py-1 font-semibold transition-colors ${
                    filtre === cle
                      ? "border-dbz-orange bg-dbz-orange/10 text-white"
                      : "border-white/15 text-white/60 hover:border-white/35 hover:text-white"
                  }`}
                >
                  {libelle}
                </button>
              ))}
            </div>
          </div>

          {affichees.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/50">Aucune page ne correspond à ce filtre.</p>
          ) : (
            <ul className="space-y-4">
              {affichees.slice(0, fenetre).map(({ page, i }) => {
                const displayN = page.number.trim() || String(i + 1);
                const isDup = dupNumbers.has(page.number.trim());
                const isLast = i === pages.length - 1;
                return (
                  <li
                    key={page._key}
                    ref={isLast ? listEndRef : undefined}
                    className="rounded-lg border border-dbz-border/50 bg-black/25 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <label
                        className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 ${
                          isDup ? "bg-amber-500/20 ring-1 ring-amber-400/50" : "bg-dbz-orange/15"
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider text-dbz-orange/80">N°</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          className="w-14 border-0 bg-transparent p-0 text-center font-mono text-[12px] font-bold tabular-nums text-dbz-orange outline-none focus:ring-0"
                          value={page.number}
                          onChange={e => update(i, { number: e.target.value })}
                          onBlur={() => {
                            const n = Number(page.number);
                            if (!Number.isFinite(n)) update(i, { number: String(i + 1) });
                            else update(i, { number: String(Math.trunc(n)) });
                          }}
                          aria-label={`Numéro de la page (slot ${i + 1})`}
                          title="Numéro affiché (auto, modifiable)"
                        />
                      </label>
                      <span className="text-[10px] text-white/50">
                        slot {i + 1}
                        {displayN !== String(i + 1) ? ` · affiché n°${displayN}` : ""}
                      </span>
                      {!page.image.trim() && !page.text.trim() && (
                        <span className="text-[10px] uppercase tracking-wider text-white/50">Slot vide</span>
                      )}
                      {isDup && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                          Doublon
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost h-7 px-2"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          title="Monter (change l'ordre de lecture, pas le n°)"
                          aria-label={`Monter la page ${displayN}`}
                        >
                          <ChevronHaut className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost h-7 px-2"
                          disabled={i === pages.length - 1}
                          onClick={() => move(i, 1)}
                          title="Descendre (change l'ordre de lecture, pas le n°)"
                          aria-label={`Descendre la page ${displayN}`}
                        >
                          <ChevronBas className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost h-7 px-2 text-red-400 hover:border-red-500/50 hover:bg-red-500/10"
                          onClick={() => remove(i)}
                          title="Supprimer ce slot"
                          aria-label={`Supprimer la page ${displayN}`}
                        >
                          <Corbeille className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
                          Image (planche)
                        </span>
                        <ImageField
                          value={page.image}
                          onChange={v => update(i, { image: v })}
                          subdir="databooks"
                          column={`page-${displayN}`}
                        />
                      </div>
                      <div>
                        {/* `htmlFor` : sans lui le libellé flottait à côté du champ, qui restait
												    sans nom accessible. */}
                        <label
                          htmlFor={`dbp-texte-${page._key}`}
                          className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light"
                        >
                          Texte sous l&apos;image
                        </label>
                        <PlainField
                          id={`dbp-texte-${page._key}`}
                          value={page.text}
                          onChange={v => update(i, { text: v })}
                          minRows={6}
                          maxRows={24}
                          placeholder="Description, légende, notes… (affiché sous la planche sur la page publique)"
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {affichees.length > fenetre && (
            <button
              type="button"
              onClick={() => setFenetre(f => f + FENETRE)}
              className="mt-4 w-full rounded-lg border border-white/15 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-dbz-orange hover:text-white"
            >
              Voir {Math.min(FENETRE, affichees.length - fenetre)} page(s) de plus ·{" "}
              {Math.min(fenetre, affichees.length)}/{affichees.length}
            </button>
          )}
        </>
      )}

      {pages.length > 0 && (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={save.isPending || !dirty}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Chargement className="h-4 w-4 animate-spin" /> : <Enregistrer className="h-4 w-4" />}
          {dirty ? "Enregistrer les pages" : "À jour"}
        </button>
      )}
    </div>
  );
}
