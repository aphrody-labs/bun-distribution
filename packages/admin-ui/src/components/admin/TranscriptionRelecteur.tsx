"use client";

/**
 * Relecture planche par planche d'un databook transcrit.
 *
 * Le studio propose déjà un éditeur de pages (`DatabookPagesPanel`), mais il est
 * conçu pour *construire* une fiche : un bloc par planche, empilés, avec champ
 * image et champ texte. Sur un ouvrage de 362 planches c'est le mauvais outil
 * pour relire — on ne voit jamais la planche en grand à côté de son texte, et
 * chaque enregistrement réémet le tableau `pages` entier, donc écrase tout dépôt
 * de transcription arrivé entre-temps.
 *
 * Ici : une planche à la fois, scan à gauche, texte à droite, navigation au
 * clavier, et une écriture ciblée (`PATCH /api/databooks/:id/pages`) qui ne
 * touche que la planche affichée.
 *
 * Le texte transcrit est du markdown (1 357 planches commencent par un titre
 * `#`) — d'où l'onglet Aperçu, qui montre ce que le lecteur public verra.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Pencil,
  Save,
  Languages,
  ScanText,
  Sparkles,
  Wand2,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TranscriptionTexte } from "@/components/databooks/TranscriptionTexte";
import { assetUrl } from "@/lib/assets";
import {
  aBesoinDeNettoyage,
  diagnostiquerPlanche,
  nettoyerOcr,
} from "@/lib/databooks-format";
import { PlainField } from "@/components/editor/PlainField";

export interface PlancheRelecture {
  numero: number;
  image: string | null;
  texte: string;
  /** Acquittée à la main : les signatures de défaut se taisent pour elle. */
  verifiee: boolean;
}

type Filtre = "toutes" | "a-transcrire" | "transcrites" | "suspectes";

/** Une graphie jugée fautive, telle que la rend `/api/databooks/:id/anomalies`. */
interface AnomalieJa {
  lu: string;
  attendu: string;
  fr: string;
  kind: string;
  distance: number;
}

interface AnomaliesReponse {
  total: number;
  planches: Record<number, AnomalieJa[]>;
  analysePossible: boolean;
}

/**
 * Une region lue par le second moteur OCR, telle que la rend
 * `/api/databooks/:id/relecture-ocr`.
 */
interface RegionLue {
  texte: string;
  score: number;
  boite: Array<[number, number]> | null;
}

interface RelectureReponse {
  planche: number;
  regions: RegionLue[];
  texte?: string;
  secondes?: number;
  cache?: boolean;
  indisponible?: boolean;
  sansScan?: boolean;
  detail?: string;
}

const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: "toutes", libelle: "Toutes" },
  { cle: "a-transcrire", libelle: "À transcrire" },
  { cle: "transcrites", libelle: "Transcrites" },
  { cle: "suspectes", libelle: "À vérifier" },
];

/**
 * Planche à vérifier : un défaut irréparable, ET pas encore acquittée.
 *
 * Les signatures sont mécaniques, donc faillibles — une couverture de V Jump
 * ne porte que « 3月号 » et « COVER », ce qui lève deux défauts (« 9 caractères
 * seulement », « idéogrammes sans un seul kana ») sur une transcription
 * pourtant exacte. Sans acquittement, ces planches-là restaient dans la file à
 * perpétuité et le relecteur n'avait aucun moyen de dire « j'ai regardé, c'est
 * bon ».
 */
function estSuspecte(planche: { texte: string; verifiee: boolean }): boolean {
  if (planche.verifiee) return false;
  return diagnostiquerPlanche(planche.texte).some((a) => !a.reparable);
}

