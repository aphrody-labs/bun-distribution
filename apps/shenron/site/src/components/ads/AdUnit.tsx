"use client";

/**
 * AdUnit — bloc AdSense manuel, sûr pour un App Router.
 *
 * Ce que le snippet officiel d'AdSense ne gère pas et qu'on gère ici :
 *
 *  - **Navigation SPA** : `adsbygoogle.push({})` ne « rafraîchit » pas un `<ins>`
 *    déjà rempli. Sans remontage, une même annonce resterait figée d'une page à
 *    l'autre. On clé le `<ins>` sur le pathname → nouveau nœud DOM, nouveau push.
 *  - **Double push** (StrictMode, re-render) : AdSense marque le `<ins>` traité
 *    via `data-adsbygoogle-status="done"` ; on relit cet attribut avant de
 *    pousser, sinon la console crache `adsbygoogle.push() error: TagError`.
 *  - **Invendus** : quand aucune enchère ne remplit, AdSense pose
 *    `data-ad-status="unfilled"` et laisse un bloc vide. On l'observe pour
 *    replier complètement le conteneur (pas de trou blanc au milieu du contenu).
 *  - **CLS** : on réserve la hauteur de l'emplacement avant remplissage, puis on
 *    la relâche — l'annonce ne pousse pas le contenu vers le bas.
 *  - **Aucune réponse du tout** : bloqueur de publicité, script jamais chargé,
 *    consentement refusé côté CMP… `adsbygoogle.push()` ne lève PAS dans ces
 *    cas (empiler dans un tableau réussit toujours) et AdSense ne pose jamais
 *    `data-ad-status`. La réservation de hauteur serait alors définitive : un
 *    trou de 120 à 260 px au milieu de l'article. On la relâche donc au bout de
 *    `DELAI_REPLI_MS` sans démonter le bloc — si l'annonce arrive plus tard,
 *    elle s'affiche quand même.
 *  - **Largeur nulle** : un `<ins>` responsive monté dans un parent de largeur 0
 *    échoue (`availableWidth=0`) et reste vide définitivement. On attend une
 *    largeur mesurable avant de pousser.
 *
 * Un emplacement dont l'ID de bloc n'est pas posé en env ne rend rien (cf.
 * `@/lib/ads`) : la page est identique à aujourd'hui tant que le bloc n'existe
 * pas côté console AdSense.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AD_PLACEMENTS, ADSENSE_CLIENT, getAdPlacement, type AdPlacement } from "@/lib/ads";

declare global {
	interface Window {
		adsbygoogle?: unknown[];
	}
}

interface AdUnitProps {
	/** Emplacement logique (résolu en ID de bloc via l'env). */
	placement: AdPlacement;
	/** Classes du conteneur (marges verticales notamment). */
	className?: string;
	/**
	 * Libellé affiché au-dessus du bloc. Les règles AdSense imposent que la
	 * publicité ne puisse pas être confondue avec le contenu éditorial —
	 * « Publicité » est le libellé attendu côté FR. `null` pour l'omettre sur les
	 * formats déjà auto-libellés (multiplex).
	 */
	label?: string | null;
}

/**
 * Au-delà de ce délai sans le moindre signe d'AdSense, on considère que rien ne
 * viendra remplir l'emplacement et on rend sa hauteur au contenu. Assez long
 * pour couvrir une enchère lente sur réseau mobile, assez court pour que le trou
 * ne soit pas vu comme un défaut de mise en page.
 */
const DELAI_REPLI_MS = 4000;

