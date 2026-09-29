"use client";

import { SectionError } from "@/components/SectionError";

/**
 * Frontière d'erreur de la page de canonicité.
 *
 * Sans elle, un hoquet de PostgreSQL ou du corpus remontait jusqu'au
 * `error.tsx` racine : le lecteur perdait la page ET le contexte, avec pour
 * seule issue un bouton « Accueil ». Ici, le retour proposé est la page vide de
 * canonicité — la barre y est rendue sans aucune dépendance de base, donc
 * reposer la question suffit dans le cas courant (une reformulation qui
 * déclenche un chemin fragile du moteur de recherche).
 */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<SectionError
			{...props}
			title="La vérification de canonicité n'a pas pu s'afficher"
			backHref="/wiki/canon"
			backLabel="Reposer une question"
		/>
	);
}
