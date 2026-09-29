"use client";

/**
 * ConsentGate — bannière de consentement RGPD minimale (cible France/UE).
 *
 * Affichée tant que l'utilisateur n'a pas tranché ET que le navigateur n'envoie
 * pas Do-Not-Track (DNT = refus implicite, on ne demande rien). Le choix est
 * stocké côté client (`consent.ts` → localStorage) et propagé :
 *   - au Consent Mode v2 de Google (GTM) via `gtag('consent','update',…)`,
 *   - à la télémétrie first-party + Vercel Analytics (qui no-op sans accord).
 *
 * Le strictement nécessaire (auth, sécurité) n'est jamais conditionné — seules
 * la mesure d'audience et la personnalisation le sont.
 *
 * Îlot client léger : aucune dépendance lourde, monté en bas de page.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getConsent, setConsent, setConsentFromCmp } from "@/lib/consent";

/**
 * API IAB TCF v2.2, exposée par un CMP certifié — chez nous « Confidentialité et
 * messages » d'AdSense (Funding Choices), chargé par `adsbygoogle.js`.
 */
type TcfApi = (
	command: "addEventListener" | "removeEventListener",
	version: 2,
	callback: (tcData: TcData, success: boolean) => void,
	listenerId?: number
) => void;

interface TcData {
	eventStatus?: string;
	gdprApplies?: boolean;
	listenerId?: number;
	purpose?: { consents?: Record<number, boolean> };
}

/**
 * Délai laissé au CMP pour s'annoncer avant de retomber sur notre bannière, et
 * fenêtre pendant laquelle on continue de le guetter. Le stub `__tcfapi` n'est
 * posé qu'après le chargement réseau d'`adsbygoogle.js` : sur connexion lente il
 * peut arriver bien après notre montage. On affiche donc notre bannière au bout
 * de `CMP_WAIT_MS`, mais on continue de surveiller jusqu'à `CMP_WATCH_MS` — si
 * le CMP finit par apparaître, on retire la nôtre plutôt que d'empiler deux
 * demandes de consentement contradictoires.
 */
const CMP_WAIT_MS = 2500;
const CMP_WATCH_MS = 10_000;

function isDoNotTrack(): boolean {
	if (typeof navigator === "undefined") return false;
	const nav = navigator as Navigator & {
		doNotTrack?: string;
		msDoNotTrack?: string;
	};
	const dnt =
		nav.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
	return dnt === "1" || dnt === "yes";
}

