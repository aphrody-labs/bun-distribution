"use client";

/**
 * Éditeur de la doctrine de canonicité appliquée par `/wiki/canon`.
 *
 * Tout ce que le moteur sait tenir pour vrai se règle ici : la définition de
 * chaque rang, les règles générales rappelées sous chaque verdict, les sources
 * admises et refusées, les sujets déjà tranchés et les familles de formulations
 * qui servent de repli. Rien n'est deviné ailleurs — c'est la réponse au
 * reproche « il se base sur des trucs d'internet ».
 *
 * Le banc d'essai en bas de page exécute le **même** moteur que la page
 * publique, sur l'état en cours d'édition : on voit le verdict que produirait la
 * doctrine avant de l'enregistrer.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Alerte,
  Chargement,
  Coche,
  Corbeille,
  FlecheBas,
  FlecheHaut,
  Plus,
  Recherche,
  Reinitialiser,
} from "@/components/icones";
import {
  analyzeCanon,
  CANON_TIERS,
  type CanonConfig,
  type CanonHeuristic,
  type CanonReference,
  type CanonTier,
  type CanonTopicEntry,
  type PowerScalingMultiplier,
} from "@/lib/canon-engine";

const CATEGORIES: { value: CanonTopicEntry["category"]; label: string }[] = [
  { value: "character", label: "Personnage" },
  { value: "form", label: "Transformation" },
  { value: "lore", label: "Lore" },
  { value: "work", label: "Œuvre" },
  { value: "myth", label: "Mythe" },
];

// ── Briques de formulaire ───────────────────────────────────────────────────

const champClasse =
  "w-full rounded-lg border border-dbz-border bg-black/30 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-dbz-orange/60";

function Champ({
  label,
  aide,
  children,
}: {
  label: string;
  aide?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider text-white/50">
        {label}
      </span>
      {children}
      {aide && <span className="block text-[11px] text-white/35">{aide}</span>}
    </label>
  );
}

function Texte({
  value,
  onChange,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  if (rows) {
    return (
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${champClasse} resize-y leading-relaxed`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={champClasse}
    />
  );
}

function ChoixRang({
  value,
  onChange,
  tiers,
}: {
  value: CanonTier;
  onChange: (v: CanonTier) => void;
  tiers: CanonConfig["tiers"];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CanonTier)}
      className={champClasse}
    >
      {CANON_TIERS.map((t) => (
        <option key={t} value={t}>
          {tiers.find((x) => x.id === t)?.court ?? t}
        </option>
      ))}
    </select>
  );
}

/**
 * Une liste de phrases (règles, sources, œuvres incluses).
 *
 * Chaque ligne est un champ à part et non un bloc de texte découpé sur les
 * retours à la ligne : une règle de doctrine tient parfois sur deux phrases, et
 * un découpage implicite la couperait en deux règles fausses.
 */
