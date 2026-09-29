"use client";

import { Cadenas, Telecharger } from "@/components/icones";
import { useMe } from "@/lib/use-me";

interface EpisodeDownloadProps {
	/** Route server login-gated qui résout le MP4 (utilisée si connecté). */
	href: string;
	/** Chemin de retour après /signin si l'utilisateur n'est pas connecté. */
	signinCallback: string;
	title: string;
	className?: string;
}

/**
 * Bouton de téléchargement (épisodes & films). **Connexion Discord requise.**
 * L'état d'auth est lu côté client (`useMe`) → la page hôte reste cacheable
 * (ISR) sans `cookies()`. Déconnecté → cadenas + lien /signin ; connecté → lien
 * vers `href` (route server elle-même login-gated, défense en profondeur).
 * Pendant le chargement de l'état, on pointe sur `href` (la route bounce vers
 * /signin si besoin).
 */
export function EpisodeDownload({
	href,
	signinCallback,
	title,
	className = "",
}: EpisodeDownloadProps) {
	const me = useMe();
	const loggedOut = me !== undefined && !me.authenticated;
	const target = loggedOut ? `/signin?callbackURL=${encodeURIComponent(signinCallback)}` : href;
	const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`;

	return (
		<a
			href={target}
			{...(loggedOut ? {} : { download: filename })}
			className={`inline-flex items-center justify-center w-10 h-10 rounded-full border border-white/20 bg-black/60 backdrop-blur-md text-white/80 hover:text-dbz-orange hover:border-dbz-orange hover:scale-105 hover:bg-black/80 transition-all duration-300 shadow-lg cursor-pointer ${className}`}
			title={loggedOut ? "Connexion Discord requise pour télécharger" : `Télécharger : ${title}`}
			aria-label={loggedOut ? "Connexion requise pour télécharger" : "Télécharger"}
		>
			{loggedOut ? <Cadenas className="w-5 h-5" /> : <Telecharger className="w-5 h-5" />}
		</a>
	);
}
