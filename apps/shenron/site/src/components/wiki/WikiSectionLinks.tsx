/**
 * Cartes « pages wiki affiliées » d'une section : chaque lien renvoie vers une
 * autre fiche wiki avec sa photo (ex. affilier des personnages à une catégorie
 * « Powerscaling »). Server Component présentationnel — liens internes indexables.
 */
import Link from "next/link";
import type { WikiSectionLink } from "@/db/bot-schema";

export function WikiSectionLinks({ links }: { links: WikiSectionLink[] }) {
	if (!links || links.length === 0) return null;
	return (
		<div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{links.map((l, i) => (
				<Link
					key={`${l.href}-${i}`}
					href={l.href}
					className="group flex items-center gap-3 rounded-lg border border-dbz-border bg-dbz-card/60 p-2 transition-all hover:-translate-y-0.5 hover:border-dbz-orange hover:bg-dbz-card"
				>
					{l.image ? (
						<img
							src={l.image}
							alt=""
							loading="lazy"
							className="h-14 w-14 shrink-0 rounded-md object-cover object-top ring-1 ring-white/10"
						/>
					) : (
						<div className="h-14 w-14 shrink-0 rounded-md bg-dbz-bg" />
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate font-display text-sm font-bold text-white/90 group-hover:text-dbz-orange">
							{l.label}
						</p>
						{l.sub && <p className="truncate text-[11px] text-white/50">{l.sub}</p>}
						<span className="mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wider text-dbz-blue-light/70">
							Voir la fiche →
						</span>
					</div>
				</Link>
			))}
		</div>
	);
}
