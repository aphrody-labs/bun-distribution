"use client";

import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@rosegriffon/ui";
import { ChevronDown, Sparkles, Trophy } from "lucide-react";
import { useState } from "react";

import { clePost, type PostCampagne } from "@/lib/x-campagnes/types";

import { AnimationTirage, type GagnantAnime } from "./AnimationTirage";

/*
 * Le bloc PUBLIC des gagnants — visible par tout le monde, et seulement une fois
 * que le tirage a été publié par un administrateur.
 *
 * Il n'affiche jamais autre chose que ce qui est déjà en base : le composant ne
 * calcule aucun classement, ne retire personne, n'ajoute personne. Sa seule
 * intelligence est de retrouver, dans les créations que la page a déjà
 * chargées, celle qui correspond à chaque gagnant (`cleCreation` suit le format
 * de `clePost()`).
 *
 * ── POURQUOI LA VÉRIFICATION EST DANS LA PAGE, ET DÉPLIABLE ────────────────
 * Un tirage n'est pas « vérifiable » parce qu'on l'affirme : il l'est parce que
 * n'importe qui peut refaire le calcul sans rien nous demander. Les quatre
 * valeurs qui le permettent (round drand, signature, empreinte du roster,
 * graine) sont donc servies à tous, en clair, sur la page — et non reléguées
 * dans un écran d'administration que personne ne verra jamais. Elles sont
 * repliées par défaut parce que la plupart des visiteurs veulent d'abord savoir
 * qui a gagné.
 */

export interface GagnantAffiche extends GagnantAnime {
  clePublique: string;
}

export interface PreuveTirage {
  round: number | null;
  chaine: string | null;
  reseau: string | null;
  signature: string | null;
  graine: string;
  empreinteParticipants: string;
  nbParticipants: number;
  poidsMode: "un_par_personne" | "par_oeuvre";
  publieLe: string | null;
}

/** Une valeur d'empreinte : en `tabular-nums`, coupable n'importe où, sélectionnable. */
function Valeur({ children }: { children: React.ReactNode }) {
  return (
    <code className="block break-all rounded-lg bg-surface-container px-2 py-1 font-mono text-xs text-on-surface-variant">
      {children}
    </code>
  );
}

export function Gagnants({
  posts,
  gagnants,
  preuve,
}: {
  posts: PostCampagne[];
  gagnants: GagnantAffiche[];
  preuve: PreuveTirage;
}) {
  const [animation, setAnimation] = useState(false);

  if (gagnants.length === 0) return null;

  const parCle = new Map(posts.map(post => [clePost(post), post]));

  return (
    <section
      aria-labelledby="titre-gagnants"
      className="rounded-3xl border-2 border-primary/40 bg-primary-container/20 p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titre-gagnants" className="flex items-center gap-2 text-fluid-headline-md font-bold text-on-surface">
          <Trophy className="size-6 text-primary" aria-hidden />
          {gagnants.length > 1 ? "Les gagnants" : "Le gagnant"}
        </h2>
        <Button variant="secondary" onClick={() => setAnimation(true)}>
          <Sparkles className="size-4" aria-hidden />
          Revoir le tirage
        </Button>
      </div>

      <ul className="mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {gagnants.map(gagnant => {
          const post = gagnant.cleCreation ? parCle.get(gagnant.cleCreation) : undefined;
          const image = post?.images[0];
          return (
            <li
              key={gagnant.clePublique}
              className="flex items-center gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-3"
            >
              {image ? (
                /*
                 * `next/image` n'apporte rien ici : la vignette est déjà
                 * chargée par la galerie plus bas dans la même page, donc
                 * servie depuis le cache du navigateur. Une seconde balise
                 * optimisée demanderait une AUTRE largeur et rendrait le
                 * même octet deux fois.
                 */
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.src} alt="" className="size-16 shrink-0 rounded-xl object-cover" loading="lazy" />
              ) : (
                <div className="size-16 shrink-0 rounded-xl bg-surface-container" aria-hidden />
              )}
              <div className="min-w-0">
                <Badge variant="secondary" className="mb-1">
                  Lot {gagnant.rang}
                </Badge>
                <p className="truncate font-bold text-on-surface">{gagnant.pseudoAffichage}</p>
                {gagnant.lot && <p className="text-sm text-on-surface-variant">{gagnant.lot}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      <Collapsible className="mt-4">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between">
            Vérifier ce tirage
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3 text-sm text-on-surface-variant">
          <p>
            Le tirage n&apos;a pas été fait avec un hasard choisi par Rose Griffon. Sa graine vient d&apos;un aléa
            public produit par le réseau <strong>{preuve.reseau ?? "drand"}</strong>, dont le numéro de tour avait été
            annoncé <strong>avant</strong> le tirage. Personne ne peut prédire la signature d&apos;un tour à venir, et
            n&apos;importe qui peut la retélécharger pour refaire le calcul, aujourd&apos;hui comme dans dix ans.
          </p>
          <dl className="space-y-2">
            {preuve.round !== null && (
              <div>
                <dt className="font-medium text-on-surface">Tour drand</dt>
                <dd>
                  <Valeur>{preuve.round}</Valeur>
                </dd>
              </div>
            )}
            {preuve.signature && (
              <div>
                <dt className="font-medium text-on-surface">Signature du tour</dt>
                <dd>
                  <Valeur>{preuve.signature}</Valeur>
                </dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-on-surface">Empreinte de la liste des participants</dt>
              <dd>
                <Valeur>{preuve.empreinteParticipants}</Valeur>
              </dd>
            </div>
            <div>
              <dt className="font-medium text-on-surface">Graine du tirage</dt>
              <dd>
                <Valeur>{preuve.graine}</Valeur>
              </dd>
            </div>
            <div>
              <dt className="font-medium text-on-surface">Périmètre</dt>
              <dd>
                {preuve.nbParticipants}{" "}
                {preuve.poidsMode === "un_par_personne"
                  ? "personnes, une chance chacune"
                  : "personnes, une chance par œuvre"}
              </dd>
            </div>
          </dl>
        </CollapsibleContent>
      </Collapsible>

      <AnimationTirage posts={posts} gagnants={gagnants} ouvert={animation} onFermer={() => setAnimation(false)} />
    </section>
  );
}
