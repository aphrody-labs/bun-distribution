/**
 * Rendu d'une transcription de planche.
 *
 * Le texte des planches est du **markdown** : produit par un modèle de vision
 * lisant des scans, il structure ce qu'il voit en titres et en listes — 1 357
 * planches commencent par un `#`. Il était pourtant affiché en
 * `whitespace-pre-wrap`, donc les dièses et les astérisques s'affichaient tels
 * quels au lecteur.
 *
 * Volontairement plus restreint que `WikiMarkdown` : celui-ci active
 * `rehype-raw` pour laisser l'admin écrire du HTML de mise en page, ce qui
 * impose une passe de sanitisation. Une transcription ne contient jamais de
 * HTML — n'activant pas `rehype-raw`, react-markdown échappe tout balisage brut,
 * et il n'y a plus rien à assainir.
 *
 * Isomorphe (pas de `"use client"`) : sert au rendu public comme à l'aperçu du
 * relecteur admin, pour que les deux montrent exactement la même chose.
 */
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { classerDefaut, type Defaut } from "@/lib/databooks-defauts";

/** Hiragana, katakana, idéogrammes CJK, ponctuation japonaise. */
const CJK = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿＀-ﾟ]/;

/**
 * `lang` de la transcription, ou `undefined` si le texte est latin.
 *
 * Le corpus est majoritairement japonais, mais pas exclusivement (crédits,
 * titres occidentaux, quelques ouvrages traduits). Annoncer `ja` sur tout
 * serait faux là où ça compte : un lecteur d'écran ânonnerait du français avec
 * une voix japonaise. On ne le pose que si le texte contient réellement du CJK.
 */
function langue(texte: string): "ja" | undefined {
	return CJK.test(texte) ? "ja" : undefined;
}

/**
 * Défauts qu'on avertit au lecteur. Ce sont ceux où le texte affiché est
 * **faux**, pas seulement incomplet : signe perdu, alphabet halluciné, faux
 * chinois, segment répété en boucle. « courte » et « vide » ne sont pas des
 * erreurs de lecture (une planche peut n'avoir presque rien à lire) — on ne dit
 * rien plutôt que de crier au loup sur une pleine page d'illustration.
 */
const DEFAUTS_AVERTIS: ReadonlySet<Defaut> = new Set<Defaut>([
	"remplacement",
	"etranger",
	"han-sans-kana",
	"boucle",
]);

/**
 * Transcription affichée, précédée d'un avertissement quand la lecture
 * automatique a visiblement déraillé.
 *
 * 2 223 planches sur 11 778 portent une signature mécanique d'échec du modèle
 * d'OCR (mesure du 2026-08-25). La relecture à l'image les reprend une par une,
 * mais elle prend des semaines : d'ici là, présenter du cyrillique halluciné ou
 * une boucle de 40 répétitions comme si c'était la page fait passer une erreur
 * pour une source. On garde le texte — il reste souvent exact à 90 % et il
 * alimente la recherche — mais on dit ce qu'il vaut.
 */
export function TranscriptionTexte({
	texte,
	bookId,
	page,
	verifiee = false,
}: {
	texte: string;
	/** Ouvrage et numéro de planche — sans eux, pas de lien de correction. */
	bookId?: number | string | null;
	page?: number | null;
	/**
	 * Planche acquittée à la main par un relecteur : plus d'avertissement.
	 *
	 * Les signatures sont mécaniques et se trompent sur les planches maigres —
	 * une couverture de V Jump qui ne porte que « 3月号 » et « COVER » lève deux
	 * défauts pour une transcription exacte. Sans ce drapeau, le bandeau
	 * « passages mal lus » y restait à demeure, et il finissait par ne plus rien
	 * vouloir dire là où il est justifié.
	 */
	verifiee?: boolean;
}) {
	const defaut = classerDefaut(texte);
	const douteux = !verifiee && defaut !== null && DEFAUTS_AVERTIS.has(defaut);
	// Le lien de correction vise la planche, via la cible `pages#<numéro>` que
	// comprend le circuit de contribution. Il est rendu côté serveur (un simple
	// `<a>`, aucun composant client sur une page qui en porte déjà des
	// centaines) et l'accès est arbitré à l'arrivée, pas ici.
	const lienCorrection =
		bookId != null && page != null
			? `/wiki/corriger?table=db_databooks&row=${encodeURIComponent(String(bookId))}&col=${encodeURIComponent(`pages#${page}`)}`
			: null;
	return (
		<div>
			{douteux && (
				<p className="mb-3 rounded border border-dbz-orange/30 bg-dbz-orange/10 px-3 py-2 text-xs text-dbz-orange/90">
					Transcription automatique en cours de relecture : cette planche contient des passages mal
					lus.
					{lienCorrection && (
						<>
							{" "}
							<a
								href={lienCorrection}
								className="font-semibold underline decoration-dbz-orange/40 underline-offset-2 hover:decoration-current"
							>
								Corriger cette planche
							</a>
							.
						</>
					)}
				</p>
			)}
			<div
				className="prose-transcription text-sm leading-relaxed text-white/85"
				lang={langue(texte)}
			>
				<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{texte}</ReactMarkdown>
			</div>
			{/* Sur une planche saine, l'invitation reste discrète : elle ne doit pas
			    donner à croire que le texte est douteux alors qu'il ne l'est pas. */}
			{lienCorrection && !douteux && (
				<p className="mt-3 text-[11px] text-white/30">
					<a href={lienCorrection} className="hover:text-white/60 hover:underline">
						Une erreur dans cette transcription ?
					</a>
				</p>
			)}
		</div>
	);
}
