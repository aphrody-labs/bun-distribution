"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import type { HashtagAffichable } from "@/lib/x-campagnes/types";

/*
 * Les hashtags de la campagne, affichés ET copiables.
 *
 * C'est l'information la plus utile de la page pour un participant : sans le bon
 * hashtag, sa création ne rejoint ni la fresque ni ce mur. Un badge décoratif ne
 * suffit pas — sur mobile, sélectionner du texte dans une bannière est pénible.
 * Un appui, le hashtag est dans le presse-papier.
 *
 * ⚠ Ce composant n'affiche QUE les hashtags publics de la campagne
 * (`x_campagnes.hashtags`, dans la casse de `hashtags_affichage`). Les hashtags
 * de rattrapage — la coquille de l'affiche IERG Day — ne sont même pas chargés
 * par `queries.ts` : les écrire ici propagerait la faute au lieu de la contenir.
 *
 * Ce composant-ci n'a effectivement aucun chemin de données pour les afficher,
 * mais LA PAGE, elle, en avait deux : le TEXTE des publications (masqué depuis en
 * SQL, cf. `x_masquer_hashtags` dans `queries.ts`) et les PIXELS de l'affiche
 * publiée, rectifiés à côté d'elle par `x_campagnes.note_affiche`.
 */

/** Copie sans lever : le presse-papier peut être refusé (permission, HTTP, vieux navigateur). */
async function copierDansLePressePapier(texte: string): Promise<boolean> {
	try {
		if (!navigator.clipboard?.writeText) {
			return false;
		}
		await navigator.clipboard.writeText(texte);
		return true;
	} catch {
		return false;
	}
}

export function HashtagsCopiables({ hashtags }: { hashtags: HashtagAffichable[] }) {
	/** Hashtag copié à l'instant, pour la coche éphémère. */
	const [copie, setCopie] = useState<string | null>(null);
	const [echec, setEchec] = useState(false);

	if (hashtags.length === 0) {
		return null;
	}

	const copier = async (libelle: string) => {
		const reussi = await copierDansLePressePapier(libelle);
		setEchec(!reussi);
		setCopie(reussi ? libelle : null);
		if (reussi) {
			setTimeout(() => setCopie((actuel) => (actuel === libelle ? null : actuel)), 2000);
		}
	};

	return (
		<div>
			<ul className="flex list-none flex-wrap gap-2 p-0">
				{hashtags.map((hashtag) => {
					const copieCeluiCi = copie === hashtag.libelle;
					return (
						<li key={hashtag.valeur}>
							<button
								type="button"
								onClick={() => void copier(hashtag.libelle)}
								aria-label={`Copier le hashtag ${hashtag.libelle}`}
								className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-primary/50 bg-surface-container-low px-4 text-sm font-bold text-on-surface transition-colors hover:border-primary hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
							>
								<span className="truncate">{hashtag.libelle}</span>
								{copieCeluiCi ? (
									<Check className="size-4 shrink-0 text-primary" aria-hidden />
								) : (
									<Copy className="size-4 shrink-0 text-primary/80" aria-hidden />
								)}
							</button>
						</li>
					);
				})}
			</ul>

			{/* Un seul message, annoncé poliment : ni infobulle, ni alerte modale. */}
			<p aria-live="polite" className="mt-1 min-h-4 text-xs text-on-surface-variant">
				{copie
					? `${copie} copié dans le presse-papier.`
					: echec
						? "Le navigateur a refusé la copie : sélectionnez le hashtag à la main."
						: ""}
			</p>
		</div>
	);
}
