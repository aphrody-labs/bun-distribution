// Rendu des résultats d'un sondage — barres CSS pures, zéro JavaScript envoyé.
//
// Un résultat EasyPoll est une liste ordonnée de 1 à 12 lignes
// « emoji + libellé + pourcentage + (n) » : sa traduction fidèle est une barre,
// pas un graphique. Un `BarChart` imposerait « use client » sur toute la carte
// (et casserait le rendu serveur du markdown Discord) pour un rendu moins
// lisible sur douze catégories à libellés longs.
//
// Aucune couleur en dur : uniquement les tokens du design system. La seule
// valeur dynamique est la largeur de la barre — c'est une donnée, pas une teinte.

import { Trophy } from "lucide-react";

import type { ContexteMentions } from "@/lib/discord/markdown-ast";
import { TexteDiscordInline } from "@/lib/discord/markdown";
import {
	type OptionSondage,
	type Sondage,
	aDesResultats,
	libelleAvecEmoji,
	mentionSource,
	pourcentage,
	resumeQuestion,
} from "@/lib/discord/polls-types";

/** Pourcentage en français : virgule décimale, une décimale au plus. */
function formaterPourcentage(valeur: number): string {
	return `${valeur.toFixed(1).replace(".", ",")} %`;
}

function LigneOption({
	option,
	sondage,
	contexte,
	rang,
	enTete,
}: {
	option: OptionSondage;
	sondage: Sondage;
	contexte: ContexteMentions;
	/** Rang au classement (1 = plus de votes). Absent = ordre d'origine. */
	rang?: number;
	enTete?: boolean;
}) {
	const part = pourcentage(option, sondage);
	const votes = option.votes ?? 0;
	const libelle = libelleAvecEmoji(option);
	const motVotes = votes === 1 ? "vote" : "votes";

	return (
		<li className="space-y-1.5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<span
					className={`flex min-w-0 items-baseline gap-2 break-words text-fluid-body-md ${
						enTete ? "font-semibold text-on-surface" : "text-on-surface"
					}`}
				>
					{rang !== undefined && (
						<span className="shrink-0 tabular-nums text-on-surface-variant" aria-hidden>
							{rang}.
						</span>
					)}
					{enTete && <Trophy className="size-4 shrink-0 text-rg-or" aria-hidden />}
					<span className="min-w-0 break-words">
						<TexteDiscordInline contenu={libelle} contexte={contexte} />
					</span>
				</span>
				<span className="shrink-0 tabular-nums text-fluid-body-md text-on-surface-variant">
					{formaterPourcentage(part)}{" "}
					<span className="text-on-surface-variant/80">
						({votes} {motVotes})
					</span>
				</span>
			</div>
			{/* `meter` = mesure figée dans un intervalle connu (et non une progression
			    en cours) : c'est exactement ce qu'est un résultat de sondage clos. */}
			<meter
				min={0}
				max={100}
				value={Number(part.toFixed(1))}
				aria-valuetext={`${formaterPourcentage(part)}, soit ${votes} ${motVotes}`}
				aria-label={`Part des votes pour « ${resumeQuestion(option.label, 60)} »`}
				className="sr-only"
			/>
			<div aria-hidden="true" className="h-2.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
				{/* Seule valeur dynamique de tout le bloc : une largeur, donc une donnée.
				    Aucune couleur n'est calculée, elles viennent toutes des tokens. */}
				<div
					className={`h-full rounded-full ${enTete ? "bg-rg-or" : "bg-primary"}`}
					style={{ width: `${Math.min(Math.max(part, 0), 100).toFixed(2)}%` }}
				/>
			</div>
			{/* Une fois le classement appliqué, l'ordre de l'encart d'origine n'est
			    plus lisible : on le rappelle pour qu'on puisse s'y retrouver. */}
			{rang !== undefined && (
				<p className="text-xs text-on-surface-variant/80">Choix nº {option.position + 1}</p>
			)}
		</li>
	);
}

