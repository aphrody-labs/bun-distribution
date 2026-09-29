"use client";

import { useEffect, useState } from "react";

/**
 * Filet de progression de lecture, en haut de l'article.
 *
 * Îlot client volontairement minuscule : il ne lit ni session ni cookie, donc la
 * page article reste entièrement cacheable côté CDN (cf. la règle « pas de
 * session dans le rendu » de CLAUDE.md).
 */
export function ReadingProgress() {
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const update = () => {
			const doc = document.documentElement;
			// Hauteur réellement défilable : sur un article court, elle peut être
			// nulle — on évite alors la division par zéro (barre laissée à 0).
			const scrollable = doc.scrollHeight - doc.clientHeight;
			setProgress(scrollable > 0 ? Math.min(1, doc.scrollTop / scrollable) : 0);
		};

		update();
		// `passive` : le handler ne fait que lire, il ne doit pas retarder le scroll.
		window.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		return () => {
			window.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, []);

	return (
		<div
			className="ed-no-print fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent"
			role="progressbar"
			aria-label="Progression de lecture"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}
		>
			<div
				className="h-full origin-left bg-[color:var(--ed-accent)] transition-transform duration-75 ease-out"
				style={{ transform: `scaleX(${progress})` }}
			/>
		</div>
	);
}