export function AdUnit({ placement, className = "", label = "Publicité" }: AdUnitProps) {
	const spec = getAdPlacement(placement);
	const pathname = usePathname();
	const hostRef = useRef<HTMLDivElement | null>(null);
	// `sans-reponse` : réservation relâchée, bloc toujours monté (une annonce
	// tardive reste affichable) — à distinguer d'un invendu, qui replie tout.
	const [state, setState] = useState<"pending" | "filled" | "unfilled" | "sans-reponse">(
		"pending"
	);

	useEffect(() => {
		if (!spec) return;
		const host = hostRef.current;
		const ins = host?.querySelector<HTMLElement>("ins.adsbygoogle");
		if (!host || !ins) return;

		setState("pending");

		// Invendu → on replie le conteneur. AdSense pose l'attribut de façon
		// asynchrone, après la réponse d'enchère : d'où l'observateur.
		const observer = new MutationObserver(() => {
			const status = ins.getAttribute("data-ad-status");
			if (status === "unfilled") setState("unfilled");
			else if (status === "filled") setState("filled");
		});
		observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });

		let cancelled = false;
		const push = () => {
			if (cancelled) return;
			// Largeur nulle (parent caché, layout pas encore stabilisé) → on réessaie
			// au prochain frame plutôt que de griller le bloc.
			if (host.offsetWidth === 0) {
				requestAnimationFrame(push);
				return;
			}
			// Déjà traité par AdSense (StrictMode monte deux fois) → ne pas re-pousser.
			if (ins.dataset.adsbygoogleStatus) return;
			try {
				(window.adsbygoogle = window.adsbygoogle || []).push({});
			} catch {
				// Script bloqué (adblock) ou TagError : l'emplacement reste replié,
				// jamais d'exception remontée dans le rendu.
				setState("unfilled");
			}
		};
		push();

		// Filet anti-trou : sans nouvelle d'AdSense, on rend la place au contenu.
		const repli = window.setTimeout(
			() => setState((s) => (s === "pending" ? "sans-reponse" : s)),
			DELAI_REPLI_MS
		);

		return () => {
			cancelled = true;
			observer.disconnect();
			window.clearTimeout(repli);
		};
	}, [spec, pathname]);

	// En développement, aucun `<ins>` réel n'est poussé (charger de vraies
	// annonces hors production est un motif de suspension du compte AdSense) :
	// on rend un gabarit à la bonne empreinte pour valider la mise en page.
	if (!spec && process.env.NODE_ENV === "development") {
		const shape = AD_PLACEMENTS[placement];
		return (
			<div
				className={`ed-no-print print:hidden grid w-full place-items-center rounded-sm border border-dashed border-white/15 bg-white/[0.02] text-[11px] uppercase tracking-[0.18em] text-white/50 ${className}`}
				style={{ minHeight: shape.minHeight }}
			>
				Emplacement pub · {placement} · {shape.format}
			</div>
		);
	}

	if (!spec) return null;

	return (
		<div
			ref={hostRef}
			// Jamais d'annonce à l'impression. `ed-no-print` n'est défini que dans
			// `styles/editorial.css`, feuille chargée par le SEUL layout `/news` :
			// sur les fiches épisode et film, qui posent aussi un `AdUnit`, la classe
			// était inerte et l'annonce partait au papier. `print:hidden` (variante
			// Tailwind, donc toujours présente) couvre tous les points d'appel.
			className={`ed-no-print print:hidden w-full ${state === "unfilled" ? "hidden" : ""} ${className}`}
			// Réservation d'espace tant que le remplissage n'est pas connu.
			style={state === "pending" ? { minHeight: spec.minHeight } : undefined}
			aria-hidden={state === "unfilled"}
		>
			{label && state !== "unfilled" && state !== "sans-reponse" && (
				<p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
					{label}
				</p>
			)}
			<ins
				// Clé sur le pathname : force un nœud neuf à chaque page (cf. en-tête).
				key={`${spec.slot}-${pathname}`}
				className="adsbygoogle block"
				style={{ display: "block" }}
				data-ad-client={ADSENSE_CLIENT}
				data-ad-slot={spec.slot}
				data-ad-format={spec.format}
				data-ad-layout={spec.layout}
				data-ad-layout-key={spec.layoutKey}
				// Laisse le bloc occuper toute la largeur disponible sur mobile.
				data-full-width-responsive="true"
			/>
		</div>
	);
}
