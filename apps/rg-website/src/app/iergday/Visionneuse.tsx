"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle, cn } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { extraitTexteDiscord } from "@/lib/x-campagnes/discord-texte";
import { clePost, type PostCampagne, urlMessageDiscord, urlPostX } from "@/lib/x-campagnes/types";

import { TexteDiscord } from "./TexteDiscord";

/*
 * LA visionneuse plein écran de la page — il n'y en a qu'une, et il ne doit y en
 * avoir qu'une.
 *
 * Bâtie sur le `Dialog` partagé (Base UI) : l'overlay, le piège de focus, la
 * fermeture par Échap et le verrou de défilement viennent gratuitement du
 * composant. Il ne reste ici que ce que Base UI ne fournit pas : la navigation
 * ←/→ entre documents, le passage d'une image à l'autre au sein d'un même
 * document, et le téléchargement.
 *
 * ⚠ Elle ne connaît PAS les publications X. Elle affiche des `DocumentVisionne`,
 * c'est-à-dire « un titre, des images, une légende, un lien » — de quoi montrer
 * aussi bien une publication de la galerie que l'affiche officielle ou la carte
 * des règles de la campagne. Les visuels de campagne n'ont donc pas eu droit à
 * une seconde visionneuse : `documentDepuisPost()` ci-dessous est le seul
 * adaptateur, et `VisuelsCampagne.tsx` en fabrique un autre à partir de la base.
 * Fabriquer un faux `PostCampagne` (faux identifiant de tweet, faux auteur) pour
 * y faire entrer une affiche aurait été un mensonge dans les données.
 *
 * Le bouton de fermeture natif du `DialogContent` est désactivé
 * (`showCloseButton={false}`) : son libellé lecteur d'écran est en anglais.
 *
 * ⚠ LE RETOUR DU FOCUS EST À NOTRE CHARGE, contrairement à ce que Radix promet.
 * `DialogContent` restaure le focus sur `context.triggerRef` — un `DialogTrigger`
 * qui n'existe pas ici : la visionneuse s'ouvre par la prop `index`, pas par un
 * déclencheur Radix. `triggerRef.current` vaut donc `null`, le repli de
 * `FocusScope` a déjà été annulé, et le focus retombait sur `<body>` à CHAQUE
 * fermeture (Échap, bouton, six scénarios sur six) : au clavier, on repartait du
 * haut du document après chaque image. On mémorise donc nous-mêmes l'élément
 * focalisé avant l'ouverture, et on l'y ramène.
 */

/** Une image d'un document. `source` = pleine résolution, pour le téléchargement. */
export interface ImageVisionnee {
  /** URL donnée à `next/image`. */
  src: string;
  /** URL téléchargée par le bouton — l'original quand il existe. */
  source: string;
  /** Texte alternatif : seul l'appelant sait ce que montre l'image. */
  alt: string;
  /**
   * Image ou vidéo. `next/image` ne sait pas décoder un `.mov` : sans cette
   * distinction, une participation vidéo s'affichait comme un cadre vide.
   */
  kind: "image" | "video";
}

/** Ce que la visionneuse sait montrer : un document illustré, quelle qu'en soit l'origine. */
export interface DocumentVisionne {
  /** Clé React, stable et unique dans la liste. */
  cle: string;
  /** Première ligne de la barre d'outils (auteur, nature du visuel…). */
  titre: string;
  /** Seconde ligne, facultative (pseudo et date, nom de la campagne…). */
  sousTitre?: string | null;
  /** Base du nom de fichier proposé au téléchargement, sans extension. */
  baseNomFichier: string;
  /** Libellé annoncé aux lecteurs d'écran pour la boîte de dialogue. */
  etiquette: string;
  images: ImageVisionnee[];
  /**
   * Texte affiché sous l'image. Pour un visuel dont le texte vit DANS l'image
   * (une carte de règles), c'est la seule version lisible par un lecteur
   * d'écran ou un moteur de recherche : elle n'est pas décorative.
   */
  legende?: string | null;
  lien?: { href: string; libelle: string; ariaLabel: string } | null;
}

