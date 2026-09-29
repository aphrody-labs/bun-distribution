"use client";

/**
 * Bouton « Mettre en favori ».
 *
 * Fonctionne sans compte (stockage navigateur) et se synchronise en base dès
 * qu'une session existe — `useMe` déclenche `syncFavorites()` une seule fois.
 *
 * L'état initial est `false` au rendu serveur ET au premier rendu client, puis
 * corrigé par l'effet : `localStorage` n'existe pas côté serveur, toute lecture
 * pendant le rendu produirait une divergence d'hydratation.
 */
import { useEffect, useState } from "react";
import { Coeur } from "@/components/icones";
import { toast } from "@/lib/toast";
import { useMe } from "@/lib/use-me";
import {
	FAVORITES_EVENT,
	isFavorited,
	syncFavorites,
	toggleFavorite,
	type FavoriteKind,
} from "@/lib/favorites";

export function FavoriteButton({
	kind,
	id,
	title,
	href,
	image,
	caption,
	className = "",
}: {
	kind: FavoriteKind;
	id: string | number;
	title: string;
	href: string;
	image?: string | null;
	caption?: string | null;
	className?: string;
}) {
	const me = useMe();
	const key = String(id);
	const [on, setOn] = useState(false);

	useEffect(() => {
		const refresh = () => setOn(isFavorited(kind, key));
		refresh();
		window.addEventListener(FAVORITES_EVENT, refresh);
		return () => window.removeEventListener(FAVORITES_EVENT, refresh);
	}, [kind, key]);

	useEffect(() => {
		if (me?.authenticated) void syncFavorites();
	}, [me?.authenticated]);

	const onClick = () => {
		const next = toggleFavorite({ kind, id: key, title, href, image, caption });
		setOn(next);
		toast.success(next ? "Ajouté à tes favoris" : "Retiré de tes favoris", {
			description: me?.authenticated
				? undefined
				: "Connecte-toi pour les retrouver sur tes autres appareils.",
		});
	};

	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={on}
			aria-label={on ? `Retirer « ${title} » des favoris` : `Ajouter « ${title} » aux favoris`}
			className={
				className ||
				`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-display font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60 ${
					on
						? "border-dbz-orange/60 text-dbz-orange"
						: "border-white/15 text-white/70 hover:border-dbz-orange/50 hover:text-dbz-orange"
				}`
			}
		>
			<Coeur className="h-4 w-4" aria-hidden fill={on ? "currentColor" : "none"} />
			{on ? "En favori" : "Favori"}
		</button>
	);
}