/** Choix listés sans chiffre : sondage dont les résultats n'ont jamais été publiés. */
function ChoixSansResultat({
	sondage,
	contexte,
	limite,
}: {
	sondage: Sondage;
	contexte: ContexteMentions;
	limite?: number;
}) {
	const affiches = limite ? sondage.options.slice(0, limite) : sondage.options;
	const restants = sondage.options.length - affiches.length;

	return (
		<div className="space-y-3">
			<p className="rounded-xl border border-outline-variant/40 bg-surface-container px-3 py-2 text-fluid-body-md text-on-surface-variant">
				Résultats masqués : le bot ne les publie pas tant que le sondage tourne.
			</p>
			<ul className="space-y-2">
				{affiches.map((option) => (
					<li
						key={option.position}
						className="flex items-baseline gap-2 break-words text-fluid-body-md text-on-surface"
					>
						<span className="shrink-0 text-on-surface-variant" aria-hidden>
							•
						</span>
						<span className="min-w-0 break-words">
							<TexteDiscordInline contenu={libelleAvecEmoji(option)} contexte={contexte} />
						</span>
					</li>
				))}
			</ul>
			{restants > 0 && (
				<p className="text-sm text-on-surface-variant">
					… et {restants} autre{restants > 1 ? "s" : ""} choix.
				</p>
			)}
		</div>
	);
}

export interface ResultatsSondageProps {
	sondage: Sondage;
	contexte: ContexteMentions;
	/** Options affichées au maximum (liste), toutes si absent (détail). */
	limite?: number;
	/** Classer par nombre de votes et numéroter, au lieu de l'ordre d'origine. */
	classe?: boolean;
	/** Option à mettre en avant (vainqueur), sur la page de détail. */
	optionEnTete?: OptionSondage | null;
	/** Options déjà ordonnées par l'appelant (classement calculé une seule fois). */
	options?: OptionSondage[];
}

/**
 * Bloc de résultats d'un sondage. Trois états, jamais confondus :
 * résultats disponibles, résultats non publiés, aucun vote enregistré.
 */
export function ResultatsSondage({
	sondage,
	contexte,
	limite,
	classe = false,
	optionEnTete = null,
	options,
}: ResultatsSondageProps) {
	if (sondage.options.length === 0) {
		return (
			<p className="text-fluid-body-md text-on-surface-variant">
				Les choix de ce sondage n'ont pas été archivés.
			</p>
		);
	}

	// Une barre à 0 % se lirait « personne n'a voté » : quand le décompte n'existe
	// pas, on n'en dessine aucune.
	if (!aDesResultats(sondage)) {
		return <ChoixSansResultat sondage={sondage} contexte={contexte} limite={limite} />;
	}

	if (sondage.total_votes === 0) {
		return (
			<div className="space-y-3">
				<p className="text-fluid-body-md text-on-surface-variant">Aucun vote enregistré.</p>
				<ChoixSansResultat sondage={sondage} contexte={contexte} limite={limite} />
			</div>
		);
	}

	// Un sondage à choix unique (mécanisme d'inscription à un tirage) donnerait une
	// barre à 100 % qui n'apprend rien : on n'annonce que la participation.
	if (sondage.options.length === 1) {
		const seule = sondage.options[0];
		const votes = seule?.votes ?? sondage.total_votes ?? 0;
		return (
			<div className="space-y-2">
				<p className="break-words text-fluid-body-md text-on-surface">
					{seule && <TexteDiscordInline contenu={libelleAvecEmoji(seule)} contexte={contexte} />}
				</p>
				<p className="text-fluid-body-md font-semibold text-on-surface">
					{votes} participation{votes > 1 ? "s" : ""}
				</p>
				<MentionFiabilite sondage={sondage} />
			</div>
		);
	}

	const ordonnees = options ?? sondage.options;
	const affichees = limite ? ordonnees.slice(0, limite) : ordonnees;
	const restants = ordonnees.length - affichees.length;

	return (
		<div className="space-y-3">
			<ul className="space-y-3">
				{affichees.map((option, index) => (
					<LigneOption
						key={option.position}
						contexte={contexte}
						enTete={optionEnTete?.position === option.position}
						option={option}
						rang={classe ? index + 1 : undefined}
						sondage={sondage}
					/>
				))}
			</ul>
			{restants > 0 && (
				<p className="text-sm text-on-surface-variant">
					… et {restants} autre{restants > 1 ? "s" : ""} choix.
				</p>
			)}
			<MentionFiabilite sondage={sondage} />
		</div>
	);
}

/** Mention de fiabilité : un décompte reconstitué ne se présente pas comme officiel. */
export function MentionFiabilite({ sondage }: { sondage: Sondage }) {
	const mention = mentionSource(sondage);
	if (!mention) return null;
	return <p className="text-sm text-on-surface-variant/90 italic">{mention}</p>;
}
