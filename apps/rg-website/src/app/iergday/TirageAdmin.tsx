"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Textarea,
} from "@rosegriffon/ui";
import { Copy, Dices, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { effectuerTirage, engagerTirage, publierTirage } from "../admin/iergday/actions-tirage";

/*
 * Le tirage au sort, sur la page PUBLIQUE : un seul gros bouton rond, au centre.
 *
 * ── POURQUOI IL EST RENDU CÔTÉ SERVEUR ET NON CACHÉ EN CSS ────────────────
 * La page ne monte ce composant que si la session est administratrice ; un
 * visiteur anonyme n'en reçoit pas une ligne de HTML. Le masquer par une classe
 * `hidden` aurait expédié à TOUT LE MONDE la graine, les gagnants non encore
 * publiés et le texte d'engagement — il aurait suffi d'ouvrir les outils de
 * développement. « Seuls les admins peuvent VOIR » se joue au rendu, pas au CSS.
 *
 * ── ET POURQUOI CE N'EST PAS SUFFISANT ────────────────────────────────────
 * Ne pas rendre un bouton n'empêche personne d'appeler l'action : une server
 * action est un point d'entrée HTTP à part entière, joignable sans avoir jamais
 * affiché la page. Chaque action appelée ici REVÉRIFIE la session côté serveur.
 * Ce bouton n'est qu'une commodité d'accès, jamais une barrière.
 *
 * ── CE QUI RESTE MALGRÉ LE DÉPOUILLEMENT ──────────────────────────────────
 * Le texte d'engagement. Il n'est rendu QU'UNE FOIS, par l'action qui crée
 * l'engagement, et rien ne le reconstruit ensuite : c'est lui qui gèle la liste
 * et annonce le tour de hasard visé, donc c'est lui qui rend le tirage
 * opposable. Le laisser filer pour alléger l'écran reviendrait à faire un
 * tirage « vérifiable » que personne ne pourrait vérifier. Il s'ouvre donc dans
 * une boîte de dialogue, à côté du bouton — jamais à la place.
 */

/** Ce que la page sait déjà de l'état du tirage, lu en base côté serveur. */
export interface EtatTirage {
	tirageId: string | null;
	/**
	 * Engagement ouvert : le roster est gelé, le round visé est connu.
	 *
	 * ⚠ `pret` vient du SERVEUR et n'est pas recalculé ici. Le déduire de
	 * `Date.now()` ferait dépendre le déclenchement du tirage de l'horloge de la
	 * machine du visiteur, qui peut être fausse de plusieurs minutes — dans un
	 * sens comme dans l'autre. `chargerEngagementEnAttente` le calcule sur
	 * l'horloge du serveur, et `executerEtEnregistrer` le revérifie en base
	 * avant d'écrire quoi que ce soit.
	 */
	engagement: {
		tirageId: string;
		round: number | null;
		roundTombeAMs: number | null;
		pret: boolean;
		empreinteParticipants: string;
	} | null;
	/** Tirage effectué mais pas encore publié. */
	tireNonPublie: { tirageId: string; nbGagnants: number } | null;
	/** Un tirage publié existe déjà : plus rien à déclencher. */
	dejaPublie: boolean;
	nbParticipants: number;
	nbOeuvres: number;
}

/*
 * Les paramètres ANNONCÉS PUBLIQUEMENT le 19/08/2026 dans 🚨〡annonces, trois
 * jours avant la clôture : « nous allons offrir à deux participants un lot ».
 * Ils sont écrits ici en clair parce qu'ils ne sont plus négociables — les
 * changer après avoir vu le classement serait le seul vrai levier de
 * manipulation qui resterait, une fois la graine rendue imprévisible.
 */
const NB_GAGNANTS = 2;
const LOTS = ["Le tome 1 du manga Victory Road", "Un badge Roy et un badge Gaëlle"] as const;
const POIDS_MODE = "un_par_personne" as const;

/*
 * Le bouton. Rond, gros, centré.
 *
 * `size-44` (11 rem) : bien au-delà des 24 px de la WCAG 2.5.8 et des 44 px
 * recommandés au doigt, et assez grand pour qu'un libellé de deux mots tienne
 * sur deux lignes sans rogner. `rounded-full` avec une hauteur ÉGALE à la
 * largeur — un `rounded-full` sur une boîte rectangulaire donne une gélule, pas
 * un rond.
 *
 * L'ombre est le `0_4px_0_0` DUR de la direction artistique, pas une ombre
 * douce Material : c'est ce qui distingue nos boutons du shadcn par défaut.
 * `active:translate-y-1` avec l'ombre qui disparaît fait « enfoncer » le bouton
 * — le retour tactile vient de là, pas d'une transition de couleur.
 */
const ROND =
	// `has-[>svg]:px-4` n'est pas décoratif : la classe de base du bouton porte
	// `has-[>svg]:px-3`, et tailwind-merge NE la retire PAS face à `p-4` (une
	// classe préfixée d'une variante et une classe nue ne sont pas en conflit
	// pour lui — vérifié en exécutant twMerge). Sans ce rappel, le rembourrage
	// horizontal tombait à 12 px contre 16 px en vertical, dans un rond.
	"size-44 shrink-0 flex-col gap-1 rounded-full border-2 border-primary p-4 has-[>svg]:px-4 text-center " +
	"text-base font-bold leading-tight whitespace-normal " +
	"shadow-[0_4px_0_0_rgba(0,0,0,0.5)] transition-transform " +
	"active:translate-y-1 active:shadow-none " +
	"disabled:opacity-60 disabled:active:translate-y-0 " +
	"disabled:active:shadow-[0_4px_0_0_rgba(0,0,0,0.5)]";

export function TirageAdmin({ slug, etat }: { slug: string; etat: EtatTirage }) {
	const [enCours, demarrer] = useTransition();
	const [erreur, setErreur] = useState<string | null>(null);
	/*
	 * Deux états, et pas un seul : le TEXTE se garde tant que l'écran vit, la
	 * BOÎTE s'ouvre et se ferme. Les confondre — fermer la boîte en remettant le
	 * texte à `null` — détruisait la seule copie existante dès qu'on cliquait à
	 * côté, et le texte n'est reconstruit par personne.
	 */
	const [texteEngagement, setTexteEngagement] = useState<string | null>(null);
	const [dialogueOuvert, setDialogueOuvert] = useState(false);
	const [copie, setCopie] = useState(false);

	const agir = (
		action: () => Promise<{
			success: boolean;
			error?: string;
			message?: string;
			texteEngagement?: string;
		}>
	) => {
		setErreur(null);
		demarrer(async () => {
			try {
				const r = await action();
				if (!r.success) {
					setErreur(r.error ?? "Échec, sans message.");
					return;
				}
				if (r.texteEngagement) {
					setTexteEngagement(r.texteEngagement);
					setDialogueOuvert(true);
				}
			} catch (err) {
				setErreur(err instanceof Error ? err.message : String(err));
			}
		});
	};

	const copier = async (texte: string) => {
		try {
			await navigator.clipboard.writeText(texte);
			setCopie(true);
			setTimeout(() => setCopie(false), 2500);
		} catch {
			setErreur("Copie refusée par le navigateur — sélectionnez le texte à la main.");
		}
	};

	/*
	 * UN SEUL bouton, dont l'action dépend de l'étape en cours. Quatre boutons
	 * côte à côte auraient demandé au lecteur de savoir lequel appuyer ; ici
	 * l'écran ne propose jamais que le geste suivant.
	 */
	const etape = etat.dejaPublie
		? ({ libelle: "Tirage publié", agir: null, actif: false } as const)
		: etat.tireNonPublie
			? ({
					libelle: "Publier",
					agir: () => publierTirage(etat.tireNonPublie?.tirageId ?? "", true),
					actif: true,
				} as const)
			: etat.engagement
				? ({
						libelle: "Tirer au sort",
						agir: () => effectuerTirage(etat.engagement?.tirageId ?? ""),
						actif: etat.engagement.pret,
					} as const)
				: ({
						libelle: "Tirer au sort",
						agir: () =>
							engagerTirage({
								graineOrigine: "balise",
								lots: [...LOTS],
								nbGagnants: NB_GAGNANTS,
								poidsMode: POIDS_MODE,
								slug,
							}),
						actif: true,
					} as const);

	const roundPrevu = etat.engagement?.roundTombeAMs ? new Date(etat.engagement.roundTombeAMs) : null;

	return (
		<div className="flex flex-col items-center gap-3 py-2">
			<Button
				type="button"
				className={ROND}
				onClick={() => etape.agir && agir(etape.agir)}
				disabled={enCours || !etape.actif || !etape.agir}
				aria-label={`${etape.libelle} — ${etat.nbParticipants} participants, ${NB_GAGNANTS} gagnants`}
			>
				{enCours ? (
					<Loader2 className="size-8 animate-spin" aria-hidden />
				) : (
					<Dices className="size-8" aria-hidden />
				)}
				<span>{etape.libelle}</span>
			</Button>

			{/*
			 * Une seule ligne sous le bouton, et seulement quand elle apprend
			 * quelque chose. `aria-live` : le résultat d'une action doit atteindre
			 * un lecteur d'écran, qui ne verra pas le libellé du bouton changer.
			 */}
			<p aria-live="polite" className="min-h-5 text-center text-xs text-on-surface-variant">
				{erreur ? (
					<span className="text-destructive">{erreur}</span>
				) : etat.engagement && !etat.engagement.pret && roundPrevu ? (
					<>
						Tour {etat.engagement.round} à{" "}
						{roundPrevu.toLocaleTimeString("fr-FR", {
							hour: "2-digit",
							minute: "2-digit",
							second: "2-digit",
							timeZone: "Europe/Paris",
						})}
					</>
				) : etat.dejaPublie ? null : (
					<>
						{etat.nbParticipants} participants · {NB_GAGNANTS} gagnants
					</>
				)}
			</p>

			{texteEngagement && !dialogueOuvert && (
				<Button variant="ghost" size="sm" onClick={() => setDialogueOuvert(true)}>
					Revoir le texte d&apos;engagement
				</Button>
			)}

			<Dialog open={dialogueOuvert} onOpenChange={setDialogueOuvert}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>À publier dans Discord AVANT de tirer</DialogTitle>
						<DialogDescription>
							Ce texte gèle la liste et annonce le tour de hasard visé. Publié après le
							tirage, il ne prouverait plus rien.
						</DialogDescription>
					</DialogHeader>
					<Textarea
						readOnly
						value={texteEngagement ?? ""}
						className="h-56 font-mono text-xs"
						aria-label="Texte d'engagement à copier"
					/>
					<Button onClick={() => copier(texteEngagement ?? "")}>
						<Copy className="size-4" aria-hidden />
						{copie ? "Copié" : "Copier le texte"}
					</Button>
				</DialogContent>
			</Dialog>
		</div>
	);
}
