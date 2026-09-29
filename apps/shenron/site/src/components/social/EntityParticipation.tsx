/**
 * EntityParticipation — le bloc « participer » d'une fiche, en une ligne d'appel.
 *
 * Le wiki comptait seize gabarits de fiches (personnages, sagas, arcs, races,
 * transformations, techniques, films, épisodes, jeux, databooks…) et AUCUN
 * n'offrait de commentaire ni de « j'aime » : la participation s'arrêtait au
 * formulaire de correction. Plutôt que de recopier un bloc social dans seize
 * pages, tout passe ici : une cible, un compteur, un fil, un rappel du chemin de
 * contribution.
 *
 * Server component : la première page du fil est rendue côté serveur (donc
 * indexable, sans saut de mise en page), et seules les interactions passent par
 * les îlots clients. La page hôte reste cacheable — aucune session n'est lue.
 */
import Link from "next/link";
import { listComments, reactionState } from "@/lib/social";
import { wikiTargetId, formatTarget, type SocialKind } from "@/lib/social-shared";
import { isContributableColumn } from "@/lib/contributions-shared";
import { CommentThread } from "@/components/social/CommentThread";
import { LikeButton } from "@/components/social/LikeButton";

export async function EntityParticipation({
	kind,
	/** Table wiki (`db_characters`…) pour `kind="wiki"`. */
	table,
	/** Clé primaire de la ligne, ou identifiant de l'entité. */
	id,
	/** URL publique de la fiche — retour après connexion et ancre des messages. */
	path,
	/** Nom de l'entité, pour le titre du bloc. */
	label,
	/**
	 * Colonne visée par le lien « proposer une correction ». `article` est le corps
	 * rédactionnel de presque toutes les tables du wiki ; `null` retire le lien.
	 */
	contributeColumn = "article",
	/**
	 * Rendre la première page du fil **côté serveur**.
	 *
	 * `false` par défaut, et ce n'est pas une économie cosmétique : ce bloc vit sur
	 * ~2 000 fiches prérendues (1 300 personnages, 800 épisodes, films, sagas…).
	 * Deux requêtes de plus par fiche, c'est quatre mille requêtes ajoutées à
	 * CHAQUE build — sur une machine dont le build du site a déjà été tué en OOM
	 * une fois (cf. l'en-tête de `/wiki/corriger`). Les discussions d'une fiche
	 * n'ont par ailleurs aucune valeur d'indexation : l'îlot les charge au montage.
	 *
	 * `true` se justifie là où le volume est faible et le contenu éditorial : la
	 * page d'un article (`/news/[slug]`, quelques dizaines de pages).
	 */
	prefetch = false,
	className = "",
}: {
	kind: SocialKind;
	table?: string;
	id: string | number;
	path: string;
	label?: string;
	contributeColumn?: string | null;
	prefetch?: boolean;
	className?: string;
}) {
	// Une cible wiki s'accroche à (table, clé primaire) et jamais au slug : un
	// renommage de fiche ne doit pas effacer sa conversation.
	const targetId = kind === "wiki" && table ? wikiTargetId(table, id) : String(id);
	const target = formatTarget({ kind, id: targetId });

	// Données PUBLIQUES seulement : aucune lecture de session ici (sinon la fiche
	// perdrait son cache CDN). L'état personnel est résolu par les îlots clients.
	const [thread, reactions] = prefetch
		? await Promise.all([
				listComments({ kind, id: targetId }, { page: 1, sort: "recent" }).catch(() => null),
				reactionState({ kind, id: targetId }, null).catch(() => null),
			])
		: [null, null];

	// Le lien de correction est construit ici plutôt que dans chaque fiche : seize
	// gabarits construisaient (ou oubliaient) la même URL à la main. `retour`
	// ramène le contributeur exactement là où il lisait.
	const contributeHref =
		table && contributeColumn && isContributableColumn(contributeColumn)
			? `/wiki/corriger?${new URLSearchParams({
					table,
					row: String(id),
					col: contributeColumn,
					retour: path,
				}).toString()}`
			: null;

	return (
		<section className={`mt-14 border-t-2 border-white/12 pt-8 ${className}`} id="participer">
			<div className="flex flex-wrap items-center gap-4">
				<LikeButton
					target={target}
					initialLikes={reactions?.likes}
					callbackURL={path}
					label={label ? `J'aime ${label}` : "J'aime cette fiche"}
				/>
				{contributeHref && (
					<Link
						href={contributeHref}
						className="toriyama-btn-secondary !text-[0.75rem]"
						title="Proposer une correction relue par la modération"
					>
						Proposer une correction
					</Link>
				)}
				<p className="text-[0.8125rem] text-white/45">
					{/* Sans préchargement, le compteur est celui du fil lui-même, affiché
					    dans son propre en-tête : en annoncer un autre ici risquerait de
					    le contredire. */}
					{thread
						? thread.total > 0
							? `${thread.total} message${thread.total > 1 ? "s" : ""}`
							: "Ouvre la discussion sur cette fiche"
						: "Une question, une incohérence ? La discussion est juste en dessous."}
				</p>
			</div>

			<CommentThread
				className="mt-10"
				target={target}
				initial={thread ?? undefined}
				callbackURL={path}
				title="Discussion"
			/>
		</section>
	);
}
