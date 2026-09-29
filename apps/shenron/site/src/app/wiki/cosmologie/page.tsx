// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const revalidate = 3600;

/**
 * Index de la **cosmologie** — les lieux de l'univers Dragon Ball.
 *
 * Deux corrections en une. (1) La rubrique s'appelait « Planètes » alors que la
 * table héberge aussi des dimensions et des demeures divines : l'Autre Monde,
 * le Noyau du Monde, le temple mobile du Roi de Tout, la Planète sacrée,
 * l'Univers 11, les Planètes Emprisonnées, le Royaume des Démons. (2) Elle
 * n'avait pas de page à elle : `/wiki/cosmologie` était un `redirect()` de
 * composant vers `/wiki/personnages?tab=planetes` — et sous le layout `/wiki`,
 * qui streame, ce redirect dégrade en **200 + `<meta http-equiv="refresh">`**
 * (piège documenté dans CLAUDE.md, vérifié encore ici). Le visiteur voyait une
 * page blanche une seconde, et un moteur indexait une coquille de 76 Ko.
 */
export const metadata: Metadata = { title: "Lieux Dragon Ball", robots: { index: false, follow: true } };

export default async function CosmologiePage() {
	permanentRedirect("/wiki/lieux");
}