export function TranscriptionRelecteur({
  databookId,
  titre,
  planchesInitiales,
  filtreInitial = "toutes",
  plancheInitiale,
}: {
  databookId: number;
  titre: string;
  planchesInitiales: PlancheRelecture[];
  filtreInitial?: Filtre;
  plancheInitiale?: number;
}) {
  const [planches, setPlanches] = useState(planchesInitiales);
  const [filtre, setFiltre] = useState<Filtre>(filtreInitial);
  const [onglet, setOnglet] = useState<"editer" | "apercu">("editer");
  const [toast, setToast] = useState<string | null>(null);

  /**
   * Fautes de lecture japonaises, calculées pour l'ouvrage entier.
   *
   * Une requête par ouvrage et non par planche : le verdict « c'est une
   * faute » se prend en comparant des fréquences, et une planche seule n'en
   * fournit aucune. L'analyse charge en outre un dictionnaire morphologique —
   * la refaire à chaque changement de page serait absurde.
   */
  const anomaliesJa = useQuery({
    queryKey: ["databook-anomalies", databookId],
    queryFn: async (): Promise<AnomaliesReponse> => {
      const r = await fetch(`/api/databooks/${databookId}/anomalies`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("analyse indisponible");
      return r.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  /**
   * Seconde lecture de la planche courante, par un moteur d'une autre famille.
   *
   * Chargée **à la demande** et non à chaque changement de planche : une
   * planche jamais lue coûte quelques secondes de processeur sur la machine
   * qui sert aussi le site. Une fois lue elle revient en quelques
   * millisecondes, le service la mettant en cache par empreinte du scan.
   *
   * Ce moteur n'est pas « meilleur » que celui qui a produit la
   * transcription : il est utile parce que ses erreurs sont d'une autre
   * nature. Son vocabulaire est fermé — 86 hiragana, 94 katakana,
   * 15 565 kanji, zéro caractère arabe — donc il ne peut écrire ni les
   * intrusions d'alphabet ni une boucle dégénérée. Il ne rend en revanche
   * aucune mise en page : ses régions sortent dans l'ordre du détecteur, pas
   * dans l'ordre de lecture japonais. C'est un second avis, jamais un
   * remplacement de la transcription.
   */
  const [plancheRelue, setPlancheRelue] = useState<number | null>(null);
  const relecture = useQuery({
    queryKey: ["databook-relecture-ocr", databookId, plancheRelue],
    enabled: plancheRelue !== null,
    queryFn: async (): Promise<RelectureReponse> => {
      const r = await fetch(
        `/api/databooks/${databookId}/relecture-ocr?planche=${plancheRelue}`,
        {
          cache: "no-store",
        },
      );
      if (!r.ok) throw new Error("seconde lecture indisponible");
      return r.json();
    },
    staleTime: Infinity,
    retry: false,
  });

  const visibles = useMemo(() => {
    if (filtre === "toutes") return planches;
    return planches.filter((p) =>
      filtre === "transcrites"
        ? p.texte.trim().length > 0
        : filtre === "a-transcrire"
          ? p.texte.trim().length === 0
          : estSuspecte(p),
    );
  }, [planches, filtre]);

  const [numeroCourant, setNumeroCourant] = useState(
    () => plancheInitiale ?? planchesInitiales[0]?.numero ?? 0,
  );

  const courante = planches.find((p) => p.numero === numeroCourant) ?? null;
  const indexVisible = visibles.findIndex((p) => p.numero === numeroCourant);

  // Dernière position connue dans la liste filtrée. Mémorisée pendant le rendu,
  // donc encore valide au rendu suivant, où la planche a pu sortir du filtre.
  const dernierIndexVisible = useRef(0);
  if (indexVisible >= 0) dernierIndexVisible.current = indexVisible;

  // Le filtre peut faire disparaître la planche affichée — c'est le cas normal
  // après un enregistrement en mode « À transcrire » / « À vérifier ». Retomber
  // sur `visibles[0]` renvoyait alors au début de l'ouvrage à chaque sauvegarde ;
  // on reprend à la position qu'occupait la planche, c'est-à-dire la suivante.
  useEffect(() => {
    if (visibles.length === 0) return;
    if (!visibles.some((p) => p.numero === numeroCourant)) {
      const i = Math.min(dernierIndexVisible.current, visibles.length - 1);
      setNumeroCourant(visibles[i].numero);
    }
  }, [visibles, numeroCourant]);

  // Brouillon local : le texte en cours de saisie n'est pas dans `planches`,
  // qui ne reçoit que ce qui a été effectivement écrit en base.
  const [brouillon, setBrouillon] = useState(courante?.texte ?? "");
  const [ancre, setAncre] = useState(numeroCourant);
  if (ancre !== numeroCourant) {
    // Changement de planche : on recharge le brouillon depuis l'état enregistré.
    setAncre(numeroCourant);
    setBrouillon(courante?.texte ?? "");
  }

  const anomaliesPlanche = anomaliesJa.data?.planches?.[numeroCourant] ?? [];
  const modifie = (courante?.texte ?? "") !== brouillon;
  const anomalies = diagnostiquerPlanche(brouillon);
  const nettoyable = aBesoinDeNettoyage(brouillon);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!modifie) return;
    const avant = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, [modifie]);

  const enregistrer = useMutation({
    mutationFn: async (texte: string) => {
      const r = await fetch(`/api/databooks/${databookId}/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: numeroCourant,
          text: texte.trim() || null,
        }),
      });
      if (!r.ok) {
        throw new Error(
          (await r.json().catch(() => null))?.error ??
            "Enregistrement impossible.",
        );
      }
      return (await r.json()) as { number: number; text: string | null };
    },
    onSuccess: (rep) => {
      setPlanches((arr) =>
        arr.map((p) =>
          p.numero === rep.number ? { ...p, texte: rep.text ?? "" } : p,
        ),
      );
      setToast(`Planche n°${rep.number} enregistrée.`);
    },
    onError: (e: Error) => setToast(`Erreur : ${e.message}`),
  });

  /**
   * Acquittement d'une planche : « j'ai comparé au scan, le texte est bon ».
   *
   * Il n'écrit PAS le texte — c'est le même endroit dans le jsonb, mais deux
   * gestes différents : acquitter une planche pendant qu'on a un brouillon en
   * cours déposerait une transcription non relue sous couvert de validation.
   * Le bouton est donc désactivé tant que la saisie n'est pas enregistrée.
   */
  const acquitter = useMutation({
    mutationFn: async (verifiee: boolean) => {
      const r = await fetch(`/api/databooks/${databookId}/pages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: numeroCourant, verifiee }),
      });
      if (!r.ok) {
        throw new Error(
          (await r.json().catch(() => null))?.error ?? "Écriture impossible.",
        );
      }
      return (await r.json()) as { number: number; verifiee: boolean };
    },
    onSuccess: (rep) => {
      setPlanches((arr) =>
        arr.map((p) =>
          p.numero === rep.number ? { ...p, verifiee: rep.verifiee } : p,
        ),
      );
      setToast(
        rep.verifiee
          ? `Planche n°${rep.number} marquée vérifiée — plus d'avertissement au lecteur.`
          : `Acquittement retiré sur la planche n°${rep.number}.`,
      );
    },
    onError: (e: Error) => setToast(`Erreur : ${e.message}`),
  });

  /**
   * Point de passage unique de toute navigation entre planches.
   *
   * Changer de planche recharge le brouillon depuis l'état enregistré : sans
   * garde-fou, un Alt+← ou un clic dans l'index efface la saisie en cours sans
   * rien dire (dix minutes de relecture perdues, badge « Non enregistré » à
   * l'écran). `beforeunload` ne couvre que la fermeture de l'onglet.
   */
  const allerVers = useCallback(
    (numero: number) => {
      if (numero === numeroCourant) return;
      if (
        modifie &&
        !window.confirm(
          `La planche n°${numeroCourant} a des modifications non enregistrées. Les abandonner ?`,
        )
      ) {
        return;
      }
      setNumeroCourant(numero);
    },
    [modifie, numeroCourant],
  );

  const aller = useCallback(
    (delta: -1 | 1) => {
      if (visibles.length === 0) return;
      const i = visibles.findIndex((p) => p.numero === numeroCourant);
      const suivant =
        visibles[Math.min(visibles.length - 1, Math.max(0, i + delta))];
      if (suivant) allerVers(suivant.numero);
    },
    [visibles, numeroCourant, allerVers],
  );

  // Raccourcis : Alt+flèches pour naviguer (les flèches nues doivent rester
  // disponibles dans le champ de saisie), Ctrl/Cmd+S pour enregistrer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (modifie && !enregistrer.isPending) enregistrer.mutate(brouillon);
        return;
      }
      if (!e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        aller(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        aller(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aller, brouillon, modifie, enregistrer]);

  const transcrites = planches.filter((p) => p.texte.trim().length > 0).length;
  const compteurs: Record<Filtre, number> = {
    toutes: planches.length,
    "a-transcrire": planches.length - transcrites,
    transcrites,
    suspectes: planches.filter((p) => estSuspecte(p)).length,
  };

  const imageUrl = courante?.image ? assetUrl(courante.image) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* ── Index des planches ───────────────────────────────────────────── */}
      <aside className="dbz-panel flex max-h-[80vh] flex-col p-3">
        {anomaliesJa.data && anomaliesJa.data.total > 0 && (
          <p className="mb-2 rounded border border-dbz-blue-light/25 bg-dbz-blue-light/[0.06] px-2 py-1 text-[10px] leading-snug text-dbz-blue-light">
            {anomaliesJa.data.total} graphie
            {anomaliesJa.data.total > 1 ? "s" : ""} japonaise
            {anomaliesJa.data.total > 1 ? "s" : ""} à vérifier dans cet ouvrage
          </p>
        )}
        <div className="mb-2 flex flex-wrap gap-1">
          {FILTRES.map(({ cle, libelle }) => (
            <button
              key={cle}
              type="button"
              onClick={() => setFiltre(cle)}
              aria-pressed={filtre === cle}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                filtre === cle
                  ? "border-dbz-orange bg-dbz-orange/10 text-white"
                  : "border-white/15 text-white/55 hover:border-white/35 hover:text-white"
              }`}
            >
              {libelle}
              <span className="ml-1 tabular-nums text-white/40">
                {compteurs[cle]}
              </span>
            </button>
          ))}
        </div>

        {visibles.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/40">
            Aucune planche pour ce filtre.
          </p>
        ) : (
          <ol className="-mr-1 grid grid-cols-4 gap-1 overflow-y-auto pr-1">
            {visibles.map((p) => {
              const vide = p.texte.trim().length === 0;
              const alerte = !vide && estSuspecte(p);
              const active = p.numero === numeroCourant;
              const aDesFautesJa =
                (anomaliesJa.data?.planches?.[p.numero]?.length ?? 0) > 0;
              return (
                <li key={p.numero}>
                  <button
                    type="button"
                    onClick={() => allerVers(p.numero)}
                    aria-current={active ? "true" : undefined}
                    data-ja={aDesFautesJa ? "" : undefined}
                    title={[
                      vide
                        ? `Planche ${p.numero} — à transcrire`
                        : alerte
                          ? `Planche ${p.numero} — à vérifier`
                          : `Planche ${p.numero} — transcrite`,
                      aDesFautesJa
                        ? `${anomaliesJa.data!.planches[p.numero].length} graphie(s) japonaise(s) douteuse(s)`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className={`w-full rounded border py-1 text-center font-mono text-[10px] tabular-nums transition-colors ${
                      aDesFautesJa && !active
                        ? "underline decoration-dbz-blue-light decoration-2 underline-offset-2 "
                        : ""
                    }${
                      active
                        ? "border-dbz-orange bg-dbz-orange/20 text-white"
                        : alerte
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:border-amber-400"
                          : vide
                            ? "border-white/10 text-white/35 hover:border-white/30 hover:text-white/70"
                            : "border-green-500/25 bg-green-500/5 text-green-200/80 hover:border-green-400/60"
                    }`}
                  >
                    {p.numero}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </aside>

      {/* ── Planche courante ─────────────────────────────────────────────── */}
      <div className="dbz-panel flex min-w-0 flex-col p-4">
        {toast && (
          <div
            role="status"
            className="mb-3 rounded border border-dbz-orange/40 bg-dbz-orange/10 px-3 py-2 text-xs text-dbz-orange"
          >
            {toast}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost h-8 px-2"
            disabled={indexVisible <= 0}
            onClick={() => aller(-1)}
            aria-label="Planche précédente (Alt + flèche gauche)"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="rounded bg-dbz-orange/15 px-2 py-1 font-mono text-xs font-bold tabular-nums text-dbz-orange">
            p. {numeroCourant}
          </span>
          <button
            type="button"
            className="btn btn-ghost h-8 px-2"
            disabled={indexVisible < 0 || indexVisible >= visibles.length - 1}
            onClick={() => aller(1)}
            aria-label="Planche suivante (Alt + flèche droite)"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-[11px] text-white/40">
            {indexVisible >= 0 ? indexVisible + 1 : 0}/{visibles.length}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {modifie && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Non enregistré
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                setOnglet(onglet === "editer" ? "apercu" : "editer")
              }
              className="btn btn-ghost h-8 px-2 text-[11px]"
              title="Bascule entre la saisie et le rendu markdown public"
            >
              {onglet === "editer" ? (
                <>
                  <Eye className="h-3.5 w-3.5" /> Aperçu
                </>
              ) : (
                <>
                  <Pencil className="h-3.5 w-3.5" /> Éditer
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-primary h-8 px-3 text-[11px]"
              disabled={!modifie || enregistrer.isPending}
              onClick={() => enregistrer.mutate(brouillon)}
              title="Ctrl + S"
            >
              {enregistrer.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Enregistrer
            </button>
          </div>
        </div>

        {!courante ? (
          <p className="py-10 text-center text-sm text-white/50">
            Aucune planche à afficher.
          </p>
        ) : (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {/* Scan */}
            <div className="min-w-0">
              {imageUrl ? (
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                  title="Ouvrir le scan en pleine résolution"
                >
                  <Image
                    src={imageUrl}
                    alt={`Planche ${numeroCourant} de ${titre}`}
                    width={900}
                    height={1300}
                    className="h-auto max-h-[70vh] w-full rounded border border-dbz-border/50 object-contain"
                    unoptimized
                  />
                </a>
              ) : (
                <div className="flex h-64 items-center justify-center rounded border border-dashed border-white/15 text-xs text-white/35">
                  Aucun scan pour cette planche
                </div>
              )}
            </div>

            {/* Texte */}
            <div className="flex min-w-0 flex-col">
              {onglet === "editer" ? (
                <PlainField
                  className="flex-1"
                  value={brouillon}
                  onChange={setBrouillon}
                  spellCheck={false}
                  label={`Transcription de la planche ${numeroCourant}`}
                  hideLabel
                  minRows={18}
                  maxRows={60}
                  placeholder="Transcription de la planche (markdown accepté)…"
                />
              ) : (
                <div className="min-h-[50vh] flex-1 overflow-y-auto rounded border border-dbz-border/50 bg-black/25 p-4">
                  {brouillon.trim() ? (
                    <TranscriptionTexte texte={brouillon} />
                  ) : (
                    <p className="text-sm italic text-white/40">
                      Aucun texte à prévisualiser.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                <span className="tabular-nums">{brouillon.length} signes</span>
                {nettoyable && (
                  <button
                    type="button"
                    onClick={() => setBrouillon((t) => nettoyerOcr(t))}
                    className="inline-flex items-center gap-1 rounded border border-dbz-border/60 px-2 py-1 font-semibold text-dbz-blue-light transition-colors hover:border-dbz-orange hover:text-dbz-orange"
                    title="Retire les espaces et sauts de ligne superflus, sans toucher au texte"
                  >
                    <Sparkles className="h-3 w-3" />
                    Nettoyer la mise en forme
                  </button>
                )}
                <span className="ml-auto text-white/30">
                  Alt + ← / → pour naviguer · Ctrl + S pour enregistrer
                </span>
              </div>

              {/* Fautes de lecture japonaises : proposées, jamais appliquées seules. */}
              {anomaliesPlanche.length > 0 && (
                <div className="mt-2 rounded border border-dbz-blue-light/25 bg-dbz-blue-light/[0.06] p-2">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-dbz-blue-light">
                    <Languages className="h-3 w-3" />
                    Lecture japonaise · {anomaliesPlanche.length} graphie
                    {anomaliesPlanche.length > 1 ? "s" : ""} à vérifier
                  </p>
                  <ul className="space-y-1">
                    {anomaliesPlanche.map((a) => {
                      const present = brouillon.includes(a.lu);
                      return (
                        <li
                          key={a.lu}
                          className="flex flex-wrap items-center gap-1.5 text-[11px]"
                        >
                          <code className="font-jp rounded bg-red-500/15 px-1 text-red-200">
                            {a.lu}
                          </code>
                          <span className="text-white/35">→</span>
                          <code className="font-jp rounded bg-green-500/15 px-1 text-green-200">
                            {a.attendu}
                          </code>
                          <span className="text-white/45">{a.fr}</span>
                          <button
                            type="button"
                            disabled={!present}
                            onClick={() =>
                              setBrouillon((t) => t.replaceAll(a.lu, a.attendu))
                            }
                            title={
                              present
                                ? `Remplacer « ${a.lu} » par « ${a.attendu} » dans cette planche`
                                : "Graphie absente du texte affiché"
                            }
                            className="ml-auto inline-flex items-center gap-1 rounded border border-dbz-border/60 px-1.5 py-0.5 font-semibold text-dbz-blue-light transition-colors hover:border-dbz-orange hover:text-dbz-orange disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Wand2 className="h-2.5 w-2.5" />
                            Corriger
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1.5 text-[10px] leading-snug text-white/35">
                    Suggestions issues du croisement dictionnaire japonais +
                    lexique du wiki. Environ 15 % sont fausses — le scan à
                    gauche tranche.
                  </p>
                </div>
              )}

              {/* Seconde lecture : un autre moteur, d'autres erreurs. Jamais un dépôt. */}
              <div className="mt-2 rounded border border-dbz-border/50 bg-white/[0.02] p-2">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                    <ScanText className="h-3 w-3" />
                    Seconde lecture
                  </p>
                  {relecture.data?.secondes !== undefined && (
                    <span className="text-[10px] text-white/30">
                      {relecture.data.cache
                        ? "en cache"
                        : `lue en ${relecture.data.secondes} s`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPlancheRelue(numeroCourant)}
                    disabled={relecture.isFetching || !courante?.image}
                    title={
                      courante?.image
                        ? "Relire ce scan avec un second moteur OCR, dont le vocabulaire fermé ne peut pas produire d'intrusion d'alphabet"
                        : "Aucun scan pour cette planche"
                    }
                    className="ml-auto inline-flex items-center gap-1 rounded border border-dbz-border/60 px-1.5 py-0.5 text-[11px] font-semibold text-white/60 transition-colors hover:border-dbz-orange hover:text-dbz-orange disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ScanText className="h-2.5 w-2.5" />
                    {plancheRelue === numeroCourant && relecture.data
                      ? "Relire"
                      : "Lire le scan"}
                  </button>
                </div>

                {relecture.isFetching && plancheRelue === numeroCourant ? (
                  <p className="text-[11px] text-white/40">Lecture du scan…</p>
                ) : plancheRelue !== numeroCourant ? (
                  <p className="text-[10px] leading-snug text-white/35">
                    Un second moteur (détection + CRNN) relit le scan. Son
                    vocabulaire est fermé : il ne peut écrire ni caractère
                    étranger intrus, ni boucle. En revanche il ne restitue pas
                    la mise en page — à lire comme un avis, pas comme un
                    remplacement.
                  </p>
                ) : relecture.data?.sansScan ? (
                  <p className="text-[11px] text-white/40">
                    Aucun scan pour cette planche.
                  </p>
                ) : relecture.data?.indisponible ? (
                  <p className="text-[11px] text-amber-300/70">
                    Service de seconde lecture indisponible.
                    {relecture.data.detail ? ` (${relecture.data.detail})` : ""}
                  </p>
                ) : relecture.error ? (
                  <p className="text-[11px] text-amber-300/70">
                    {(relecture.error as Error).message}
                  </p>
                ) : relecture.data && relecture.data.regions.length === 0 ? (
                  <p className="text-[11px] text-white/40">
                    Aucun texte détecté sur ce scan.
                  </p>
                ) : relecture.data ? (
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
                    {relecture.data.regions.map((r, i) => {
                      const deja = brouillon.includes(r.texte);
                      return (
                        <li
                          key={`${i}-${r.texte}`}
                          className="flex items-start gap-1.5 text-[11px]"
                        >
                          <span
                            className={`mt-[3px] shrink-0 tabular-nums ${
                              r.score >= 0.9
                                ? "text-green-300/60"
                                : r.score >= 0.7
                                  ? "text-white/35"
                                  : "text-amber-300/60"
                            }`}
                            title="Confiance du moteur sur cette région"
                          >
                            {r.score.toFixed(2)}
                          </span>
                          <code
                            className={`font-jp flex-1 break-all ${
                              deja ? "text-white/30" : "text-white/80"
                            }`}
                            title={
                              deja ? "Déjà présent dans le texte" : undefined
                            }
                          >
                            {r.texte}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              setBrouillon((t) =>
                                t.trimEnd()
                                  ? `${t.trimEnd()}\n${r.texte}`
                                  : r.texte,
                              )
                            }
                            title="Ajouter cette région à la fin du texte"
                            className="shrink-0 rounded border border-dbz-border/50 px-1 py-px text-[10px] text-white/40 transition-colors hover:border-dbz-orange hover:text-dbz-orange"
                          >
                            +
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              {/* Acquittement : le juge est mécanique, l'œil tranche. */}
              {(anomalies.some((a) => !a.reparable) || courante?.verifiee) && (
                <div
                  className={`mt-2 flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-[11px] ${
                    courante?.verifiee
                      ? "border-green-500/30 bg-green-500/[0.06] text-green-200/90"
                      : "border-white/10 bg-white/[0.03] text-white/55"
                  }`}
                >
                  {courante?.verifiee ? (
                    <>
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Planche vérifiée à la main : les avertissements
                        ci-dessous sont ignorés, et le lecteur public n&apos;en
                        voit aucun.
                      </span>
                    </>
                  ) : (
                    <span>
                      Les signaux ci-dessous sont mécaniques : une couverture
                      qui ne porte que « 3月号 » et « COVER » les déclenche
                      alors que sa transcription est exacte.
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={acquitter.isPending || modifie}
                    onClick={() => acquitter.mutate(!courante?.verifiee)}
                    title={
                      modifie
                        ? "Enregistrez la transcription avant de la déclarer vérifiée."
                        : courante?.verifiee
                          ? "Retirer l'acquittement : la planche repasse « à vérifier »."
                          : "Déclarer cette transcription conforme au scan malgré les signaux automatiques."
                    }
                    className="ml-auto inline-flex items-center gap-1 rounded border border-dbz-border/60 px-2 py-0.5 font-semibold text-white/70 transition-colors hover:border-dbz-orange hover:text-dbz-orange disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {acquitter.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <BadgeCheck className="h-3 w-3" />
                    )}
                    {courante?.verifiee
                      ? "Retirer la vérification"
                      : "Vérifier quand même"}
                  </button>
                </div>
              )}

              {anomalies.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {anomalies.map((a) => (
                    <li
                      key={a.code}
                      className={`flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] ${
                        a.reparable
                          ? "border-white/10 bg-white/[0.03] text-white/55"
                          : "border-amber-500/30 bg-amber-500/5 text-amber-200/90"
                      }`}
                    >
                      {a.reparable ? (
                        <Check className="mt-0.5 h-3 w-3 shrink-0" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      )}
                      {a.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
