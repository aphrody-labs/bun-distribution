"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KintoUn } from "@/components/KintoUn";
import { useT } from "@/components/T";

/** Les figures déclenchées au clic, dans l'ordre où elles s'enchaînent. */
const FIGURES = ["boucle", "vrille", "trombe", "rebond"] as const;
type Figure = (typeof FIGURES)[number];

/** Durée de chaque figure, calée sur les `@keyframes` (globals.css). */
const DUREE: Record<Figure, number> = { boucle: 1500, vrille: 1100, trombe: 1300, rebond: 1200 };

/**
 * Le Kinto-Un qui vole au-dessus de l'accueil.
 *
 * Trois comportements, et ils ne se marchent pas dessus parce qu'ils agissent
 * sur des couches différentes : le DÉFILEMENT déplace le conteneur (propriétés
 * custom lues en CSS), le SURVOL incline la coque, et le CLIC anime le nuage
 * lui-même. Trois éléments imbriqués, une transformation chacun — les empiler
 * sur le même nœud les ferait s'écraser mutuellement.
 *
 * Le nuage suit le défilement plutôt que de traverser en boucle : le visiteur
 * qui descend a l'impression que le nuage l'accompagne, ce qu'une traversée
 * automatique ne donne jamais puisqu'elle ignore ce qu'il fait.
 *
 * Il reste sur le BORD GAUCHE et n'entre jamais dans le champ. La version
 * précédente le faisait traverser tout l'écran (`-12vw` → `106vw`) : à
 * mi-défilement il se posait au milieu de la page, par-dessus le titre puis
 * par-dessus les grilles de contenu, en gros et à pleine opacité — c'est le
 * moment exact où il gênait le plus. Le voir passer au bord suffit à le lire
 * comme un objet en vol ; le voir couvrir le texte n'ajoute rien.
 */
export function KintoUnVolant() {
	const t = useT();
	const coque = useRef<HTMLDivElement>(null);
	const [figure, setFigure] = useState<Figure | null>(null);
	const [survol, setSurvol] = useState(false);
	const [horsHero, setHorsHero] = useState(false);
	const suivant = useRef(0);
	const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		// Un seul cadre d'animation en vol : le gestionnaire de défilement ne fait
		// que noter la position, tout le calcul se fait dans le cadre suivant.
		let cadre = 0;
		let cible = 0;
		let courant = 0;
		const el = coque.current;
		if (!el) return;

		const mesurer = () => {
			const h = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
			cible = Math.min(1, Math.max(0, window.scrollY / h));
			// Le Kinto-Un est le décor du premier écran. Dès que le lecteur commence
			// à explorer le contenu, il se retire plutôt que de le suivre et de
			// traverser les panneaux suivants.
			setHorsHero((etaitHorsHero) => {
				const estHorsHero = window.scrollY > 48;
				return etaitHorsHero === estHorsHero ? etaitHorsHero : estHorsHero;
			});
			if (!cadre) cadre = requestAnimationFrame(peindre);
		};
		const peindre = () => {
			cadre = 0;
			// Lissage : le nuage rattrape la position de défilement au lieu de s'y
			// coller. Sans ce retard il paraît vissé à la page, pas en vol.
			courant += (cible - courant) * 0.12;
			// Trajectoire : le nuage MONTE ET DESCEND le long du bord gauche, il ne
			// traverse pas. Le défilement pilote la hauteur (de 14vh à 74vh, soit
			// la colonne utile sous la barre de navigation), et l'axe horizontal ne
			// sert plus qu'à une petite houle d'avant en arrière — assez pour que
			// le vol ne soit pas un rail, jamais assez pour entrer dans le champ.
			//
			// L'amplitude en X est bornée à [-10vw, -4vw] : le nuage mord toujours
			// le bord, une bonne part hors cadre. C'est ce qui le fait lire comme un
			// objet qui passe, et non comme une vignette collée dans un coin — et
			// à 1440 px cela le contient sous x = 93, quand la pastille « gardiens
			// en ligne » du héros commence à x = 101. La borne haute était à -1vw :
			// le nuage entrait alors de 137 px et passait sous la pastille.
			const houle = Math.sin(courant * Math.PI * 3);
			el.style.setProperty("--kt-x", `${-7 + houle * 3}vw`);
			el.style.setProperty("--kt-y", `${courant * 60}vh`);
			el.style.setProperty("--kt-inclinaison", `${Math.cos(courant * Math.PI * 3) * 6}deg`);
			// Profondeur : le nuage plane loin au départ (0,72 ×, à peine visible)
			// et s'approche au milieu du parcours (1,06 ×, franc). C'est cette
			// variation, et non la seule translation, qui le fait appartenir à
			// l'image plutôt que la survoler — une taille constante lit comme un
			// calque posé sur la vidéo. L'échelle maximale descend de 1,18 à 1,06 :
			// contre le bord, un nuage plus gros déborde de la fenêtre au lieu de
			// la longer.
			const profondeur = Math.sin(courant * Math.PI); // 0 aux bords, 1 au milieu
			el.style.setProperty("--kt-echelle", `${(0.72 + profondeur * 0.34).toFixed(3)}`);
			el.style.setProperty("--kt-opacite", `${(0.45 + profondeur * 0.5).toFixed(3)}`);
			if (Math.abs(cible - courant) > 0.0005) cadre = requestAnimationFrame(peindre);
		};

		mesurer();
		window.addEventListener("scroll", mesurer, { passive: true });
		window.addEventListener("resize", mesurer);
		return () => {
			window.removeEventListener("scroll", mesurer);
			window.removeEventListener("resize", mesurer);
			if (cadre) cancelAnimationFrame(cadre);
		};
	}, []);

	const jouer = useCallback(() => {
		// Les figures s'enchaînent d'un clic à l'autre : cliquer deux fois de suite
		// ne rejoue pas la même, sinon l'objet paraît n'avoir qu'un seul tour.
		const f = FIGURES[suivant.current % FIGURES.length];
		suivant.current += 1;
		if (minuteur.current) clearTimeout(minuteur.current);
		setFigure(null);
		// Un cadre de battement pour que le retrait de classe soit pris en compte,
		// faute de quoi rejouer la même figure ne redémarre pas l'animation.
		requestAnimationFrame(() => {
			setFigure(f);
			minuteur.current = setTimeout(() => setFigure(null), DUREE[f]);
		});
	}, []);

	useEffect(() => () => void (minuteur.current && clearTimeout(minuteur.current)), []);

	return (
		<div
			ref={coque}
			className="kt-volant"
			data-survol={survol || undefined}
			data-hors-hero={horsHero || undefined}
			aria-hidden={horsHero || undefined}
		>
			<button
				type="button"
				className="kt-volant__prise"
				tabIndex={horsHero ? -1 : undefined}
				onClick={jouer}
				onPointerEnter={() => setSurvol(true)}
				onPointerLeave={() => setSurvol(false)}
				onFocus={() => setSurvol(true)}
				onBlur={() => setSurvol(false)}
				aria-label={t("home.kintoun.trick")}
			>
				<span className="kt-volant__nuage" data-figure={figure ?? undefined}>
					<KintoUn hauteur={120} decorative />
				</span>
				<span className="kt-volant__vitesse" aria-hidden />
			</button>
		</div>
	);
}
