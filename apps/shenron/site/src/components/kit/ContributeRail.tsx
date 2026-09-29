"use client";

/**
 * ContributeRail — le pied de page participatif d'une catégorie.
 *
 * Pourquoi ce composant existe : une catégorie du wiki se termine sur le dernier
 * élément de sa grille, et c'est tout. Le lecteur qui vient de repérer un manque
 * n'a aucune prise à cet endroit — le chemin de correction n'existe que sur les
 * fiches, une fois qu'on a cliqué.
 *
 * **Deux lignes, pas un argumentaire.** La version du 2026-09-12 expliquait le
 * circuit interne (« un modérateur voit le diff et applique », « la révision est
 * enregistrée à ton nom ») : c'est du fonctionnement de salle des machines, pas
 * une invitation. Une question qui nomme ce qui manque, deux boutons, rien de plus.
 *
 * Îlot client, et pas par confort : la phrase ENCADRE ce qui manque (« Il manque
 * une technique ? »), et cet ordre des mots change d'une langue à l'autre. Seul
 * un `t()` qui reçoit les deux morceaux à la fois peut le rendre juste — d'où la
 * clé de dictionnaire en entrée plutôt qu'un bout de phrase déjà écrit.
 */
import Link from "next/link";
import { DISCORD_INVITE } from "@/lib/config";
import { useT } from "@/components/T";

export function ContributeRail({
	/** Clé du dictionnaire nommant ce qui manque ici (`kit.contribute.what.*`). */
	quoiKey,
	/** Lien de contribution ciblé ; à défaut, la page d'explication générale. */
	contributeHref = "/wiki/contribuer",
	className = "",
}: {
	quoiKey: string;
	contributeHref?: string;
	className?: string;
}) {
	const t = useT();
	return (
		<aside
			className={`rounded-xl border border-white/[0.08] bg-dbz-card/70 p-5 sm:p-7 ${className}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
				<div className="min-w-0">
					<h2 className="font-serif text-[1.1875rem] font-semibold leading-snug text-white sm:text-[1.375rem]">
						{t("kit.contribute.title", { quoi: t(quoiKey) })}
					</h2>
					<p className="mt-1.5 max-w-[52ch] text-[0.9375rem] leading-relaxed text-white/60">
						{t("kit.contribute.hint")}
					</p>
				</div>

				<div className="flex flex-wrap gap-3">
					<Link href={contributeHref} className="toriyama-btn !text-[0.75rem]">
						{t("kit.contribute.cta")}
					</Link>
					<a
						href={DISCORD_INVITE}
						target="_blank"
						rel="noopener noreferrer"
						className="toriyama-btn-secondary !text-[0.75rem]"
					>
						Discord
					</a>
				</div>
			</div>
		</aside>
	);
}
