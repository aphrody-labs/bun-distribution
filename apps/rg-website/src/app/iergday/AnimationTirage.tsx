"use client";

import { Badge, Button } from "@rosegriffon/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clePost, type PostCampagne } from "@/lib/x-campagnes/types";

import { PostCarte } from "./PostCarte";

/*
 * Rejeu animé d'un tirage au sort.
 *
 * ⚠ LE POINT LE PLUS IMPORTANT DE CE FICHIER : CE COMPOSANT NE TIRE RIEN.
 * Il reçoit des gagnants DÉJÀ calculés côté serveur et DÉJÀ écrits en base, et
 * se contente de les mettre en scène. Une animation qui « choisirait » serait un
 * tirage exécuté dans le navigateur : truquable depuis les outils de
 * développement par n'importe quel visiteur, et impossible à recalculer plus
 * tard. Le balayage ci-dessous est un décor dont on connaît la fin dès la
 * première image — c'est exactement ce qu'on veut.
 *
 * Conséquence directe : `indexGagnant` est cherché dans la liste AVANT de lancer
 * quoi que ce soit. Si la création du gagnant n'est pas dans les `posts` reçus
 * (page filtrée, création masquée entre-temps), on ne balaie pas dans le vide :
 * on passe directement à l'annonce nominative.
 */

/** Un gagnant tel que la base le rend — jamais reconstruit ici. */
export interface GagnantAnime {
  rang: number;
  pseudoAffichage: string;
  lot: string | null;
  /** Clé au format de `clePost()`, pour retrouver la carte dans `posts`. */
  cleCreation: string | null;
}

/*
 * Le balayage ralentit comme une roue qui s'arrête : l'intervalle entre deux
 * sauts part de 55 ms et s'allonge jusqu'à 520 ms. La progression est en
 * puissance 3 — en linéaire, le ralentissement se voit à peine ; au-delà du
 * cube, la fin traîne au point qu'on croit à un blocage.
 */
const SAUT_RAPIDE_MS = 55;
const SAUT_LENT_MS = 520;
const NB_SAUTS = 34;

/** Temps de contemplation du gagnant avant d'enchaîner sur le suivant. */
const PAUSE_ENTRE_GAGNANTS_MS = 5200;

function dureeDuSaut(n: number): number {
  const t = Math.min(1, n / NB_SAUTS);
  return SAUT_RAPIDE_MS + (SAUT_LENT_MS - SAUT_RAPIDE_MS) * t ** 3;
}

/* ─────────────────────────── CONFETTIS ─────────────────────────────────────
 * Écrits à la main sur un `<canvas>` 2D plutôt qu'avec une dépendance : le
 * dépôt n'en a aucune pour ça, et en ajouter une réécrirait `bun.lock` (que le
 * Bun local passe en v2, illisible par la CI). Une centaine de rectangles qui
 * tombent en tournant, c'est trente lignes.
 *
 * Les couleurs viennent des tokens du thème lus sur l'élément — pas de
 * hexadécimal en dur, la règle du dépôt vaut aussi dans un canvas.
 */
interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  vitesseAngle: number;
  taille: number;
  couleur: string;
}