/** Adaptateur : une publication de la galerie devient un document visionnable. */
export function documentDepuisPost(post: PostCampagne): DocumentVisionne {
  const date = post.publieLe ? new Date(post.publieLe) : null;
  const dateLisible = date && !Number.isNaN(date.getTime()) ? format(date, "d MMMM yyyy", { locale: fr }) : null;
  /*
   * ⚠ LES DEUX SOURCES NE DÉSIGNENT PAS LEURS AUTEURS DE LA MÊME FAÇON.
   * Sur X, `auteurPseudo` est le @ public, il fait partie de l'identité affichée.
   * Sur Discord, il peut être absent (`string | null`) et n'est de toute façon
   * pas ce qu'on montre : l'attribution se fait au NOM D'AFFICHAGE, celui que la
   * personne a choisi sur le serveur. Écrire « @ » devant un nom d'affichage
   * Discord fabriquerait un pseudo qui n'existe pas.
   */
  // Un branchement par source : « pas X donc Discord » rangeait Instagram du
  // mauvais côté et fabriquait un lien `discord.com/channels/…` vers un message
  // qui n'existe pas.
  const surX = post.source === "x";
  const pseudoSur = surX ? `@${post.auteurPseudo}` : post.auteurNom;
  const reseau = post.source === "x" ? "X" : post.source === "discord" ? "le serveur Discord" : "Instagram";
  const identifiant = post.source === "x" ? post.tweetId : post.source === "discord" ? post.messageId : post.shortcode;
  const racineNom = (surX ? post.auteurPseudo : post.auteurNom).replace(/[^\w-]+/g, "");
  return {
    baseNomFichier: `${racineNom || "post"}-${identifiant}`,
    cle: clePost(post),
    etiquette: `Publication de ${pseudoSur}`,
    /*
     * ⚠ NOTRE COPIE EST LA PLEINE RÉSOLUTION, PAS L'ORIGINAL DE X.
     * `ImageCampagne.source` est l'URL `pbs.twimg.com/media/<id>.jpg` SANS
     * `?name=orig` : X y sert la variante « medium », plafonnée à 1200 px.
     * Mesuré le 12/8/2026 sur `2087485884413379048_0` — pbs : 1200×900
     * (209 399 o) ; notre bucket : 2048×1536 (468 760 o), soit 4,3× plus de
     * pixels, et c'est bien 2048 que la base enregistre en `width`.
     * `image.src` est en plus servi par notre origine (chemin relatif) : le
     * `fetch` du bouton « Télécharger » ne peut plus échouer sur CORS ni sur le
     * quota de pbs. Les 444 photos de la campagne ont leur objet en stockage
     * (vérifié), le repli sur l'original reste donc l'exception.
     */
    images: post.images.map((image, position) => ({
      alt: `${image.kind === "video" ? "Vidéo" : "Image"} ${position + 1} sur ${post.images.length} publiée sur ${reseau} par ${pseudoSur}`,
      kind: image.kind,
      source: image.src || image.source,
      src: image.src,
    })),
    // Même raison que sur la carte : `extraitTexte` coupe au caractère et peut trancher une
    // balise d'émoji en deux. Ici la légende est longue (400), mais un message qui commence
    // par quatre émojis suffisait à faire apparaître un fragment `<:RG_R` en fin de texte.
    legende: extraitTexteDiscord(post.texte, 400),
    /*
     * Un lien vers un message Discord n'a de sens QUE pour qui est déjà sur le
     * serveur : `discord.com/channels/…` renvoie les autres vers un écran de
     * connexion, sur un salon qu'ils ne peuvent pas voir. On le propose quand
     * même — le visiteur qui est membre y va d'un clic — mais son libellé le
     * dit, au lieu de promettre une page publique comme le fait « Voir sur X ».
     */
    lien: surX
      ? {
          ariaLabel: `Voir la publication de ${pseudoSur} sur X (nouvel onglet)`,
          href: urlPostX(post.auteurPseudo, post.tweetId),
          libelle: "Voir sur X",
        }
      : post.source === "discord"
        ? {
            ariaLabel: `Ouvrir le message de ${pseudoSur} dans Discord (nouvel onglet, réservé aux membres du serveur)`,
            href: urlMessageDiscord(post.guildId, post.salonId, post.messageId),
            libelle: "Ouvrir dans Discord",
          }
        : {
            ariaLabel: `Voir la publication de ${pseudoSur} sur Instagram (nouvel onglet)`,
            href: post.permalien,
            libelle: "Voir sur Instagram",
          },
    sousTitre: dateLisible ? `${pseudoSur} · ${dateLisible}` : pseudoSur,
    titre: post.auteurNom,
  };
}

/** Nom de fichier proposé au téléchargement, dérivé du document et de l'index. */
function nomFichier(documentVise: DocumentVisionne, index: number, url: string): string {
  const extension = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "jpg";
  const extensionSure = /^(jpe?g|png|webp|gif|avif)$/.test(extension) ? extension : "jpg";
  return `${documentVise.baseNomFichier}-${index + 1}.${extensionSure}`;
}