function ListeDeLignes({
  valeurs,
  onChange,
  placeholder,
  ajout = "Ajouter une ligne",
  libelle = "Ligne",
}: {
  valeurs: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  ajout?: string;
  /** Nom lu par les lecteurs d'écran, numéroté ligne par ligne. */
  libelle?: string;
}) {
  const modifier = (i: number, v: string) =>
    onChange(valeurs.map((ligne, index) => (index === i ? v : ligne)));
  const supprimer = (i: number) =>
    onChange(valeurs.filter((_, index) => index !== i));
  const deplacer = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= valeurs.length) return;
    const suivant = [...valeurs];
    [suivant[i], suivant[j]] = [suivant[j]!, suivant[i]!];
    onChange(suivant);
  };

  return (
    <div className="space-y-1.5">
      {valeurs.map((ligne, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => deplacer(i, -1)}
              disabled={i === 0}
              aria-label={`Monter ${libelle.toLowerCase()} ${i + 1}`}
              className="inline-flex h-5 w-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-20"
            >
              <FlecheHaut className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => deplacer(i, 1)}
              disabled={i === valeurs.length - 1}
              aria-label={`Descendre ${libelle.toLowerCase()} ${i + 1}`}
              className="inline-flex h-5 w-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-20"
            >
              <FlecheBas className="h-3 w-3" />
            </button>
          </div>
          <input
            type="text"
            value={ligne}
            placeholder={placeholder}
            aria-label={`${libelle} ${i + 1}`}
            onChange={(e) => modifier(i, e.target.value)}
            className={champClasse}
          />
          <button
            type="button"
            onClick={() => supprimer(i)}
            aria-label={`Supprimer ${libelle.toLowerCase()} ${i + 1}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/40 hover:bg-red-500/10 hover:text-red-400"
          >
            <Corbeille className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...valeurs, ""])}
        className="inline-flex items-center gap-1.5 text-[11px] text-white/50 hover:text-dbz-orange"
      >
        <Plus className="h-3 w-3" />
        {ajout}
      </button>
    </div>
  );
}

/** Mots-clés séparés par des virgules — la forme la plus rapide à corriger. */
function MotsCles({
  valeurs,
  onChange,
}: {
  valeurs: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Texte
      value={valeurs.join(", ")}
      placeholder="broly, paragus, super saiyan legendaire"
      onChange={(v) =>
        onChange(
          v
            .split(",")
            .map((m) => m.trim())
            .filter((m, i, all) => m !== "" && all.indexOf(m) === i),
        )
      }
    />
  );
}

function Section({
  titre,
  sous,
  children,
}: {
  titre: string;
  sous: string;
  children: React.ReactNode;
}) {
  return (
    <section className="dbz-panel space-y-4 p-4">
      <div>
        <h2 className="font-saiyan text-sm text-white">{titre}</h2>
        <p className="text-[11px] leading-relaxed text-white/45">{sous}</p>
      </div>
      {children}
    </section>
  );
}

// ── Éditeur ─────────────────────────────────────────────────────────────────

export default function CanonEditor({
  initial,
  defaults,
}: {
  initial: CanonConfig;
  defaults: CanonConfig;
}) {
  const [config, setConfig] = useState<CanonConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [essai, setEssai] = useState("");
  const [filtreRef, setFiltreRef] = useState("");
  const [toutesRefs, setToutesRefs] = useState(false);
  /** Modifications en attente d'enregistrement — la page en fait 8 000 px. */
  const [modifie, setModifie] = useState(false);

  const patch = (p: Partial<CanonConfig>) => {
    setConfig((c) => ({ ...c, ...p }));
    setModifie(true);
    setMsg(null);
  };

  /*
   * Fermer l'onglet perdrait plus de trois cents champs sans le moindre
   * avertissement : la doctrine n'existe que dans cet état local tant que
   * l'enregistrement n'a pas eu lieu.
   */
  useEffect(() => {
    if (!modifie) return;
    const avertir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [modifie]);

  const verdictEssai = useMemo(
    () => (essai.trim() ? analyzeCanon(essai, config) : null),
    [essai, config],
  );

  async function enregistrer() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/canon-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        config?: CanonConfig;
        error?: string;
      };
      if (res.ok && data.ok && data.config) {
        setConfig(data.config);
        setMsg({
          ok: true,
          text: "Doctrine enregistrée — /wiki/canon l'applique immédiatement.",
        });
      } else {
        setMsg({ ok: false, text: data.error ?? "Échec de l'enregistrement." });
      }
    } catch {
      setMsg({ ok: false, text: "Erreur réseau." });
    } finally {
      setSaving(false);
    }
  }

  // ── Sujets tranchés ────────────────────────────────────────────────────
  const majEntree = (i: number, p: Partial<CanonTopicEntry>) =>
    patch({
      entries: config.entries.map((e, index) =>
        index === i ? { ...e, ...p } : e,
      ),
    });

  const ajouterEntree = () =>
    patch({
      entries: [
        {
          id: "",
          title: "",
          category: "lore",
          tier: "CANON_ABSOLU",
          score: 100,
          keywords: [],
          verdict: "",
          explanation: "",
          sources: [],
        },
        ...config.entries,
      ],
    });

  const majReference = (id: string, p: Partial<CanonReference>) =>
    patch({
      references: config.references.map((r) =>
        r.id === id ? { ...r, ...p } : r,
      ),
    });

  const refsFiltrees = useMemo(() => {
    const q = filtreRef.trim().toLowerCase();
    if (!q) return config.references;
    return config.references.filter((r) =>
      `${r.subject} ${r.keywords.join(" ")} ${r.text} ${r.source}`
        .toLowerCase()
        .includes(q),
    );
  }, [config.references, filtreRef]);

  const parDocument = useMemo(() => {
    const compte = new Map<string, number>();
    for (const r of config.references)
      compte.set(r.source, (compte.get(r.source) ?? 0) + 1);
    return [...compte.entries()].toSorted((a, b) => b[1] - a[1]);
  }, [config.references]);

  const majRegle = (i: number, p: Partial<CanonHeuristic>) =>
    patch({
      heuristics: config.heuristics.map((h, index) =>
        index === i ? { ...h, ...p } : h,
      ),
    });

  return (
    <div className="space-y-4 pb-24">
      {/* Barre d'action ------------------------------------------------- */}
      {/*
       * Le `sticky` porte sur l'enveloppe et non sur le panneau : `.dbz-panel`
       * applique `relative`, qui écrase l'utilitaire `sticky` posé sur le même
       * élément. Le décalage tient compte de l'en-tête collant de 64 px.
       */}
      <div className="sticky top-[4.5rem] z-20">
        <div className="dbz-panel flex flex-wrap items-center justify-between gap-3 p-4 backdrop-blur">
          <div>
            <p className="text-sm text-white/70">
              <strong className="text-dbz-orange">
                {config.entries.length}
              </strong>{" "}
              sujets tranchés ·{" "}
              <strong className="text-dbz-orange">
                {config.heuristics.length}
              </strong>{" "}
              familles de formulations ·{" "}
              <strong className="text-dbz-orange">
                {config.references.length}
              </strong>{" "}
              citations d&apos;auteur
            </p>
            <p className="text-[11px] text-white/45">
              {modifie ? (
                <span className="text-dbz-yellow">
                  Modifications non enregistrées — la doctrine publique n&apos;a
                  pas encore changé.
                </span>
              ) : (
                <>
                  Le moteur de <code>/wiki/canon</code> ne connaît que ce qui
                  est écrit sur cette page.
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfig(structuredClone(defaults));
                setMsg({
                  ok: true,
                  text: "Doctrine du dépôt rechargée — rien n'est enregistré tant que tu ne cliques pas sur Enregistrer.",
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dbz-border px-3 py-2 text-[12px] text-white/60 hover:border-dbz-orange/50 hover:text-white"
            >
              <Reinitialiser className="h-3.5 w-3.5" />
              Rétablir les défauts
            </button>
            <button
              type="button"
              onClick={enregistrer}
              disabled={saving}
              className="dbz-button gap-2 disabled:opacity-50"
            >
              {saving ? (
                <Chargement className="h-4 w-4 animate-spin" />
              ) : (
                <Coche className="h-4 w-4" />
              )}
              Enregistrer
            </button>
          </div>
        </div>
      </div>

      {msg && (
        <p
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}
        >
          {!msg.ok && <Alerte className="h-4 w-4" />}
          {msg.text}
        </p>
      )}

      {/* Présentation ---------------------------------------------------- */}
      <Section
        titre="Présentation publique"
        sous="Ce que le lecteur lit avant de poser sa question, et l'exemple affiché dans la barre."
      >
        <Champ label="Promesse affichée sous la barre">
          <Texte
            rows={3}
            value={config.intro}
            onChange={(v) => patch({ intro: v })}
            placeholder="Le verdict vient d'une table curée à la main…"
          />
        </Champ>
        <Champ label="Exemple de question">
          <Texte
            value={config.placeholder}
            onChange={(v) => patch({ placeholder: v })}
            placeholder="Broly est-il canonique ?"
          />
        </Champ>
      </Section>

      {/* Doctrine -------------------------------------------------------- */}
      <Section
        titre="Règles générales"
        sous="Rappelées sous chaque verdict. C'est la hiérarchie des sources : ce qui l'emporte quand deux supports se contredisent."
      >
        <ListeDeLignes
          valeurs={config.doctrine}
          onChange={(v) => patch({ doctrine: v })}
          placeholder="Le manga original en 42 tomes prime sur tout le reste."
          ajout="Ajouter une règle"
          libelle="Règle générale"
        />
      </Section>

      {/* Sources --------------------------------------------------------- */}
      <Section
        titre="Sources"
        sous="Ce sur quoi le moteur a le droit de s'appuyer, et ce qu'il refuse. Les sources refusées servent de garde-fou lors des relectures."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Champ label="Sources admises">
            <ListeDeLignes
              valeurs={config.sourcesAdmises}
              onChange={(v) => patch({ sourcesAdmises: v })}
              placeholder="Manga Dragon Ball, tomes 1 à 42"
              ajout="Ajouter une source admise"
              libelle="Source admise"
            />
          </Champ>
          <Champ label="Sources refusées">
            <ListeDeLignes
              valeurs={config.sourcesInterdites}
              onChange={(v) => patch({ sourcesInterdites: v })}
              placeholder="Wikis de fans"
              ajout="Ajouter une source refusée"
              libelle="Source refusée"
            />
          </Champ>
        </div>
      </Section>

      {/* Rangs ----------------------------------------------------------- */}
      <Section
        titre="Définitions des rangs"
        sous="Les cinq niveaux de canonicité. Le vocabulaire est fixe ; le libellé, la couleur, le score et surtout la définition sont à toi."
      >
        <div className="space-y-3">
          {config.tiers.map((rang, i) => (
            <div
              key={rang.id}
              className="space-y-3 rounded-lg border border-dbz-border bg-black/20 p-3"
              style={{ borderLeft: `3px solid ${rang.couleur}` }}
            >
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto_auto]">
                <Champ label="Libellé long">
                  <Texte
                    value={rang.label}
                    onChange={(v) =>
                      patch({
                        tiers: config.tiers.map((t, index) =>
                          index === i ? { ...t, label: v } : t,
                        ),
                      })
                    }
                  />
                </Champ>
                <Champ label="Libellé court">
                  <Texte
                    value={rang.court}
                    onChange={(v) =>
                      patch({
                        tiers: config.tiers.map((t, index) =>
                          index === i ? { ...t, court: v } : t,
                        ),
                      })
                    }
                  />
                </Champ>
                <Champ label="Score">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={rang.score}
                    onChange={(e) =>
                      patch({
                        tiers: config.tiers.map((t, index) =>
                          index === i
                            ? { ...t, score: Number(e.target.value) }
                            : t,
                        ),
                      })
                    }
                    className={`${champClasse} w-20 tabular-nums`}
                  />
                </Champ>
                <Champ label="Couleur">
                  <input
                    type="color"
                    value={rang.couleur}
                    onChange={(e) =>
                      patch({
                        tiers: config.tiers.map((t, index) =>
                          index === i ? { ...t, couleur: e.target.value } : t,
                        ),
                      })
                    }
                    className="h-9 w-14 cursor-pointer rounded-lg border border-dbz-border bg-black/30"
                  />
                </Champ>
              </div>
              <Champ
                label="Définition"
                aide="La phrase sur laquelle le moteur se base pour ranger une œuvre ici."
              >
                <Texte
                  rows={3}
                  value={rang.definition}
                  onChange={(v) =>
                    patch({
                      tiers: config.tiers.map((t, index) =>
                        index === i ? { ...t, definition: v } : t,
                      ),
                    })
                  }
                />
              </Champ>
              <Champ label="Œuvres et supports rangés ici">
                <ListeDeLignes
                  valeurs={rang.inclut}
                  onChange={(v) =>
                    patch({
                      tiers: config.tiers.map((t, index) =>
                        index === i ? { ...t, inclut: v } : t,
                      ),
                    })
                  }
                  placeholder="Manga Dragon Ball, tomes 1 à 42"
                  ajout="Ajouter une œuvre"
                  libelle="Œuvre rangée ici"
                />
              </Champ>
            </div>
          ))}
        </div>
      </Section>

      {/* Sujets tranchés -------------------------------------------------- */}
      <Section
        titre="Sujets tranchés"
        sous="Les questions dont la réponse est déjà écrite. Le moteur retient le sujet dont le plus de mots-clés apparaissent dans la question ; range du plus précis au plus large."
      >
        <button
          type="button"
          onClick={ajouterEntree}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dbz-border px-3 py-2 text-[12px] text-white/60 hover:border-dbz-orange/50 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un sujet
        </button>
        <div className="space-y-2">
          {config.entries.map((entree, i) => (
            <details
              key={`${entree.id}-${i}`}
              className="rounded-lg border border-dbz-border bg-black/20"
              open={!entree.title}
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      config.tiers.find((t) => t.id === entree.tier)?.couleur ??
                      "#9ca3af",
                  }}
                />
                <span className="font-saiyan text-sm text-white">
                  {entree.title || "Nouveau sujet"}
                </span>
                <span className="text-[11px] text-white/35">
                  {config.tiers.find((t) => t.id === entree.tier)?.court} ·{" "}
                  {entree.score}/100 · {entree.keywords.length} mots-clés
                </span>
              </summary>
              <div className="space-y-3 border-t border-dbz-border/60 p-3">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <Champ label="Titre">
                    <Texte
                      value={entree.title}
                      onChange={(v) => majEntree(i, { title: v })}
                      placeholder="Broly"
                    />
                  </Champ>
                  <Champ label="Catégorie">
                    <select
                      value={entree.category}
                      onChange={(e) =>
                        majEntree(i, {
                          category: e.target
                            .value as CanonTopicEntry["category"],
                        })
                      }
                      className={champClasse}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Champ>
                  <Champ label="Rang">
                    <ChoixRang
                      value={entree.tier}
                      tiers={config.tiers}
                      onChange={(v) => majEntree(i, { tier: v })}
                    />
                  </Champ>
                  <Champ label="Score">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={entree.score}
                      onChange={(e) =>
                        majEntree(i, { score: Number(e.target.value) })
                      }
                      className={`${champClasse} w-20 tabular-nums`}
                    />
                  </Champ>
                </div>
                <Champ
                  label="Mots-clés"
                  aide="Séparés par des virgules, sans accent de préférence. Ce sont eux qui font reconnaître la question."
                >
                  <MotsCles
                    valeurs={entree.keywords}
                    onChange={(v) => majEntree(i, { keywords: v })}
                  />
                </Champ>
                <Champ
                  label="Verdict"
                  aide="Une phrase. C'est la réponse affichée en gros."
                >
                  <Texte
                    rows={2}
                    value={entree.verdict}
                    onChange={(v) => majEntree(i, { verdict: v })}
                  />
                </Champ>
                <Champ label="Explication">
                  <Texte
                    rows={4}
                    value={entree.explanation}
                    onChange={(v) => majEntree(i, { explanation: v })}
                  />
                </Champ>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <Champ label="Citation d'Akira Toriyama (facultative)">
                    <Texte
                      rows={3}
                      value={entree.toriyamaQuote?.text ?? ""}
                      onChange={(v) =>
                        majEntree(i, {
                          toriyamaQuote: v
                            ? {
                                text: v,
                                source: entree.toriyamaQuote?.source ?? "",
                                ...(entree.toriyamaQuote?.year
                                  ? { year: entree.toriyamaQuote.year }
                                  : {}),
                              }
                            : undefined,
                        })
                      }
                      placeholder="Laisser vide plutôt qu'inventer une citation."
                    />
                  </Champ>
                  <div className="space-y-3">
                    <Champ label="Source de la citation">
                      <Texte
                        value={entree.toriyamaQuote?.source ?? ""}
                        onChange={(v) =>
                          majEntree(i, {
                            toriyamaQuote: entree.toriyamaQuote
                              ? { ...entree.toriyamaQuote, source: v }
                              : undefined,
                          })
                        }
                        placeholder="Daizenshuu 6"
                      />
                    </Champ>
                    <Champ label="Année">
                      <input
                        type="number"
                        value={entree.toriyamaQuote?.year ?? ""}
                        onChange={(e) =>
                          majEntree(i, {
                            toriyamaQuote: entree.toriyamaQuote
                              ? {
                                  ...entree.toriyamaQuote,
                                  year: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                }
                              : undefined,
                          })
                        }
                        className={`${champClasse} tabular-nums`}
                      />
                    </Champ>
                  </div>
                </div>
                <Champ label="Sources">
                  <ListeDeLignes
                    valeurs={entree.sources}
                    onChange={(v) => majEntree(i, { sources: v })}
                    placeholder="Manga DB Tome 42 (Chapitres 503-506)"
                    ajout="Ajouter une source"
                    libelle="Source du sujet"
                  />
                </Champ>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      entries: config.entries.filter((_, index) => index !== i),
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-[11px] text-white/40 hover:text-red-400"
                >
                  <Corbeille className="h-3.5 w-3.5" />
                  Supprimer ce sujet
                </button>
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* Familles de formulations ---------------------------------------- */}
      <Section
        titre="Familles de formulations"
        sous="Le repli quand aucun sujet ne répond : « filler », « manga original », « jeu vidéo ». Elles donnent un rang probable, jamais un verdict définitif. La première qui s'apparie gagne."
      >
        <button
          type="button"
          onClick={() =>
            patch({
              heuristics: [
                ...config.heuristics,
                {
                  id: "",
                  label: "",
                  tier: "EXTENSION_OFFICIELLE",
                  score: 50,
                  keywords: [],
                  verdict: "",
                  explanation: "",
                  sources: [],
                },
              ],
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-dbz-border px-3 py-2 text-[12px] text-white/60 hover:border-dbz-orange/50 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une famille
        </button>
        <div className="space-y-2">
          {config.heuristics.map((regle, i) => (
            <details
              key={`${regle.id}-${i}`}
              className="rounded-lg border border-dbz-border bg-black/20"
              open={!regle.label}
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="font-saiyan text-sm text-white">
                  {regle.label || "Nouvelle famille"}
                </span>
                <span className="text-[11px] text-white/35">
                  {config.tiers.find((t) => t.id === regle.tier)?.court} ·{" "}
                  {regle.keywords.length} mots-clés
                </span>
              </summary>
              <div className="space-y-3 border-t border-dbz-border/60 p-3">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
                  <Champ label="Nom de la famille">
                    <Texte
                      value={regle.label}
                      onChange={(v) => majRegle(i, { label: v })}
                      placeholder="Renvoi à la production animée"
                    />
                  </Champ>
                  <Champ label="Rang">
                    <ChoixRang
                      value={regle.tier}
                      tiers={config.tiers}
                      onChange={(v) => majRegle(i, { tier: v })}
                    />
                  </Champ>
                  <Champ label="Score">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={regle.score}
                      onChange={(e) =>
                        majRegle(i, { score: Number(e.target.value) })
                      }
                      className={`${champClasse} w-20 tabular-nums`}
                    />
                  </Champ>
                </div>
                <Champ label="Mots-clés">
                  <MotsCles
                    valeurs={regle.keywords}
                    onChange={(v) => majRegle(i, { keywords: v })}
                  />
                </Champ>
                <Champ label="Verdict">
                  <Texte
                    rows={2}
                    value={regle.verdict}
                    onChange={(v) => majRegle(i, { verdict: v })}
                  />
                </Champ>
                <Champ label="Explication">
                  <Texte
                    rows={3}
                    value={regle.explanation}
                    onChange={(v) => majRegle(i, { explanation: v })}
                  />
                </Champ>
                <Champ label="Sources">
                  <ListeDeLignes
                    valeurs={regle.sources}
                    onChange={(v) => majRegle(i, { sources: v })}
                    ajout="Ajouter une source"
                    libelle="Source de la famille"
                  />
                </Champ>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      heuristics: config.heuristics.filter(
                        (_, index) => index !== i,
                      ),
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-[11px] text-white/40 hover:text-red-400"
                >
                  <Corbeille className="h-3.5 w-3.5" />
                  Supprimer cette famille
                </button>
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* Corpus d'auteur --------------------------------------------------- */}
      <Section
        titre="Corpus d'auteur"
        sous="Les déclarations d'Akira Toriyama et des guides Shueisha, chargées depuis la base locale .aphrody. Elles ne tranchent rien : elles s'affichent à côté du verdict comme pièces à conviction."
      >
        {config.references.length === 0 ? (
          <p className="rounded-lg border border-dbz-border bg-black/20 p-3 text-[13px] leading-relaxed text-white/50">
            Aucune citation chargée. Depuis <code>apps/shenron/site</code> :{" "}
            <code className="text-dbz-orange">
              bun run canon:aphrody --appliquer
            </code>{" "}
            lit les introductions des 42 tomes, le Super Exciting Guide, les
            Daizenshuu et les interviews conservés dans <code>.aphrody</code>.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {parDocument.map(([source, n]) => (
                <span
                  key={source}
                  className="rounded-full border border-dbz-border px-2.5 py-0.5 text-[11px] text-white/45"
                >
                  {source} · {n}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Recherche className="h-4 w-4 shrink-0 text-white/40" />
              <Texte
                value={filtreRef}
                onChange={setFiltreRef}
                placeholder="Filtrer par sujet, mot-clé ou source"
              />
              <span className="shrink-0 text-[11px] tabular-nums text-white/35">
                {refsFiltrees.length}
              </span>
            </div>
            <div className="space-y-2">
              {(toutesRefs ? refsFiltrees : refsFiltrees.slice(0, 20)).map(
                (r) => (
                  <details
                    key={r.id}
                    className="rounded-lg border border-dbz-border bg-black/20"
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5">
                      <span className="font-saiyan text-sm text-white">
                        {r.subject || "Sans sujet"}
                      </span>
                      <span className="text-[11px] text-white/35">
                        {r.source}
                        {r.year ? `, ${r.year}` : ""} · {r.lang}
                        {r.provenance === "databooks"
                          ? " · planche du site"
                          : ""}
                        {r.provenance === "manga" ? " · manga" : ""}
                        {r.provenance === "manuel" ? " · saisie à la main" : ""}
                        {r.lang !== "fr" && !r.textFr ? " · à traduire" : ""}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-dbz-border/60 p-3">
                      <p
                        lang={r.lang}
                        className="rounded-lg bg-black/30 p-3 text-[13px] italic leading-relaxed text-white/70"
                      >
                        « {r.text} »
                      </p>
                      {r.lang !== "fr" && (
                        <Champ
                          label="Traduction française"
                          aide="Affichée à la place de l'original, qui reste visible dessous. Vide = la citation s'affiche en version originale."
                        >
                          <Texte
                            rows={4}
                            value={r.textFr ?? ""}
                            onChange={(v) => majReference(r.id, { textFr: v })}
                          />
                        </Champ>
                      )}
                      <Champ label="Sujet">
                        <Texte
                          value={r.subject}
                          onChange={(v) => majReference(r.id, { subject: v })}
                        />
                      </Champ>
                      <Champ
                        label="Mots-clés"
                        aide="Ce sont eux qui font remonter la citation sous un verdict."
                      >
                        <MotsCles
                          valeurs={r.keywords}
                          onChange={(v) => majReference(r.id, { keywords: v })}
                        />
                      </Champ>
                      <Champ label="Source">
                        <Texte
                          value={r.source}
                          onChange={(v) => majReference(r.id, { source: v })}
                        />
                      </Champ>
                      <p className="text-[11px] text-white/30">
                        Document : {r.document || "—"}
                        {r.href && (
                          <>
                            {" · "}
                            <a
                              href={r.href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-white/45 hover:text-dbz-orange"
                            >
                              voir la pièce
                            </a>
                          </>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            references: config.references.filter(
                              (x) => x.id !== r.id,
                            ),
                          })
                        }
                        className="inline-flex items-center gap-1.5 text-[11px] text-white/40 hover:text-red-400"
                      >
                        <Corbeille className="h-3.5 w-3.5" />
                        Retirer cette citation
                      </button>
                    </div>
                  </details>
                ),
              )}
            </div>
            {refsFiltrees.length > 20 && (
              <button
                type="button"
                onClick={() => setToutesRefs((v) => !v)}
                className="text-[12px] text-white/50 hover:text-dbz-orange"
              >
                {toutesRefs
                  ? "Réduire la liste"
                  : `Afficher les ${refsFiltrees.length - 20} citations restantes`}
              </button>
            )}
            <p className="text-[11px] leading-relaxed text-white/35">
              Un nouveau chargement (
              <code>bun run canon:aphrody --appliquer</code>) remplace ces
              citations et conserve celles saisies à la main.
            </p>
          </>
        )}
      </Section>

      {/* Repli ------------------------------------------------------------ */}
      <Section
        titre="Quand on ne sait pas"
        sous="Le texte rendu lorsque rien ne s'apparie, et celui affiché avant toute question. Un champ vide vaut mieux qu'une valeur plausible : c'est ici qu'on le dit."
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Champ label="Verdict de repli">
            <Texte
              rows={2}
              value={config.fallback.verdict}
              onChange={(v) =>
                patch({ fallback: { ...config.fallback, verdict: v } })
              }
            />
          </Champ>
          <Champ label="Rang de repli">
            <ChoixRang
              value={config.fallback.tier}
              tiers={config.tiers}
              onChange={(v) =>
                patch({ fallback: { ...config.fallback, tier: v } })
              }
            />
          </Champ>
        </div>
        <Champ label="Explication de repli">
          <Texte
            rows={3}
            value={config.fallback.explanation}
            onChange={(v) =>
              patch({ fallback: { ...config.fallback, explanation: v } })
            }
          />
        </Champ>
        <Champ label="Sources citées en repli">
          <ListeDeLignes
            valeurs={config.fallback.sources}
            onChange={(v) =>
              patch({ fallback: { ...config.fallback, sources: v } })
            }
            ajout="Ajouter une source"
            libelle="Source de la citation"
          />
        </Champ>
        <div className="grid gap-3 lg:grid-cols-2">
          <Champ label="Invite affichée avant toute question">
            <Texte
              rows={2}
              value={config.vide.verdict}
              onChange={(v) => patch({ vide: { ...config.vide, verdict: v } })}
            />
          </Champ>
          <Champ label="Explication de cette invite">
            <Texte
              rows={2}
              value={config.vide.explanation}
              onChange={(v) =>
                patch({ vide: { ...config.vide, explanation: v } })
              }
            />
          </Champ>
        </div>
      </Section>

      {/* Power Scaling Officiel (BP, SEG, Kiri) --------------------------- */}
      <Section
        titre="Power Scaling Officiel (BP, SEG, Kiri)"
        sous="Paramètres des multiplicateurs canoniques, échelons cosmiques et conversion de l'unité magique Kiri de Babidi en Battle Power (BP)."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Champ
            label="Moteur Power Scaling"
            aide="Active le calcul et l'affichage des BP dans les fiches"
          >
            <label className="flex items-center gap-2 pt-1 text-sm text-white">
              <input
                type="checkbox"
                checked={config.powerScaling.enabled}
                onChange={(e) =>
                  patch({
                    powerScaling: {
                      ...config.powerScaling,
                      enabled: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4 rounded border-dbz-border bg-black/40 text-dbz-orange focus:ring-dbz-orange"
              />
              <span>
                {config.powerScaling.enabled ? "Activé" : "Désactivé"}
              </span>
            </label>
          </Champ>
          <Champ
            label="1 Kiri = X Battle Power (BP)"
            aide="Étalon officiel V-Jump : ~50 000 BP"
          >
            <input
              type="number"
              value={config.powerScaling.kiriToBpRate}
              onChange={(e) =>
                patch({
                  powerScaling: {
                    ...config.powerScaling,
                    kiriToBpRate: Number(e.target.value) || 50000,
                  },
                })
              }
              className={champClasse}
            />
          </Champ>
          <Champ
            label="Seuil destruction planète (Kiri)"
            aide="Yakon = 800 Kiri, Terre détruite à ~200-300 Kiri"
          >
            <input
              type="number"
              value={config.powerScaling.planetDestructionKiriFloor}
              onChange={(e) =>
                patch({
                  powerScaling: {
                    ...config.powerScaling,
                    planetDestructionKiriFloor: Number(e.target.value) || 200,
                  },
                })
              }
              className={champClasse}
            />
          </Champ>
        </div>

        {/* Multiplicateurs de transformation */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="font-saiyan text-xs uppercase tracking-wider text-dbz-yellow">
              Multiplicateurs de transformation officiels (Daizenshuu 7 / SEG)
            </h3>
            <button
              type="button"
              onClick={() => {
                const nv: PowerScalingMultiplier = {
                  form: "Nouvelle forme",
                  multiplier: 1,
                  baseForm: "Base",
                  source: "Manga DB",
                  canonTier: "EXTENSION_OFFICIELLE",
                  notes: "",
                };
                patch({
                  powerScaling: {
                    ...config.powerScaling,
                    multipliers: [...config.powerScaling.multipliers, nv],
                  },
                });
              }}
              className="inline-flex items-center gap-1 text-[11px] text-white/60 hover:text-dbz-orange"
            >
              <Plus className="h-3 w-3" /> Ajouter un multiplicateur
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-dbz-border/50 text-[10px] uppercase text-white/40">
                  <th className="py-1.5 pr-2">Transformation</th>
                  <th className="py-1.5 px-2">Facteur</th>
                  <th className="py-1.5 px-2">Forme de base</th>
                  <th className="py-1.5 px-2">Rang Canon</th>
                  <th className="py-1.5 px-2">Source</th>
                  <th className="py-1.5 pl-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dbz-border/20">
                {config.powerScaling.multipliers.map((m, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={m.form}
                        onChange={(e) => {
                          const maj = [...config.powerScaling.multipliers];
                          maj[i] = { ...m, form: e.target.value };
                          patch({
                            powerScaling: {
                              ...config.powerScaling,
                              multipliers: maj,
                            },
                          });
                        }}
                        className="w-full rounded bg-black/20 px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={m.multiplier}
                        onChange={(e) => {
                          const maj = [...config.powerScaling.multipliers];
                          maj[i] = {
                            ...m,
                            multiplier: Number(e.target.value) || 0,
                          };
                          patch({
                            powerScaling: {
                              ...config.powerScaling,
                              multipliers: maj,
                            },
                          });
                        }}
                        className="w-16 rounded bg-black/20 px-2 py-1 text-white font-mono"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={m.baseForm}
                        onChange={(e) => {
                          const maj = [...config.powerScaling.multipliers];
                          maj[i] = { ...m, baseForm: e.target.value };
                          patch({
                            powerScaling: {
                              ...config.powerScaling,
                              multipliers: maj,
                            },
                          });
                        }}
                        className="w-full rounded bg-black/20 px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={m.canonTier}
                        onChange={(e) => {
                          const maj = [...config.powerScaling.multipliers];
                          maj[i] = {
                            ...m,
                            canonTier: e.target.value as CanonTier,
                          };
                          patch({
                            powerScaling: {
                              ...config.powerScaling,
                              multipliers: maj,
                            },
                          });
                        }}
                        className="rounded bg-black/20 px-1 py-1 text-xs text-white"
                      >
                        {CANON_TIERS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={m.source}
                        onChange={(e) => {
                          const maj = [...config.powerScaling.multipliers];
                          maj[i] = { ...m, source: e.target.value };
                          patch({
                            powerScaling: {
                              ...config.powerScaling,
                              multipliers: maj,
                            },
                          });
                        }}
                        className="w-full rounded bg-black/20 px-2 py-1 text-white/80"
                      />
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          patch({
                            powerScaling: {
                              ...config.powerScaling,
                              multipliers:
                                config.powerScaling.multipliers.filter(
                                  (_, idx) => idx !== i,
                                ),
                            },
                          });
                        }}
                        className="text-white/40 hover:text-red-400 p-1"
                        title="Supprimer"
                      >
                        <Corbeille className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Échelons cosmiques (Tiers 1-5) */}
        <div className="space-y-3 pt-2">
          <h3 className="font-saiyan text-xs uppercase tracking-wider text-dbz-yellow">
            Échelons de Puissance Cosmiques (Tiers 1 à 5)
          </h3>
          <div className="grid gap-2 sm:grid-cols-5">
            {config.powerScaling.tiers.map((t, i) => (
              <div
                key={i}
                className="rounded-lg border border-dbz-border/40 bg-black/20 p-2.5 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-saiyan text-[10px] text-dbz-orange">
                    Tier {t.tierNumber}
                  </span>
                </div>
                <input
                  type="text"
                  value={t.name}
                  onChange={(e) => {
                    const maj = [...config.powerScaling.tiers];
                    maj[i] = { ...t, name: e.target.value };
                    patch({
                      powerScaling: { ...config.powerScaling, tiers: maj },
                    });
                  }}
                  className="w-full rounded bg-black/30 px-1.5 py-0.5 text-xs text-white font-medium"
                />
                <textarea
                  rows={2}
                  value={t.description}
                  onChange={(e) => {
                    const maj = [...config.powerScaling.tiers];
                    maj[i] = { ...t, description: e.target.value };
                    patch({
                      powerScaling: { ...config.powerScaling, tiers: maj },
                    });
                  }}
                  className="w-full resize-none rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-white/60"
                />
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Banc d'essai ------------------------------------------------------ */}
      <Section
        titre="Banc d'essai"
        sous="Le moteur de la page publique, appliqué à la doctrine en cours d'édition. Rien n'est enregistré ici."
      >
        <div className="flex items-center gap-2">
          <Recherche className="h-4 w-4 shrink-0 text-white/40" />
          <Texte
            value={essai}
            onChange={setEssai}
            placeholder="Le Super Saiyan 5 existe-t-il ?"
          />
        </div>
        {verdictEssai && (
          <div
            className="space-y-2 rounded-lg border border-dbz-border bg-black/30 p-3"
            style={{ borderLeft: `3px solid ${verdictEssai.color}` }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p
                className="font-saiyan text-[12px] uppercase tracking-wider"
                style={{ color: verdictEssai.color }}
              >
                {verdictEssai.tierLabel}
              </p>
              <p className="text-[11px] tabular-nums text-white/40">
                {verdictEssai.score}/100 · {verdictEssai.origine}
              </p>
            </div>
            <p className="text-sm text-white">{verdictEssai.verdict}</p>
            <p className="text-[13px] leading-relaxed text-white/55">
              {verdictEssai.explanation}
            </p>
            {verdictEssai.matchedKeywords.length > 0 && (
              <p className="text-[11px] text-white/35">
                Mots-clés reconnus : {verdictEssai.matchedKeywords.join(", ")}
              </p>
            )}
            {verdictEssai.origine === "fallback" && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-300/80">
                <Alerte className="h-3 w-3" />
                Aucun sujet ni famille ne répond : ajoute un mot-clé ou un sujet
                pour trancher.
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