export function ConsentGate() {
	const [visible, setVisible] = useState(false);
	/** Le panneau lui-même : sa hauteur mesurée alimente `--consent-h`. */
	const panelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		// DNT actif → on respecte le refus implicite, pas de bannière.
		if (isDoNotTrack()) return;
		// Choix déjà fait → rien à afficher.
		if (getConsent().decided) return;

		// --- Priorité au CMP certifié -------------------------------------------
		// AdSense n'a le droit de diffuser dans l'EEE/UK que si le consentement
		// publicitaire vient d'un CMP **certifié Google** parlant IAB TCF. Notre
		// bannière maison ne l'est pas : quand le CMP d'AdSense est actif, il prend
		// la main et l'on ne montre PAS un second bandeau par-dessus (deux
		// demandes de consentement concurrentes = choix incohérents côté Google,
		// et un mur de bandeaux côté visiteur).
		let listenerId: number | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let poll: ReturnType<typeof setInterval> | undefined;
		let settled = false;

		const tcfApi = (): TcfApi | undefined => (window as unknown as { __tcfapi?: TcfApi }).__tcfapi;

		const attach = (api: TcfApi): void => {
			settled = true;
			// Le CMP certifié prend la main : notre bannière disparaît, même si elle
			// avait déjà été affichée pendant l'attente.
			setVisible(false);
			api("addEventListener", 2, (tcData, success) => {
				if (!success || !tcData) return;
				listenerId = tcData.listenerId ?? listenerId;
				// `cmpuishown` = bandeau du CMP à l'écran, le visiteur n'a pas
				// encore tranché : on attend, sans afficher le nôtre.
				if (tcData.eventStatus !== "tcloaded" && tcData.eventStatus !== "useractioncomplete") {
					return;
				}
				// Hors périmètre RGPD → le CMP ne demande rien ; on retombe sur notre
				// bannière pour la mesure d'audience (posture opt-in stricte).
				if (tcData.gdprApplies === false) {
					setVisible(true);
					return;
				}
				const consents = tcData.purpose?.consents ?? {};
				// Finalité 1 = stockage/accès sur l'appareil, finalité 8 = mesure de
				// la performance des contenus : le couple qui conditionne notre
				// télémétrie. Les finalités publicitaires restent gérées par le CMP.
				setConsentFromCmp(consents[1] === true && consents[8] === true);
			});
		};

		const existing = tcfApi();
		if (existing) {
			attach(existing);
		} else {
			// Le stub `__tcfapi` est posé par le script AdSense, donc après notre
			// montage : on le guette brièvement avant de conclure à son absence.
			const startedAt = performance.now();
			poll = setInterval(() => {
				if (settled) return;
				const api = tcfApi();
				if (api) {
					if (poll) clearInterval(poll);
					attach(api);
					return;
				}
				// Fin de la fenêtre de surveillance : plus aucun CMP n'est attendu.
				if (performance.now() - startedAt >= CMP_WATCH_MS && poll) clearInterval(poll);
			}, 150);
			timer = setTimeout(() => {
				// Pas (encore) de CMP certifié → notre bannière prend le relais ; la
				// surveillance continue et la retirera si le CMP finit par arriver.
				if (!settled) setVisible(true);
			}, CMP_WAIT_MS);
		}

		return () => {
			if (poll) clearInterval(poll);
			if (timer) clearTimeout(timer);
			if (listenerId !== undefined) {
				tcfApi()?.("removeEventListener", 2, () => {}, listenerId);
			}
		};
	}, []);

	// Marque le document tant que le bandeau occupe le bas de l'écran, et publie
	// sa hauteur réelle dans `--consent-h`.
	//
	// Deux problèmes se cumulaient sur mobile. (1) Les boutons flottants
	// « Signaler » et « Discord » vivent dans le même coin — la règle CSS
	// `html[data-consent-open]` (globals.css) les efface le temps du choix, qui
	// est ponctuel. (2) Surtout : le bandeau *flottait* à `bottom-24`, au-dessus
	// du contenu, et interceptait les clics de tout ce qui passait dessous —
	// mesuré sur `/wiki/databooks` (recherche + les 5 filtres injoignables), sur
	// le fil d'Ariane et sur la frise de `/wiki/chronologie`. Rien ne signalait
	// au visiteur que c'était le bandeau qui mangeait ses clics : il voyait un
	// site cassé. On l'ancre donc en bas (plus de contenu « sous » lui) et on
	// réserve sa hauteur en bas du document, si bien que le contenu remonte au
	// lieu d'être recouvert.
	useEffect(() => {
		if (!visible) return;
		const root = document.documentElement;
		root.setAttribute("data-consent-open", "");
		const el = panelRef.current;
		let ro: ResizeObserver | undefined;
		if (el) {
			const publish = () =>
				root.style.setProperty("--consent-h", `${Math.ceil(el.offsetHeight)}px`);
			publish();
			ro = new ResizeObserver(publish);
			ro.observe(el);
		}
		return () => {
			ro?.disconnect();
			root.removeAttribute("data-consent-open");
			root.style.removeProperty("--consent-h");
		};
	}, [visible]);

	if (!visible) return null;

	const accept = () => {
		setConsent(true);
		setVisible(false);
	};
	const decline = () => {
		setConsent(false);
		setVisible(false);
	};

	return (
		<div
			ref={panelRef}
			// `region` et non `dialog` : le bandeau ne bloque rien, ne piège pas le
			// focus et le site reste utilisable sans y répondre. Annoncer un
			// `dialog` non modal fait chercher aux lecteurs d'écran une fermeture
			// qui n'existe pas.
			role="region"
			aria-label="Préférences de confidentialité"
			aria-live="polite"
			// Mobile : ancré au ras du bas, pleine largeur, hauteur réservée par
			// `--consent-h` (cf. l'effet ci-dessus) → il ne recouvre plus rien.
			// À partir de `md` il redevient une carte flottante à droite, hors de
			// la trajectoire des boutons de gauche.
			className="consent-gate fixed bottom-0 inset-x-0 z-[60] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:inset-x-auto md:right-6 md:bottom-24 md:p-0 md:max-w-md reveal-up"
		>
			{/* Deux mises en forme, un seul contenu. Sur téléphone, la carte
			    détaillée mesurait près de 200 px : un quart de l'écran hors service
			    tant que le visiteur n'avait pas tranché (mesuré sur
			    /wiki/chronologie, huit contrôles injoignables). La version courte
			    tient sur deux lignes et renvoie au détail pour qui le veut. */}
			<div className="dbz-panel border-2 border-dbz-orange/40 bg-dbz-card/95 p-3 shadow-2xl backdrop-blur-sm md:p-5">
				<p className="mb-1 font-display text-sm font-bold uppercase tracking-widest text-white md:mb-2">
					Mesure d'audience
				</p>
				<p className="mb-3 font-sans text-xs leading-relaxed text-white/70 md:mb-4">
					<span className="md:hidden">
						Mesure anonymisée, aucune adresse IP conservée.{" "}
						<Link href="/confidentialite" className="underline underline-offset-2 hover:text-white">
							En savoir plus
						</Link>
					</span>
					<span className="hidden md:inline">
						On utilise une mesure d'audience anonymisée pour améliorer le wiki et te proposer des
						recommandations pertinentes. Aucune adresse IP brute n'est conservée. Tu peux refuser :
						l'essentiel du site fonctionne sans.
					</span>
				</p>
				<div className="flex gap-3">
					<button type="button" onClick={accept} className="dbz-button !py-2 !px-4 !text-xs flex-1">
						Accepter
					</button>
					<button
						type="button"
						onClick={decline}
						className="!py-2 !px-4 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white border border-dbz-border hover:border-white/40 transition-colors flex-1"
					>
						Refuser
					</button>
				</div>
			</div>
		</div>
	);
}
