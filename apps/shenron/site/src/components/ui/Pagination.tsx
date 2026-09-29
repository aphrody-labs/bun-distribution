"use client";

/**
 * Pagination — façade du site sur `@shenron/ui/pagination`.
 *
 * Le composant (fenêtre de numéros, URL `?p=`, garde `prefers-reduced-motion`,
 * cibles de 44 px, reprise du focus) vit dans le paquet, libellés en props. Ce
 * wrapper garde l'API historique (`unite`) et fournit les libellés depuis le
 * dictionnaire du site (`pagination.*`, même source que `useT`) ; une clé
 * absente retombe sur le texte français par défaut du paquet, sans avertissement.
 * La locale numérique reste `fr-FR`, comme avant le déplacement.
 */
import { lookup } from "@/components/T";
import { useLangue } from "@/lib/i18n/client";
import {
	DEFAULT_PAGINATION_LABELS,
	Pagination as PaginationBase,
	type PaginationLabels,
} from "@shenron/ui/pagination";
import { pagesVisibles } from "@shenron/ui/lib/page-window";

/** Numéros à afficher, `null` = ellipse (`pageWindow` de `@shenron/ui`). */
export { pagesVisibles };

const CLES = ["previous", "next", "range"] as const satisfies ReadonlyArray<keyof PaginationLabels>;

export function Pagination({
	page,
	parPage,
	total,
	onPageChange,
	/** Paramètre d'URL synchronisé. `null` = ne rien écrire dans l'URL. */
	urlParam = "p",
	/** Nom des éléments comptés, pour le libellé (« 121–240 sur 1 307 fiches »). */
	unite,
	className = "",
}: {
	page: number;
	parPage: number;
	total: number;
	onPageChange: (page: number) => void;
	urlParam?: string | null;
	unite?: string;
	className?: string;
}) {
	const { dico } = useLangue();
	const labels: PaginationLabels = { ...DEFAULT_PAGINATION_LABELS };
	for (const cle of CLES) labels[cle] = lookup(dico, `pagination.${cle}`) || labels[cle];
	labels.unit = unite ?? (lookup(dico, "pagination.unit") || labels.unit);

	return (
		<PaginationBase
			page={page}
			parPage={parPage}
			total={total}
			onPageChange={onPageChange}
			urlParam={urlParam}
			locale="fr-FR"
			labels={labels}
			className={className}
		/>
	);
}
