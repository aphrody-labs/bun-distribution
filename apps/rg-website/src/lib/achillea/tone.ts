/**
 * Pont tonalités Achilléa → variantes shadcn/ui.
 *
 * Module PUR (pas de `"use client"`, pas de `server-only`) : une constante lue
 * côté serveur depuis un module client casse le `next build` en silence — voir
 * `CLAUDE.md`. Tout ce qui est partagé serveur/client vit donc ici.
 */

import { TONE_TO_SHADCN_BADGE, TONE_TO_TAILWIND, type Tone } from "@rosegriffon/achillea-core";

export type { Tone };

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Variante `<Badge>` correspondant à une tonalité métier. */
export function badgeVariant(tone: Tone): BadgeVariant {
	return TONE_TO_SHADCN_BADGE[tone];
}

/** Classes Tailwind de repli, pour un rendu hors `<Badge>`. */
export function toneClassName(tone: Tone): string {
	return TONE_TO_TAILWIND[tone];
}
