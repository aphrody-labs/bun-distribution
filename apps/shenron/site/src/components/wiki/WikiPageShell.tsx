import type { ReactNode } from "react";
import Image from "next/image";

/**
 * Coque commune des index encyclopédiques.
 *
 * Les pages wiki ont longtemps recopié `wiki-container` avec `py-6` ou `py-8`
 * dans un ordre différent. Cette primitive fixe une seule largeur, gouttière et
 * cadence : les grilles restent libres de leur composition, mais le parcours
 * ne change plus de rythme d'une rubrique à l'autre.
 */
export function WikiPageShell({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<div className={`wiki-container relative overflow-hidden py-8 space-y-8 ${className}`}>
			<Image
				src="/dbz/kinto-un.svg"
				alt=""
				aria-hidden
				width={260}
				height={146}
				className="pointer-events-none absolute right-[-3rem] top-4 -z-0 hidden opacity-[0.07] md:block"
			/>
			<div className="relative z-[1]">{children}</div>
		</div>
	);
}
