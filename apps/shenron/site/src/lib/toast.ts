/**
 * Notifications éphémères — implémentation maison, sans dépendance.
 *
 * Remplace `sonner`, qui coûtait **64 Kio bruts (~18 Kio brotli) sur CHAQUE page**
 * du site parce que son `<Toaster>` devait rester monté dans le layout racine —
 * pour deux boutons (partage, favoris) qui n'apparaissent que sur les fiches.
 *
 * Ici, rien n'est monté tant qu'aucun message n'est demandé : le premier appel
 * crée le conteneur, le dernier message le laisse vide. Pas de React, pas de
 * contexte, pas d'îlot supplémentaire dans le socle JS.
 *
 * Accessibilité : les messages sont annoncés par une région live (`polite` pour
 * un succès, `assertive` pour une erreur), et le bouton de fermeture porte un
 * nom. L'animation est retirée sous `prefers-reduced-motion`.
 *
 * API volontairement réduite à ce dont le site se sert :
 *   toast.success("Lien copié")
 *   toast.success("Ajouté", { description: "…" })
 *   toast.error("Copie impossible")
 */

type Ton = "success" | "error" | "info";

interface Options {
	/** Deuxième ligne, plus discrète. */
	description?: string;
	/** Durée d'affichage en ms (défaut : 4 s, 6 s pour une erreur). */
	duration?: number;
}

const ID_CONTENEUR = "dbfr-toasts";
const MAX_VISIBLES = 3;

/** Durée de l'animation de sortie, alignée sur la transition CSS ci-dessous. */
const SORTIE_MS = 220;

function reduceMotion(): boolean {
	return (
		typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function conteneur(): HTMLElement {
	let el = document.getElementById(ID_CONTENEUR);
	if (el) return el;
	el = document.createElement("div");
	el.id = ID_CONTENEUR;
	// `pointer-events: none` sur la pile, réactivé sur chaque message : la zone
	// vide ne doit jamais intercepter un clic sur la page.
	el.style.cssText =
		"position:fixed;z-index:120;right:1rem;bottom:1rem;display:flex;flex-direction:column;gap:.5rem;align-items:flex-end;pointer-events:none;max-width:min(24rem,calc(100vw - 2rem))";
	document.body.appendChild(el);
	return el;
}

const ACCENT: Record<Ton, string> = {
	success: "var(--color-dbz-orange)",
	error: "var(--color-dbz-red)",
	info: "var(--color-dbz-ki)",
};

function retirer(el: HTMLElement): void {
	if (!el.isConnected) return;
	if (reduceMotion()) {
		el.remove();
		return;
	}
	el.style.opacity = "0";
	el.style.transform = "translateY(6px)";
	setTimeout(() => el.remove(), SORTIE_MS);
}

function afficher(ton: Ton, message: string, options: Options = {}): void {
	if (typeof document === "undefined") return;
	const pile = conteneur();

	// Au-delà de trois messages, les plus anciens s'effacent : une pile qui
	// déborde masque le contenu au lieu de l'accompagner.
	while (pile.children.length >= MAX_VISIBLES) {
		pile.firstElementChild?.remove();
	}

	const el = document.createElement("div");
	el.setAttribute("role", ton === "error" ? "alert" : "status");
	el.setAttribute("aria-live", ton === "error" ? "assertive" : "polite");
	el.style.cssText = [
		"pointer-events:auto",
		"display:flex",
		"align-items:flex-start",
		"gap:.625rem",
		"padding:.75rem .875rem",
		"border-radius:.625rem",
		"border:1px solid var(--color-dbz-border)",
		"background:var(--color-dbz-card)",
		"color:#fff",
		"box-shadow:0 8px 28px rgba(0,0,0,.45)",
		`border-left:3px solid ${ACCENT[ton]}`,
		"font-family:var(--font-sans)",
		"font-size:13px",
		"line-height:1.4",
		reduceMotion()
			? ""
			: `opacity:0;transform:translateY(6px);transition:opacity ${SORTIE_MS}ms ease,transform ${SORTIE_MS}ms ease`,
	]
		.filter(Boolean)
		.join(";");

	const texte = document.createElement("div");
	texte.style.cssText = "flex:1;min-width:0";
	const titre = document.createElement("p");
	titre.textContent = message;
	titre.style.cssText = "margin:0;font-weight:600";
	texte.appendChild(titre);
	if (options.description) {
		const sous = document.createElement("p");
		sous.textContent = options.description;
		// `/70` et non une opacité plus basse : le seuil AA sur le fond des cartes.
		sous.style.cssText = "margin:.15rem 0 0;color:rgba(255,255,255,.7)";
		texte.appendChild(sous);
	}
	el.appendChild(texte);

	const fermer = document.createElement("button");
	fermer.type = "button";
	fermer.setAttribute("aria-label", "Fermer la notification");
	fermer.textContent = "×";
	fermer.style.cssText =
		"flex:none;background:none;border:0;color:rgba(255,255,255,.6);font-size:16px;line-height:1;cursor:pointer;padding:0 .125rem";
	fermer.addEventListener("click", () => retirer(el));
	el.appendChild(fermer);

	pile.appendChild(el);
	if (!reduceMotion()) {
		// Deux rAF : laisse le navigateur poser l'état initial avant la transition.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				el.style.opacity = "1";
				el.style.transform = "translateY(0)";
			})
		);
	}

	const duree = options.duration ?? (ton === "error" ? 6000 : 4000);
	let minuteur = setTimeout(() => retirer(el), duree);
	// Survoler ou focaliser un message suspend son compte à rebours : sans cela,
	// une description un peu longue disparaît avant d'être lue.
	const suspendre = () => clearTimeout(minuteur);
	const reprendre = () => {
		minuteur = setTimeout(() => retirer(el), 2000);
	};
	el.addEventListener("pointerenter", suspendre);
	el.addEventListener("focusin", suspendre);
	el.addEventListener("pointerleave", reprendre);
	el.addEventListener("focusout", reprendre);
}

export const toast = {
	success: (message: string, options?: Options) => afficher("success", message, options),
	error: (message: string, options?: Options) => afficher("error", message, options),
	info: (message: string, options?: Options) => afficher("info", message, options),
};
