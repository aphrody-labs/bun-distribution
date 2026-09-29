"use client";

/**
 * Bouton de partage — `navigator.share` quand il existe, copie du lien sinon.
 *
 * Le site s'adosse à une communauté Discord et n'offrait AUCUN moyen de
 * partager une fiche : ni bouton natif, ni copie de lien, ni intention sociale.
 * Le seul usage du presse-papiers était l'export Markdown de la chronologie.
 *
 * `navigator.share` n'est exposé qu'en contexte sécurisé et, sur desktop,
 * seulement sur certains navigateurs : on ne décide donc qu'au montage (jamais
 * au rendu serveur, qui n'a pas l'objet) pour ne pas diverger à l'hydratation.
 */
import { useEffect, useRef, useState } from "react";
import { Coche, Envoyer, Lien } from "@/components/icones";
import { toast } from "@/lib/toast";

export function ShareButton({
	title,
	text,
	/** Chemin relatif ; l'URL absolue est résolue au clic, côté navigateur. */
	path,
	className = "",
	label = "Partager",
}: {
	title: string;
	text?: string;
	path?: string;
	className?: string;
	label?: string;
}) {
	const [canShare, setCanShare] = useState(false);
	const [copied, setCopied] = useState(false);
	/** Retour à l'état « Partager » après la confirmation de copie. */
	const retour = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
	}, []);

	// Ce bouton vit dans des fiches wiki : copier un lien puis naviguer dans la
	// seconde et demie qui suit démonte le composant, et le minuteur se
	// déclenchait ensuite dans le vide. On l'annule au démontage.
	useEffect(
		() => () => {
			if (retour.current) clearTimeout(retour.current);
		},
		[]
	);

	const onClick = async () => {
		const url = new URL(path ?? window.location.pathname, window.location.origin).toString();
		if (canShare) {
			try {
				await navigator.share({ title, text, url });
				return;
			} catch (err) {
				// `AbortError` = l'utilisateur a fermé la feuille de partage : ce n'est
				// pas un échec, on ne bascule pas sur la copie derrière son dos.
				if (err instanceof DOMException && err.name === "AbortError") return;
			}
		}
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			toast.success("Lien copié");
			if (retour.current) clearTimeout(retour.current);
			retour.current = setTimeout(() => {
				retour.current = null;
				setCopied(false);
			}, 1800);
		} catch {
			toast.error("Copie impossible — le lien est dans la barre d'adresse.");
		}
	};

	const Icon = copied ? Coche : canShare ? Envoyer : Lien;

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`${label} : ${title}`}
			className={
				className ||
				"inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-[13px] font-display font-semibold text-white/70 transition-colors hover:border-dbz-orange/50 hover:text-dbz-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60"
			}
		>
			<Icon className="h-4 w-4" aria-hidden />
			{copied ? "Lien copié" : label}
		</button>
	);
}