export function Visionneuse({
  documents,
  index,
  onFermer,
  onNaviguer,
}: {
  documents: DocumentVisionne[];
  /** Index du document ouvert, ou `null` si la visionneuse est fermée. */
  index: number | null;
  onFermer: () => void;
  onNaviguer: (nouvelIndex: number) => void;
}) {
  const [indexImage, setIndexImage] = useState(0);
  const [telechargement, setTelechargement] = useState(false);
  /** Élément à re-focaliser à la fermeture (la vignette qui a ouvert la vue). */
  const declencheur = useRef<HTMLElement | null>(null);
  const finalFocus = useCallback(() => (declencheur.current?.isConnected ? declencheur.current : true), []);

  const ouverte = index !== null;
  const documentOuvert = ouverte ? documents[index] : undefined;
  const aPrecedent = ouverte && index > 0;
  const aSuivant = ouverte && index < documents.length - 1;

  // Changer de document remet la visionneuse sur sa première image.
  const [previousIndex, setPreviousIndex] = useState(index);
  if (previousIndex !== index) {
    setPreviousIndex(index);
    setIndexImage(0);
  }

  /*
   * Tant que la visionneuse est FERMÉE, on suit le dernier élément focalisé : au
   * moment de l'ouverture, c'est la vignette qui vient d'être activée (clic ou
   * clavier). L'écoute s'arrête à l'ouverture, donc la référence ne bouge plus
   * pendant que Base UI promène le focus à l'intérieur de la boîte de dialogue.
   * `<body>` est ignoré : il ne se focalise pas, et il écraserait la référence
   * pendant la fermeture.
   */
  useEffect(() => {
    if (ouverte) {
      return;
    }
    const memoriser = () => {
      const actif = document.activeElement;
      if (actif instanceof HTMLElement && actif !== document.body) {
        declencheur.current = actif;
      }
    };
    memoriser();
    document.addEventListener("focusin", memoriser);
    return () => document.removeEventListener("focusin", memoriser);
  }, [ouverte]);

  const allerPrecedent = useCallback(() => {
    if (index !== null && index > 0) {
      onNaviguer(index - 1);
    }
  }, [index, onNaviguer]);

  const allerSuivant = useCallback(() => {
    if (index !== null && index < documents.length - 1) {
      onNaviguer(index + 1);
    }
  }, [index, onNaviguer, documents.length]);

  // Base UI gère Échap ; les flèches restent à notre charge.
  useEffect(() => {
    if (!ouverte) {
      return;
    }
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "ArrowLeft") {
        allerPrecedent();
      } else if (evenement.key === "ArrowRight") {
        allerSuivant();
      }
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [ouverte, allerPrecedent, allerSuivant]);

  if (!documentOuvert) {
    return null;
  }

  const image = documentOuvert.images[indexImage] ?? documentOuvert.images[0];

  const telecharger = async () => {
    if (!image || telechargement) {
      return;
    }
    // `source` est l'URL de PLEINE RÉSOLUTION choisie par l'adaptateur (notre
    // copie en stockage pour une publication X, le fichier lui-même pour un
    // visuel de campagne) : on ne rejuge pas ici de ce qu'il a décidé.
    const source = image.source || image.src;
    setTelechargement(true);
    try {
      const reponse = await fetch(source, { mode: "cors" });
      if (!reponse.ok) {
        throw new Error(`HTTP ${reponse.status}`);
      }
      const blob = await reponse.blob();
      const urlObjet = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = urlObjet;
      lien.download = nomFichier(documentOuvert, indexImage, source);
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      URL.revokeObjectURL(urlObjet);
    } catch {
      // Repli : ouvrir l'image dans un nouvel onglet si le fetch échoue (CORS…).
      window.open(source, "_blank", "noopener");
    } finally {
      setTelechargement(false);
    }
  };

  return (
    <Dialog
      open={ouverte}
      onOpenChange={ouvert => {
        if (!ouvert) {
          onFermer();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        /*
         * Le nom accessible de la boîte vient du `DialogTitle` ci-dessous :
         * `aria-labelledby` l'emporte sur un `aria-label` posé ici (vérifié
         * dans l'arbre d'accessibilité, où il ressortait « superseded »).
         * Inutile d'en poser un second, qui laisserait croire le contraire.
         */
        finalFocus={finalFocus}
        className="max-h-[95dvh] max-w-[96vw] gap-0 overflow-y-auto rounded-[24px] border-2 border-rg-or/40 bg-surface-container-lowest p-0 sm:max-w-4xl lg:max-w-5xl"
      >
        <DialogTitle className="sr-only">
          {documentOuvert.etiquette} — {index !== null ? index + 1 : 1} sur {documents.length}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Utilisez les flèches gauche et droite pour changer de document, la touche Échap pour fermer.
        </DialogDescription>

        {/* Barre d'outils : identité du document à gauche, actions à droite. */}
        <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold text-on-surface">{documentOuvert.titre}</span>
            {documentOuvert.sousTitre && (
              <span className="truncate text-xs text-on-surface-variant">{documentOuvert.sousTitre}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={telecharger}
              disabled={!image || telechargement}
              aria-label="Télécharger l'image"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50 sm:min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {/* `motion-safe:` — la seule animation de la page qui tournait encore
							    sous `prefers-reduced-motion: reduce` (le reste est déjà gardé). */}
              {telechargement ? (
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              <span className="hidden sm:inline">Télécharger</span>
            </button>
            <button
              type="button"
              onClick={onFermer}
              aria-label="Fermer la visionneuse"
              className="flex size-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high sm:size-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Image + flèches de navigation entre documents. */}
        <div className="relative flex h-[52dvh] items-center justify-center bg-surface-container-low sm:h-[62dvh]">
          {image?.kind === "video" ? (
            /*
             * Une vidéo n'est ni optimisée ni redimensionnée par Next : elle est
             * servie telle qu'elle a été déposée. `controls` sans lecture
             * automatique — la visionneuse s'ouvre sur un clic, pas sur un son.
             */
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={`${documentOuvert.cle}-${indexImage}`}
              src={image.src}
              controls
              playsInline
              preload="metadata"
              aria-label={image.alt}
              className="max-h-full max-w-full object-contain"
            />
          ) : image ? (
            /*
             * ⚠ PAS DE `unoptimized` ICI. La boîte plafonne à `max-w-[96vw]`,
             * `sm:max-w-4xl` (896 px) puis `lg:max-w-5xl` (1024 px) : servir
             * l'original faisait télécharger 150 307 o de WebP 1280×1280 pour
             * une zone de 356 px sur mobile (mesuré à 375 px), là où
             * l'optimiseur rend 27 415 o en AVIF — et jusqu'à 468 760 o pour
             * une image de galerie, dont notre copie fait 2048 px de large.
             * Le bouton « Télécharger », lui, continue de servir `source`,
             * c'est-à-dire la pleine résolution : l'optimisation ne concerne
             * que ce qui est AFFICHÉ.
             */
            <Image
              key={`${documentOuvert.cle}-${indexImage}`}
              src={image.src}
              alt={image.alt}
              fill
              sizes="(max-width: 639px) 96vw, (max-width: 1023px) 896px, 1024px"
              priority
              className="object-contain"
            />
          ) : (
            <p className="text-sm text-on-surface-variant">Média indisponible.</p>
          )}

          {aPrecedent && (
            <button
              type="button"
              onClick={allerPrecedent}
              aria-label="Document précédent"
              className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface-container/80 text-on-surface backdrop-blur-sm transition-colors hover:bg-surface-container-high sm:left-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
          )}
          {aSuivant && (
            <button
              type="button"
              onClick={allerSuivant}
              aria-label="Document suivant"
              className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface-container/80 text-on-surface backdrop-blur-sm transition-colors hover:bg-surface-container-high sm:right-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          )}
        </div>

        {/* Vignettes des autres images du MÊME document. */}
        {documentOuvert.images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-t border-outline-variant/40 px-4 py-3">
            {documentOuvert.images.map((autre, position) => (
              <button
                key={autre.src}
                type="button"
                onClick={() => setIndexImage(position)}
                aria-label={`Image ${position + 1} sur ${documentOuvert.images.length}`}
                aria-current={position === indexImage}
                className={cn(
                  "relative size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors" +
                    " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  position === indexImage ? "border-primary" : "border-outline-variant/40 hover:border-primary/60",
                )}
              >
                <Image src={autre.src} alt="" fill sizes="64px" quality={70} className="object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Légende, lien vers l'original, compteur de position. */}
        <div className="space-y-3 border-t border-outline-variant/40 px-4 py-4">
          {documentOuvert.legende && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface-variant">
              <TexteDiscord texte={documentOuvert.legende} />
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {documentOuvert.lien ? (
              <a
                href={documentOuvert.lien.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={documentOuvert.lien.ariaLabel}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 sm:min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {documentOuvert.lien.libelle}
                <ExternalLink className="size-4" aria-hidden />
              </a>
            ) : (
              <span />
            )}
            <span className="text-xs font-medium text-on-surface-variant">
              {(index ?? 0) + 1} / {documents.length}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
