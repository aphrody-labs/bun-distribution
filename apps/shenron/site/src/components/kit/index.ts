/**
 * kit — les primitives d'interface partagées par tout le site.
 *
 * Règle d'usage : une page ne redéfinit pas une largeur, un cadre, une carte,
 * une pagination ou un état vide. Si une variante manque, on l'ajoute ICI (avec
 * son nom et sa raison) plutôt que de recopier des classes dans un coin — c'est
 * ce qui a produit cinq cartes différentes et quatre largeurs de page.
 *
 * Tout est server-safe sauf `DomainBar`/`PublicViewLink`, qui dépendent de la
 * session côté client (marqués `"use client"` dans leur fichier).
 */
export { PageShell, Stack,   } from "@/components/kit/PageShell";
export { SectionHeading } from "@/components/kit/SectionHeading";
export { TabNav,  } from "@/components/kit/TabNav";
export { LinkPager,  } from "@/components/kit/LinkPager";
export { MangaCard, CardGrid, SocialCounts,  } from "@/components/kit/MangaCard";
export { EmptyState,  } from "@/components/kit/EmptyState";
export { StatTiles,  } from "@/components/kit/StatTiles";
export { Chip, ChipRow,  } from "@/components/kit/Chip";
export { ContributeRail } from "@/components/kit/ContributeRail";
export { DomainBar, PublicViewLink } from "@/components/kit/DomainBar";
