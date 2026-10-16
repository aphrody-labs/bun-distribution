"use client";

import { Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { decouperDuree, type DureeRestante } from "@/lib/x-campagnes/types";

/*
 * Compte à rebours d'une campagne — îlot client, forcément.
 *
 * ── POURQUOI C'EST UNE SURFACE DE MARQUE ET NON UNE CARTE D'INTERFACE ───────
 *
 * Il était rendu en `bg-surface-container-low` sous un liseré discret, au
 * milieu d'une page qui n'est faite que de surfaces claires : sur un écran
 * entièrement blanc, la seule information PÉRISSABLE de la page ne se
 * distinguait plus des puces de comptage posées juste au-dessus. Retour de
 * relecture communautaire du 20/8/2026, mot pour mot : « le timer ressort pas
 * assez bien car tout est en blanc ».
 *
 * D'où le dégradé marine → brique de `PageHero`, le liseré or et l'ombre dure
 * de la DA : ce bloc est le seul de la page à porter les couleurs de marque,
 * donc le seul que l'œil trouve sans le chercher. Les tokens `rg-*` sont
 * volontairement CONSTANTS d'un thème à l'autre (cf. `PageShell`) — on maîtrise
 * ici le fond ET le texte, la règle « pas de couleur de marque sur une surface
 * d'interface » ne s'applique donc pas.
 *
 * ⚠ HYDRATATION. La page est `force-dynamic`, mais elle est quand même rendue
 * une première fois sur le serveur : afficher « il reste 9 j 21 h 04 min 12 s »
 * dès ce rendu-là produirait un HTML qui ne peut PAS correspondre au premier
 * rendu du navigateur (quelques centaines de millisecondes plus tard), et React
 * signalerait une divergence d'hydratation.
 *
 * D'où l'ordre choisi : le serveur ET le premier rendu client dessinent la MÊME
 * grille avec des tirets, l'effet la remplit après le montage. Même DOM, mêmes
 * dimensions — aucune divergence, aucun saut de mise en page.
 *
 * ⚠ FUSEAU. La cible est un instant absolu (`timestamptz` en base, ISO en
 * props) : la soustraction `cible - maintenant` ne dépend d'aucun fuseau. Seule
 * l'ÉCHÉANCE lisible en dépend, et elle est formatée en heure de Paris par
 * `formaterDateHeureParis()` — côté serveur, une fois, donc identique partout.
 *
 * ⚠ PASSAGE À ZÉRO. `decouperDuree()` plancher à 0, la minuterie est arrêtée au
 * franchissement et le libellé bascule. Pas de compteur qui repart en négatif,
 * pas d'intervalle qui tourne pour rien jusqu'à la fin de la visite.
 */

/**
 * Une case du compte à rebours. Le libellé s'accorde tout seul.
 *
 * ⚠ QUATRE COLONNES SOUS 640 px, C'EST ~33 px DE TEXTE PAR CASE. « secondes »
 * en réclame 48 : le libellé partait donc en « seco… » entre 375 et 479 px —
 * précisément le format que la DA vise. Aucune taille de police ne rattrape
 * l'écart, et couper un mot de huit lettres pour en montrer quatre n'informe
 * personne. La case porte donc DEUX libellés : l'abréviation française usuelle
 * (« j », « h », « min », « s ») tant que la place manque, le mot entier dès
 * `sm`. Pas de coût pour les lecteurs d'écran : la grille est `aria-hidden`,
 * l'échéance en clair vit sous elle.
 *
 * ⚠ `tabular-nums` N'EST PAS DÉCORATIF ICI. Sans chasse fixe, « 11 » et « 08 »
 * n'ont pas la même largeur et la grille tressaute à chaque seconde. C'est
 * aussi pourquoi les chiffres restent dans la police de labeur : la police
 * d'affichage de la DA n'a pas de chiffres à chasse fixe.
 */
function Case({
  valeur,
  singulier,
  pluriel,
  abrege,
}: {
  valeur: number | null;
  singulier: string;
  pluriel: string;
  abrege: string;
}) {
  return (
    <div className="rounded-2xl border border-rg-or/40 bg-rg-sur-marine/10 px-1 py-2.5 text-center backdrop-blur-sm xs:px-2 sm:py-3">
      <p className="text-3xl font-bold leading-none text-rg-or tabular-nums xs:text-4xl sm:text-5xl">
        {valeur === null ? "--" : String(valeur).padStart(2, "0")}
      </p>
      <p className="mt-1.5 text-[0.65rem] leading-tight font-semibold tracking-wide text-rg-sur-marine/80 uppercase xs:text-xs">
        <span className="sm:hidden">{abrege}</span>
        <span className="hidden sm:inline">{valeur !== null && valeur === 1 ? singulier : pluriel}</span>
      </p>
    </div>
  );
}

export function CompteARebours({
  cibleIso,
  libelle,
  libelleEcoule,
  echeance,
}: {
  /** Instant visé, en ISO 8601 (`fin_le` ou `debut_le` de la campagne). */
  cibleIso: string;
  /** Ce qu'on décompte, ex. « Fin de la campagne dans ». */
  libelle: string;
  /** Ce qu'on affiche une fois l'instant franchi, ex. « Campagne terminée ». */
  libelleEcoule: string;
  /** Échéance lisible, DÉJÀ formatée en heure de Paris par le serveur. */
  echeance: string;
}) {
  const [restant, setRestant] = useState<DureeRestante | null>(null);
  const [ecoule, setEcoule] = useState(false);

  useEffect(() => {
    const cible = new Date(cibleIso).getTime();
    if (Number.isNaN(cible)) {
      return;
    }
    /** Met à jour l'affichage ; renvoie `false` quand il n'y a plus rien à compter. */
    const battre = (): boolean => {
      const reste = cible - Date.now();
      if (reste <= 0) {
        setRestant(decouperDuree(0));
        setEcoule(true);
        return false;
      }
      setRestant(decouperDuree(reste));
      setEcoule(false);
      return true;
    };
    if (!battre()) {
      return;
    }
    const minuterie = setInterval(() => {
      if (!battre()) {
        clearInterval(minuterie);
      }
    }, 1000);
    return () => clearInterval(minuterie);
  }, [cibleIso]);

  return (
    <section
      aria-label={ecoule ? libelleEcoule : libelle}
      className="relative overflow-hidden rounded-3xl border-2 border-rg-or/70 bg-linear-to-br from-rg-marine via-rg-marine-clair to-rg-brique p-4 shadow-[0_4px_0_0_rgba(0,0,0,0.5)] xs:p-5 sm:p-6"
    >
      {/* Même texture que les bannières de marque — un asset, pas une couleur. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-overlay"
        style={{ backgroundImage: "url(/images/noise.svg)" }}
        aria-hidden
      />

      <div className="relative z-10">
        <div className="flex items-center gap-2">
          <Timer className="size-4 shrink-0 text-rg-or" aria-hidden />
          <p className="text-xs font-bold tracking-[0.16em] text-rg-or uppercase sm:text-sm">
            {ecoule ? libelleEcoule : libelle}
          </p>
        </div>

        {/* La grille chiffrée est décorative pour un lecteur d'écran : elle change
				    chaque seconde et serait insupportable à l'écoute. La phrase complète,
				    elle, est annoncée une fois, juste en dessous. */}
        {!ecoule && (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:mt-4 sm:gap-3" aria-hidden>
            <Case valeur={restant?.jours ?? null} singulier="jour" pluriel="jours" abrege="j" />
            <Case valeur={restant?.heures ?? null} singulier="heure" pluriel="heures" abrege="h" />
            <Case valeur={restant?.minutes ?? null} singulier="minute" pluriel="minutes" abrege="min" />
            <Case valeur={restant?.secondes ?? null} singulier="seconde" pluriel="secondes" abrege="s" />
          </div>
        )}

        <p className="mt-3 text-xs text-rg-sur-marine/85">
          <time dateTime={cibleIso}>{echeance}</time>
        </p>
      </div>
    </section>
  );
}
