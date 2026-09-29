"use client";

/**
 * LikeButton — le « j'aime » de TOUTES les surfaces (article, fiche wiki,
 * databook, tier list, commentaire).
 *
 * Îlot client par nécessité : le compteur est public mais « est-ce que JE l'ai
 * aimé » ne l'est pas. Rendre cet état côté serveur rendrait la page dynamique
 * et lui ferait perdre son cache CDN. Le compteur initial arrive donc en `props`
 * (rendu statique, bon pour le SEO et contre le CLS) et l'état personnel est
 * résolu après montage par `/api/social/reactions`.
 *
 * Le clic est optimiste : le compteur bouge immédiatement, et revient en arrière
 * si le serveur refuse. Sur un bouton aussi anodin, attendre l'aller-retour
 * donne l'impression que rien ne s'est passé.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMe } from "@/lib/use-me";
import { Coeur } from "@/components/icones";
import { socialErrorMessage } from "@/lib/social-shared";

export function LikeButton({
	target,
	initialLikes,
	callbackURL,
	className = "",
	compact = false,
	label = "J'aime",
}: {
	/** Cible formatée : `post:<id>`, `wiki:<table>#<id>`… */
	target: string;
	/**
	 * Compteur rendu côté serveur. **Omis**, le bouton va le chercher lui-même au
	 * montage : c'est ce qui permet aux ~2 000 fiches statiques du wiki de ne pas
	 * payer une requête de plus À LA COMPILATION (le build du site est déjà mort
	 * en OOM une fois, cf. `/wiki/corriger`).
	 */
	initialLikes?: number;
	/** Où revenir après connexion, si un visiteur anonyme clique. */
	callbackURL?: string;
	className?: string;
	/** Variante resserrée pour les fils de commentaires. */
	compact?: boolean;
	label?: string;
}) {
	const me = useMe();
	const [likes, setLikes] = useState(initialLikes ?? 0);
	const [liked, setLiked] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Deux raisons d'interroger l'API : connaître l'état personnel du lecteur, et
	// obtenir le compteur quand la page ne l'a pas rendu (fiches statiques). Un
	// visiteur anonyme sur une page qui a déjà le compteur ne déclenche rien.
	useEffect(() => {
		if (me === undefined) return;
		if (!me.authenticated && initialLikes !== undefined) return;
		let alive = true;
		fetch(`/api/social/reactions?target=${encodeURIComponent(target)}`, {
			credentials: "include",
		})
			.then((r) => (r.ok ? r.json() : null))
			.then((json: { reactions?: Record<string, { likes: number; liked: boolean }> } | null) => {
				const state = json?.reactions?.[target];
				if (!alive || !state) return;
				setLikes(state.likes);
				setLiked(state.liked);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [me, initialLikes, target]);

	const toggle = useCallback(async () => {
		if (pending) return;
		setPending(true);
		setError(null);
		// Bascule optimiste, annulée si le serveur refuse.
		const before = { likes, liked };
		setLiked(!liked);
		setLikes(likes + (liked ? -1 : 1));
		try {
			const res = await fetch("/api/social/reactions", {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ target }),
			});
			const json = (await res.json()) as {
				ok?: boolean;
				liked?: boolean;
				likes?: number;
				error?: string;
			};
			if (!res.ok || !json.ok) {
				setLikes(before.likes);
				setLiked(before.liked);
				setError(socialErrorMessage(json.error));
				return;
			}
			setLikes(json.likes ?? before.likes);
			setLiked(Boolean(json.liked));
		} catch {
			setLikes(before.likes);
			setLiked(before.liked);
			setError("Réseau indisponible.");
		} finally {
			setPending(false);
		}
	}, [liked, likes, pending, target]);

	// Glyphe du jeu maison, jamais un caractère « ♥ » : DESIGN.md exclut les
	// symboles décoratifs de l'interface, et le rendu d'un dingbat dépend de la
	// police installée (carré vide sur certains Android).
	const heart = <Coeur size={compact ? 14 : 16} aria-hidden />;
	// Pastille d'action (rayon plein autorisé pour un CTA, cf. § Shapes) : filet
	// seul au repos, or plein quand c'est aimé. Pas d'ombre portée — la
	// profondeur vient du filet (§ Elevation & Depth).
	const base = compact
		? "inline-flex min-h-11 items-center gap-1.5 font-mono text-[0.8125rem] tabular-nums transition-colors"
		: "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-display text-[0.75rem] font-semibold uppercase tracking-[0.08em] tabular-nums transition-colors";
	const tone = compact
		? liked
			? "text-dbz-orange"
			: "text-white/55 hover:text-white/85"
		: liked
			? "border-dbz-orange bg-dbz-orange text-black"
			: "border-white/15 text-white/75 hover:border-dbz-orange/60 hover:text-white";

	// Visiteur anonyme : le compteur reste lisible, le clic mène à la connexion.
	if (me && !me.authenticated) {
		return (
			<Link
				href={`/signin${callbackURL ? `?callbackURL=${encodeURIComponent(callbackURL)}` : ""}`}
				className={`${base} ${tone} ${className}`}
				title="Connecte-toi pour aimer"
			>
				{heart}
				<span>{likes}</span>
				{!compact && <span className="sr-only">{label} — connexion requise</span>}
			</Link>
		);
	}

	return (
		<button
			type="button"
			onClick={toggle}
			disabled={pending || me === undefined}
			aria-pressed={liked}
			className={`${base} ${tone} ${className} disabled:opacity-60`}
			title={error ?? (liked ? "Retirer mon j'aime" : label)}
		>
			{heart}
			<span>{likes}</span>
			{!compact && <span className="sr-only">{label}</span>}
		</button>
	);
}
