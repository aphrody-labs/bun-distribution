"use client";

import { AspectRatio, Badge, Card } from "@rosegriffon/ui";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ExternalLink, Heart, ImageIcon, MessageCircle, Repeat2 } from "lucide-react";
import Image from "next/image";

import { extraitTexteDiscord } from "@/lib/x-campagnes/discord-texte";
import {
  afficherHashtag,
  formaterNombre,
  type PostCampagne,
  urlMessageDiscord,
  urlPostX,
} from "@/lib/x-campagnes/types";

import { TexteDiscord } from "./TexteDiscord";

/*
 * Carte d'une publication de campagne — purement présentationnelle.
 *
 * Ne reçoit que des données sérialisables (`PostCampagne`) et deux primitives :
 * aucun accès base, aucun import de `queries.ts`.
 *
 * ⚠ `FrenchTweet.tsx` / `FeaturedTweets.tsx` sont des CONTRE-EXEMPLES : ils
 * peignent les métriques avec le bleu hexadécimal de X et un rose Tailwind en
 * dur. Ici tout passe par les tokens (`text-on-surface-variant`, `text-primary`).
 */

/*
 * Le `sizes` doit décrire la grille réelle 1 → 4 colonnes, sinon Next sert du
 * 100vw partout.
 *
 * ⚠ Les bornes sont à UN PIXEL SOUS les points de rupture, jamais dessus : une
 * `media query` Tailwind est un `min-width` (`xs` = 375px, `lg` = 1024px,
 * `xl` = 1280px), donc à 375px exactement la grille est DÉJÀ à deux colonnes.
 * Écrire `(max-width: 375px) 100vw` faisait demander une image pleine largeur
 * pour une vignette de demi-largeur — du sur-téléchargement pur à ces trois
 * largeurs précises.
 */
const TAILLES_VIGNETTE = "(max-width: 374px) 100vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw";

/*
 * Indicateur de focus clavier de la vignette : une `outline` à décalage NÉGATIF,
 * surtout pas un `ring`.
 *
 * `focus-visible:ring-4` compile en `box-shadow` tracé À L'EXTÉRIEUR de la boîte
 * (`--tw-ring-shadow: 0 0 0 calc(4px + …)`), or la `Card` parente porte
 * `overflow-hidden` : l'anneau était donc intégralement rogné — et le
 * `outline-hidden` qui l'accompagnait avait en plus supprimé l'anneau natif du
 * navigateur. Résultat : plus aucun repère au clavier (WCAG 2.4.7).
 * Une `outline` négative reste dans la zone de rognage et, d'après l'ordre de
 * peinture CSS, passe au-dessus de l'image de la vignette.
 */
const FOCUS_VIGNETTE = "focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-primary";

/*
 * Lien « Voir sur X ». `min-h-11` comme les autres cibles tactiles de la page :
 * le `min-h-8` d'origine passait bien le minimum WCAG 2.5.8 (24 px), mais en
 * faisait la seule cible plus petite que les autres sous le doigt.
 *
 * ⚠ `min-h-11` ne vaut PAS 44 px partout : la police racine du site est fluide
 * (`globals.css`, 14 px à 320 px, 15 px à 375 px), donc `2.75rem` mesure 39 px à
 * 320 px et 41 px à 375 px — vérifié au navigateur. C'est au-dessus du minimum
 * WCAG, mais l'uniformité s'entend en `rem`, pas en pixels.
 */
const LIEN_VERS_X =
  "inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Metrique({
  icone: Icone,
  valeur,
  libelle,
}: {
  icone: typeof Heart;
  valeur: number | undefined;
  libelle: string;
}) {
  if (!valeur) {
    return null;
  }
  // Pas de `title` : plusieurs lecteurs d'écran annoncent l'infobulle EN PLUS du
  // texte `sr-only`, ce qui donne « 12 j'aime … j'aime ». Le libellé masqué suffit,
  // et il reste lisible par tous puisque le nombre est déjà affiché.
  return (
    <span className="inline-flex items-center gap-1">
      <Icone className="size-3.5" aria-hidden />
      <span>{formaterNombre(valeur)}</span>
      <span className="sr-only">{libelle}</span>
    </span>
  );
}

