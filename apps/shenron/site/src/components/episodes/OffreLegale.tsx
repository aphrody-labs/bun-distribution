import type { Availability } from "@/db/bot-schema";

const LANG_LABEL: Record<string, string> = { vf: "VF", vostfr: "VOSTFR" };
/** VF d'abord (audience FR), VOSTFR ensuite — même ordre que le sélecteur de lecteurs. */
const LANG_ORDER = ["vf", "vostfr"] as const;

/**
 * « Où regarder cet épisode / ce film légalement », et dans quelle langue.
 *
 * Composant SERVEUR : aucune interactivité, donc aucun JS envoyé au client et
 * aucune fuite dans le bundle. C'est volontaire — un lien sortant n'a pas
 * besoin d'état.
 *
 * Ce n'est PAS un lecteur : on ne met rien en iframe ici. `availability` porte
 * une destination chez un ayant droit, pas une source à incruster ; les deux
 * ne doivent pas se ressembler à l'écran, sans quoi le visiteur ne sait plus
 * ce qu'il regarde ni chez qui.
 *
 * Les langues affichées sont celles RELEVÉES chez le fournisseur
 * (`sync-availability-adn.ts`), pas une promesse éditoriale : si ADN retire la
 * VF d'un épisode, la pastille disparaît au relevé suivant.
 */
export function OffreLegale({ offres }: { offres: Availability[] | null | undefined }) {
	const list = (offres ?? []).filter((o) => o?.url);
	if (list.length === 0) return null;

	// Union des langues, tous fournisseurs confondus : c'est la réponse à
	// « est-ce que ça existe en VF ? », qui ne dépend pas de chez qui.
	const toutes = new Set(list.flatMap((o) => o.langs ?? []));
	const langs = LANG_ORDER.filter((l) => toutes.has(l));

	return (
		<section
			aria-label="Regarder légalement"
			className="dbz-panel flex flex-col gap-3 rounded-lg border border-dbz-border p-4"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h2 className="font-display text-[13px] font-bold tracking-wide text-white/90">
					Regarder légalement
				</h2>
				{langs.length > 0 && (
					<div className="flex items-center gap-1.5" aria-label="Langues disponibles">
						{langs.map((l) => (
							<span
								key={l}
								className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-display font-semibold tracking-wide text-white/80"
							>
								{LANG_LABEL[l]}
							</span>
						))}
					</div>
				)}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{list.map((o) => (
					<a
						key={`${o.provider}-${o.url}`}
						href={o.url}
						target="_blank"
						// `noopener`/`noreferrer` : un lien sortant ne doit pas donner la
						// main sur notre onglet, ni annoncer d'où vient le visiteur.
						rel="noopener noreferrer"
						className="rounded-full bg-dbz-orange px-4 py-1.5 text-[12px] font-display font-bold tracking-wide text-black transition-opacity hover:opacity-90"
					>
						{o.label}
						{o.langs?.length ? ` · ${o.langs.map((l) => LANG_LABEL[l]).join(" / ")}` : ""}
					</a>
				))}
			</div>

			<p className="text-[11px] text-white/50">
				Proposé par {list.map((o) => o.label).join(", ")} — service officiel, abonnement ou achat
				selon le titre. Nous ne diffusons pas la vidéo : le lien ouvre le catalogue de l'ayant
				droit.
			</p>
		</section>
	);
}
