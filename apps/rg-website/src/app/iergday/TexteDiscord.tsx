/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { decouperTexteDiscord, urlEmojiDiscord } from "@/lib/x-campagnes/discord-texte";

/**
 * Rend un texte de message Discord : les émojis personnalisés en images, le reste en texte.
 *
 * ── POURQUOI PAS `next/image` ─────────────────────────────────────────────
 * Un émoji fait 20 px et vit sur `cdn.discordapp.com`. Le passer à l'optimiseur imposerait
 * d'ouvrir un `remotePattern` sur un domaine tiers ET de payer une transformation par émoji
 * (le quota d'optimisation d'images est déjà la cause de photos d'équipe cassées ailleurs
 * dans ce dépôt). Une balise `<img>` de 48 px servie directement, en chargement paresseux,
 * coûte moins cher que la négociation.
 *
 * ── SI L'IMAGE NE CHARGE PAS ──────────────────────────────────────────────
 * `alt` porte `:nom:`. Un lecteur d'écran, un client sans images, un bloqueur de domaines
 * tiers ou une politique de sécurité trop stricte donnent donc « merci :RG_Roy_coeur1: » —
 * lisible, et sans rien qui ressemble à un bogue. C'est exactement ce que Discord affiche
 * quand un émoji n'est pas disponible.
 *
 * Ni état, ni gestionnaire d'événement, ni accès à la base : il se rend aussi bien dans un
 * arbre serveur qu'à l'intérieur d'un îlot `"use client"` (la galerie et la visionneuse en
 * sont deux), sans avoir à choisir un camp.
 */
export function TexteDiscord({ texte, className }: { texte: string; className?: string }) {
  const morceaux = decouperTexteDiscord(texte);

  if (morceaux.length === 0) {
    return null;
  }

  // Aucun émoji : on rend la chaîne telle quelle plutôt qu'un `<span>` par morceau.
  if (morceaux.every(morceau => morceau.type === "texte")) {
    return <span className={className}>{texte}</span>;
  }

  return (
    <span className={className}>
      {morceaux.map((morceau, position) =>
        morceau.type === "emoji" ? (
          <img
            // eslint-disable-next-line @next/next/no-img-element
            key={`${morceau.id}-${position}`}
            src={urlEmojiDiscord(morceau.id, morceau.anime)}
            alt={`:${morceau.nom}:`}
            width={20}
            height={20}
            loading="lazy"
            decoding="async"
            // `align-text-bottom` plutôt que `middle` : à hauteur de ligne serrée, un
            // émoji centré verticalement pousse la ligne d'une paire de pixels et fait
            // « respirer » le paragraphe de façon irrégulière.
            className="inline-block size-5 align-text-bottom"
          />
        ) : (
          <span key={`t-${position}`}>{morceau.valeur}</span>
        ),
      )}
    </span>
  );
}