function CanvasConfettis({ actif }: { actif: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduit = useReducedMotion();

  useEffect(() => {
    if (!actif || reduit) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /*
     * Les couleurs sont LUES sur l'élément, jamais écrites en dur — la règle
     * du dépôt (« zéro couleur en dur ») vaut aussi dans un canvas, qui ne
     * peut simplement pas porter de classe Tailwind. Un token absent est
     * ÉCARTÉ plutôt que remplacé par un hexadécimal de repli : recopier la
     * palette ici en ferait une seconde source de vérité, qui dériverait au
     * premier changement de thème. Si aucun token ne répond, on retombe sur
     * la couleur de texte héritée, qui est toujours définie et toujours
     * contrastée avec le fond du thème courant.
     */
    const styles = getComputedStyle(canvas);
    const palette = [
      styles.getPropertyValue("--color-primary"),
      styles.getPropertyValue("--color-secondary"),
      styles.getPropertyValue("--color-tertiary"),
      styles.getPropertyValue("--color-on-surface"),
    ]
      .map((valeur) => valeur.trim())
      .filter((valeur) => valeur.length > 0);
    if (palette.length === 0) palette.push(styles.color);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const redimensionner = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    redimensionner();
    window.addEventListener("resize", redimensionner);

    const l = () => canvas.width;
    const h = () => canvas.height;
    const pieces: Confetti[] = Array.from({ length: 110 }, () => ({
      angle: Math.random() * Math.PI * 2,
      couleur: palette[Math.floor(Math.random() * palette.length)] ?? styles.color,
      taille: (6 + Math.random() * 8) * dpr,
      vitesseAngle: (Math.random() - 0.5) * 0.24,
      vx: (Math.random() - 0.5) * 3.2 * dpr,
      vy: (2 + Math.random() * 3.4) * dpr,
      x: Math.random() * l(),
      y: -Math.random() * h() * 0.5,
    }));

    let brut = 0;
    const dessiner = () => {
      ctx.clearRect(0, 0, l(), h());
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.vitesseAngle;
        // Renvoyé en haut plutôt que supprimé : la pluie dure tant que
        // l'annonce est à l'écran, sans réallouer un seul objet.
        if (p.y > h() + p.taille) {
          p.y = -p.taille;
          p.x = Math.random() * l();
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.couleur;
        ctx.fillRect(-p.taille / 2, -p.taille / 4, p.taille, p.taille / 2);
        ctx.restore();
      }
      brut = requestAnimationFrame(dessiner);
    };
    brut = requestAnimationFrame(dessiner);

    return () => {
      cancelAnimationFrame(brut);
      window.removeEventListener("resize", redimensionner);
    };
  }, [actif, reduit]);

  if (!actif || reduit) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}

/* ──────────────────────────── ANIMATION ──────────────────────────────────── */

type Phase = "attente" | "balayage" | "revelation";

export function AnimationTirage({
  posts,
  gagnants,
  ouvert,
  onFermer,
}: {
  posts: PostCampagne[];
  gagnants: GagnantAnime[];
  ouvert: boolean;
  onFermer: () => void;
}) {
  const reduit = useReducedMotion();
  const initialWinner = gagnants[0];
  const initialWinnerIndex = initialWinner?.cleCreation
    ? posts.findIndex((post) => clePost(post) === initialWinner.cleCreation)
    : -1;
  const initialImmediate = reduit || initialWinnerIndex < 0 || posts.length === 0;
  const [phase, setPhase] = useState<Phase>(
    ouvert && initialWinner ? (initialImmediate ? "revelation" : "balayage") : "attente",
  );
  const [surligne, setSurligne] = useState<number | null>(
    ouvert && initialImmediate && initialWinnerIndex >= 0 ? initialWinnerIndex : null,
  );
  const [rangCourant, setRangCourant] = useState(0);

  const cles = useMemo(() => posts.map(clePost), [posts]);
  const gagnant = gagnants[rangCourant] ?? null;
  const indexGagnant = gagnant?.cleCreation ? cles.indexOf(gagnant.cleCreation) : -1;
  const dialogue = useRef<HTMLDialogElement>(null);
  const [animationIdentity, setAnimationIdentity] = useState({
    ouvert,
    gagnant,
    indexGagnant,
    count: posts.length,
    reduit,
  });
  if (
    animationIdentity.ouvert !== ouvert ||
    animationIdentity.gagnant !== gagnant ||
    animationIdentity.indexGagnant !== indexGagnant ||
    animationIdentity.count !== posts.length ||
    animationIdentity.reduit !== reduit
  ) {
    setAnimationIdentity({ ouvert, gagnant, indexGagnant, count: posts.length, reduit });
    if (!ouvert) {
      setPhase("attente");
      setSurligne(null);
      setRangCourant(0);
    } else if (gagnant) {
      const immediate = reduit || indexGagnant < 0 || posts.length === 0;
      setPhase(immediate ? "revelation" : "balayage");
      setSurligne(immediate && indexGagnant >= 0 ? indexGagnant : null);
    }
  }

  /*
   * Le déroulé complet d'UN gagnant. Chaque étape est un `setTimeout` chaîné
   * plutôt qu'un `setInterval` : l'intervalle change à chaque saut (c'est tout
   * l'effet de décélération), et un `setInterval` ne sait pas faire ça.
   */
  useEffect(() => {
    if (!ouvert || !gagnant) return;

    // `prefers-reduced-motion` : pas de roue qui tourne, on annonce directement.
    if (reduit || indexGagnant < 0 || posts.length === 0) {
      return;
    }

    let saut = 0;
    let minuteur: ReturnType<typeof setTimeout>;

    const avancer = () => {
      saut += 1;
      if (saut >= NB_SAUTS) {
        // La roue s'immobilise sur le gagnant — décidé serveur, pas ici.
        setSurligne(indexGagnant);
        setPhase("revelation");
        return;
      }
      // On balaie en évitant de retomber deux fois de suite au même endroit.
      setSurligne((precedent) => {
        let suivant = Math.floor(Math.random() * posts.length);
        if (posts.length > 1 && suivant === precedent) {
          suivant = (suivant + 1) % posts.length;
        }
        return suivant;
      });
      minuteur = setTimeout(avancer, dureeDuSaut(saut));
    };
    minuteur = setTimeout(avancer, SAUT_RAPIDE_MS);

    return () => clearTimeout(minuteur);
  }, [ouvert, gagnant, indexGagnant, posts.length, reduit]);

  /* Enchaînement sur le gagnant suivant, une fois le précédent contemplé. */
  useEffect(() => {
    if (phase !== "revelation") return;
    if (rangCourant >= gagnants.length - 1) return;
    const minuteur = setTimeout(
      () => setRangCourant((r) => r + 1),
      reduit ? 2600 : PAUSE_ENTRE_GAGNANTS_MS,
    );
    return () => clearTimeout(minuteur);
  }, [phase, rangCourant, gagnants.length, reduit]);

  const fermer = useCallback(() => onFermer(), [onFermer]);

  useEffect(() => {
    if (!ouvert) return;
    const element = dialogue.current;
    if (element && !element.open) element.showModal();
    // Le fond ne doit pas défiler pendant que l'annonce est à l'écran.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
    };
  }, [ouvert, fermer]);

  if (!ouvert) return null;

  const postGagnant = indexGagnant >= 0 ? posts[indexGagnant] : null;
  const enRevelation = phase === "revelation";

  return (
    <dialog
      ref={dialogue}
      onCancel={(event) => {
        event.preventDefault();
        fermer();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 text-inherit z-50 overflow-y-auto bg-scrim/80 backdrop-blur-sm"
      aria-modal="true"
      aria-label="Tirage au sort de l'IERG Day"
    >
      <CanvasConfettis actif={enRevelation} />

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <Badge variant="secondary" className="text-sm">
            {gagnants.length > 1
              ? `Gagnant ${rangCourant + 1} sur ${gagnants.length}`
              : "Tirage au sort"}
          </Badge>
          <Button variant="ghost" size="icon" onClick={fermer} aria-label="Fermer">
            <X className="size-5" aria-hidden />
          </Button>
        </div>

        {/*
         * Zone d'annonce. `aria-live="polite"` : le flou qui suit est purement
         * décoratif (CSS), le DOM reste intact, et un lecteur d'écran doit
         * apprendre le résultat par cette région — pas en devinant quelle carte
         * est nette.
         */}
        <div aria-live="polite" aria-atomic="true" className="min-h-16 text-center">
          <AnimatePresence mode="wait">
            {enRevelation && gagnant && (
              <motion.div
                key={`annonce-${gagnant.rang}`}
                initial={reduit ? false : { opacity: 0, scale: 0.9, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduit ? undefined : { opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              >
                <p className="text-fluid-headline-md font-bold text-on-surface">
                  Bravo {gagnant.pseudoAffichage} !
                </p>
                {gagnant.lot && (
                  <p className="mt-1 text-fluid-body-md text-on-surface-variant">
                    Lot {gagnant.rang} — {gagnant.lot}
                  </p>
                )}
              </motion.div>
            )}
            {phase === "balayage" && (
              <motion.p
                key="balayage"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-fluid-body-lg text-on-surface-variant"
              >
                Tirage en cours…
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* La création gagnante, agrandie et au centre. */}
        <AnimatePresence>
          {enRevelation && postGagnant && (
            <motion.div
              key={`gagnant-${gagnant?.rang}`}
              layout
              initial={reduit ? false : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduit ? undefined : { opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-md"
            >
              <div className="rounded-3xl border-2 border-primary p-1 shadow-[0_4px_0_0_rgba(0,0,0,0.5)]">
                <PostCarte post={postGagnant} priorite onOuvrir={() => {}} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/*
         * Le mur des créations. Pendant la révélation, TOUTES les autres
         * passent en flou — c'est l'effet demandé. Le flou est appliqué carte
         * par carte et non sur la grille entière : sur la grille, la carte
         * gagnante aurait floué avec les autres.
         */}
        <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {posts.map((post, position) => {
            const estGagnante = enRevelation && position === indexGagnant;
            const estSurlignee = phase === "balayage" && position === surligne;
            const floutee = enRevelation && !estGagnante;
            return (
              <li key={cles[position]} className="flex">
                <motion.div
                  className="flex w-full rounded-2xl"
                  animate={{
                    filter: floutee ? "blur(6px)" : "blur(0px)",
                    opacity: floutee ? 0.35 : 1,
                    scale: estSurlignee ? 1.06 : 1,
                  }}
                  transition={{ duration: reduit ? 0 : 0.28, ease: "easeOut" }}
                  style={estSurlignee ? { boxShadow: "0 0 0 3px var(--color-primary)" } : undefined}
                >
                  <PostCarte post={post} priorite={false} onOuvrir={() => {}} />
                </motion.div>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