export function PostCarte({
  post,
  priorite,
  onOuvrir,
}: {
  post: PostCampagne;
  /** `priority` de `next/image` — réservé aux premières vignettes visibles. */
  priorite: boolean;
  onOuvrir: () => void;
}) {
  const image = post.images[0];
  // `extraitTexteDiscord` et non `extraitTexte` : le second coupe au caractère près et
  // tranchait `<:mouahaha:1296067836388708513>` en plein milieu, laissant un déchet que
  // plus aucun rendu ne rattrape. Le premier compte un émoji pour deux caractères et ne
  // coupe jamais à l'intérieur d'une balise.
  const extrait = extraitTexteDiscord(post.texte, 160);
  const date = post.publieLe ? new Date(post.publieLe) : null;
  const dateValide = date && !Number.isNaN(date.getTime()) ? date : null;

  /*
   * ⚠ UNE CRÉATION DISCORD N'EST PAS UN TWEET DÉGUISÉ.
   * Trois choses ne se transposent PAS d'un réseau à l'autre, et les forcer
   * reviendrait à afficher des chiffres et des identités inventés :
   *   - le « @pseudo » : sur Discord l'attribution se fait au nom d'affichage,
   *     et `auteurPseudo` peut carrément être absent. La seconde ligne annonce
   *     donc le SALON de dépôt, qui est l'information vraie et utile ;
   *   - les métriques : Discord ne publie ni « j'aime » ni repartages. Les
   *     réactions d'un message ne sont pas la même chose, et les peindre sous
   *     les pictogrammes de X leur donnerait un sens qu'elles n'ont pas. La
   *     rangée disparaît, elle n'affiche pas des zéros ;
   *   - le lien : `discord.com/channels/…` n'est ouvrable que par un membre du
   *     serveur. Le libellé le dit au lieu de promettre une page publique.
   */
  // ⚠ UN BRANCHEMENT PAR SOURCE, JAMAIS « pas X donc Discord ». C'était un
  // ternaire binaire, et l'arrivée d'une troisième source l'a fait ranger
  // Instagram du côté Discord — TypeScript l'a refusé, ce qui est exactement ce
  // que l'union est là pour faire. Un `switch` oblige à traiter chaque cas.
  const auteurSecondaire =
    post.source === "x"
      ? `@${post.auteurPseudo}`
      : post.source === "discord"
        ? (post.salonNom ?? "Serveur Discord")
        : post.auteurPseudo
          ? `@${post.auteurPseudo}`
          : "Instagram";
  const reseau = post.source === "x" ? "X" : post.source === "discord" ? "Discord" : "Instagram";
  const lien =
    post.source === "x"
      ? {
          ariaLabel: `Voir la publication de @${post.auteurPseudo} sur X (nouvel onglet)`,
          href: urlPostX(post.auteurPseudo, post.tweetId),
          libelle: "Voir sur X",
        }
      : post.source === "discord"
        ? {
            ariaLabel: `Ouvrir le message de ${post.auteurNom} dans Discord (nouvel onglet, réservé aux membres du serveur)`,
            href: urlMessageDiscord(post.guildId, post.salonId, post.messageId),
            libelle: "Ouvrir dans Discord",
          }
        : {
            ariaLabel: `Voir la publication de ${post.auteurNom} sur Instagram (nouvel onglet)`,
            href: post.permalien,
            libelle: "Voir sur Instagram",
          };

  return (
    <Card className="group w-full flex-1 gap-0 overflow-hidden rounded-[24px] border-2 border-rg-or/40 bg-surface-container-low py-0 shadow-[0_4px_0_0_rgba(0,0,0,0.5)] transition-transform duration-300 motion-safe:hover:-translate-y-1">
      <button
        type="button"
        onClick={onOuvrir}
        aria-label={`Agrandir la publication de ${post.auteurNom}`}
        className={`relative block w-full cursor-zoom-in overflow-hidden ${FOCUS_VIGNETTE}`}
      >
        <AspectRatio ratio={4 / 5}>
          {image?.kind === "video" ? (
            /*
             * Vignette d'une participation VIDÉO. `muted` + `playsInline` sont
             * obligatoires pour que la lecture automatique soit tolérée par les
             * navigateurs mobiles ; `preload="metadata"` ne télécharge que
             * l'en-tête tant que la carte n'est pas survolée. Le pictogramme en
             * coin dit ce que c'est sans qu'il faille cliquer.
             */
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={image.src}
              muted
              loop
              playsInline
              preload="metadata"
              aria-label={`Vidéo publiée sur ${reseau} par ${post.auteurNom}`}
              className="size-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
              onMouseEnter={evenement => {
                void evenement.currentTarget.play().catch(() => {});
              }}
              onMouseLeave={evenement => {
                evenement.currentTarget.pause();
                evenement.currentTarget.currentTime = 0;
              }}
            />
          ) : image ? (
            <Image
              src={image.src}
              alt={`Image publiée sur ${reseau} par ${post.auteurNom}`}
              fill
              sizes={TAILLES_VIGNETTE}
              quality={70}
              priority={priorite}
              className="object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
            />
          ) : (
            /* Pictogramme de repli à pleine opacité : `text-on-surface-variant/60`
						   sur `bg-surface-container-high` tombe à 2,2:1, sous le 3:1 exigé
						   pour un élément graphique porteur de sens (WCAG 1.4.11). */
            <div className="flex size-full items-center justify-center bg-surface-container-high text-on-surface-variant">
              <ImageIcon className="size-10" aria-hidden />
            </div>
          )}
        </AspectRatio>

        {post.images.length > 1 && (
          <Badge
            variant="secondary"
            className="absolute right-2 top-2 border-2 border-rg-or/50 shadow-[0_2px_0_0_rgba(0,0,0,0.4)]"
          >
            +{post.images.length - 1}
          </Badge>
        )}
        {post.misEnAvant && (
          <Badge className="absolute left-2 top-2 border-2 border-rg-or/50 shadow-[0_2px_0_0_rgba(0,0,0,0.4)]">
            À la une
          </Badge>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-bold text-on-surface">{post.auteurNom}</span>
          <span className="truncate text-xs text-on-surface-variant">{auteurSecondaire}</span>
        </div>

        {dateValide && (
          <time dateTime={dateValide.toISOString()} className="text-xs text-on-surface-variant">
            {formatDistanceToNow(dateValide, { addSuffix: true, locale: fr })}
          </time>
        )}

        {extrait && (
          <p className="line-clamp-3 text-sm leading-relaxed text-on-surface-variant">
            <TexteDiscord texte={extrait} />
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          {post.source === "x" ? (
            <div className="flex items-center gap-3 text-xs text-on-surface-variant">
              <Metrique icone={Heart} valeur={post.metriques?.like_count} libelle="j'aime" />
              <Metrique icone={Repeat2} valeur={post.metriques?.retweet_count} libelle="repartages" />
              <Metrique icone={MessageCircle} valeur={post.metriques?.reply_count} libelle="réponses" />
            </div>
          ) : (
            <span className="text-xs text-on-surface-variant">Déposé sur Discord</span>
          )}

          <a
            href={lien.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={lien.ariaLabel}
            className={LIEN_VERS_X}
          >
            {lien.libelle}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>

        {/* `text-primary` et non `text-rg-or` : l'or de marque est lisible sur le
				    dégradé marine de la bannière, pas sur une surface d'interface claire. */}
        {post.hashtagTrouve && (
          <span className="text-xs font-semibold text-primary">{afficherHashtag(post.hashtagTrouve)}</span>
        )}
      </div>
    </Card>
  );
}
