import { DiscordIcon, InstagramIcon, XIcon } from "@rosegriffon/ui";
import Link from "next/link";

/**
 * OÙ POSTER SA CRÉATION — les trois voies, côte à côte.
 *
 * ── CHACUNE PROMET EXACTEMENT CE QU'ELLE FAIT ──────────────────────────────
 *  * **X** ouvre la fenêtre de rédaction, hashtag DÉJÀ SAISI (`intent/post`).
 *    C'est la seule des trois qui sache pré-remplir quoi que ce soit.
 *  * **Discord** ouvre le salon de dépôt. Le lien n'est pas décoratif : le salon
 *    est sous veille, ce qui y est déposé rejoint la galerie tout seul.
 *  * **Instagram** ouvre Instagram, et rien de plus. **Il n'existe aucune URL
 *    permettant de pré-remplir une publication Instagram** — ni sur le web, ni
 *    par schéma d'application. Le bouton dit donc « Ouvrir Instagram » et non
 *    « Poster sur Instagram » : promettre un composeur pré-rempli, c'est
 *    envoyer le participant sur un écran vide en lui laissant croire qu'il a
 *    raté quelque chose. Le hashtag copiable est juste au-dessus, à un geste.
 *
 * Instagram n'est pas collecté automatiquement : aucun moyen ne le permet
 * aujourd'hui (mesuré le 13/8/2026, cf. `docs/insta.md`). Le libellé « Ouvrir »
 * plutôt que « Poster » est ce qui reste pour ne rien promettre de faux.
 */
export function BoutonsParticiper({
	urlX,
	depotDiscord,
	hashtag,
}: {
	/** Fenêtre de rédaction X, hashtag pré-saisi. */
	urlX: string | null;
	/** Salon de dépôt public, `null` s'il n'est pas sous veille. */
	depotDiscord: { url: string; nom: string | null } | null;
	/** Hashtag affichable (`#IERGDay`), pour les libellés d'accessibilité. */
	hashtag: string;
}) {
	// `min-h-11` : 44 px, la seule taille qui rende ces boutons cliquables au
	// pouce. C'est le chemin principal de la page sur mobile.
	const base =
		"inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

	return (
		<div className="flex flex-wrap gap-2">
			{urlX && (
				<Link
					href={urlX}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Rédiger une publication sur X avec ${hashtag} (nouvel onglet)`}
					className={`${base} bg-primary text-on-primary hover:bg-primary/90`}
				>
					<XIcon className="size-4" aria-hidden />
					Poster sur X
				</Link>
			)}

			{depotDiscord && (
				<Link
					href={depotDiscord.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Ouvrir le salon ${depotDiscord.nom ?? "de dépôt"} sur Discord (nouvel onglet)`}
					className={`${base} border border-outline-variant/60 bg-surface-container-low text-on-surface hover:bg-surface-container`}
				>
					<DiscordIcon className="size-4" aria-hidden />
					Poster sur Discord
				</Link>
			)}

			<Link
				href="https://www.instagram.com/"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Ouvrir Instagram (nouvel onglet). Instagram ne permet pas de pré-remplir une publication."
				className={`${base} border border-outline-variant/60 bg-surface-container-low text-on-surface hover:bg-surface-container`}
			>
				<InstagramIcon className="size-4" aria-hidden />
				Ouvrir Instagram
			</Link>
		</div>
	);
}
