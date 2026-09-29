"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useT } from "@/components/T";

/**
 * Corps partagé des `error.tsx` de rubrique.
 *
 * Le site n'avait qu'un `error.tsx` racine : la moindre erreur de rendu — un
 * hoquet de PostgreSQL sur une fiche — effaçait la page entière au profit d'un
 * panneau générique « ERREUR / Réessayer / Accueil », sans dire de quoi on
 * parlait ni comment revenir à la rubrique qu'on parcourait. Ici, la frontière
 * est locale : on nomme la section et on propose un retour utile.
 */
export function SectionError({
	error,
	reset,
	title,
	backHref,
	backLabel,
}: {
	error: Error & { digest?: string };
	reset: () => void;
	/** Ce qui n'a pas pu s'afficher, en clair. */
	title: string;
	backHref: string;
	backLabel: string;
}) {
	const t = useT();
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div className="mx-auto w-full max-w-[640px] px-6 py-24 text-center">
			<p className="font-scouter text-[11px] tracking-[0.4em] text-fuchsia-300">❯ ANOMALIE ❮</p>
			<h1 className="mt-4 font-display text-2xl font-bold text-white">{title}</h1>
			<p className="mt-3 text-white/60">
				{t("error.lead")}
			</p>
			{error.digest && (
				<p className="mt-4 font-mono text-[11px] text-white/50">
					{t("error.digest", { digest: error.digest })}
				</p>
			)}
			<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
				<button type="button" onClick={reset} className="dbz-button !text-xs">
					{t("error.retry")}
				</button>
				<Link href={backHref} className="dbz-button-ghost !text-xs">
					{backLabel}
				</Link>
			</div>
		</div>
	);
}
