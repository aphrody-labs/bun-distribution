/**
 * Assemble les sections de contenu d'une entité wiki en un sélecteur de
 * catégories (`WikiSectionsReader`). Combine, dans l'ordre :
 *   1. `leading`  — panneaux « intégrés » de tête (ex. Histoire tirée de l'article) ;
 *   2. les sections éditoriales DB (`bot.db_wiki_sections`, visibles, triées) ;
 *   3. `trailing` — panneaux « intégrés » de queue (ex. Transformations, Techniques).
 *
 * Server Component : lit la DB (`getWikiSections`, server-only) et rend chaque
 * section via `WikiArticle` (même chrome que la biographie). Si aucun panneau →
 * ne rend rien (aucun changement visuel sur les pages sans section).
 */
import { getWikiSections } from "@/lib/shenron";
import { normalizeWikiSectionGroups } from "@/lib/wiki-section-groups";
import { WikiArticle } from "@/components/wiki/WikiArticle";
import { WikiSectionLinks } from "@/components/wiki/WikiSectionLinks";
import { WikiSectionsReader, type ReaderPanel } from "@/components/wiki/WikiSectionsReader";
import Link from "next/link";
import { Crayon } from "@/components/icones";

export async function WikiEntitySections({
	entityType,
	entityId,
	leading = [],
	trailing = [],
}: {
	entityType: string;
	entityId: number;
	leading?: ReaderPanel[];
	trailing?: ReaderPanel[];
}) {
	const sections = await getWikiSections(entityType, entityId);

	const normalized = normalizeWikiSectionGroups(
		sections.map((s) => ({
			label: s.label,
			group: s.groupLabel,
			section: s,
		}))
	);

	const sectionPanels: ReaderPanel[] = normalized.map(({ section: s, label, group }) => ({
		key: `sec-${s.id}`,
		label,
		accent: s.accent,
		group,
		node: (
			<div className="space-y-2">
				{s.body.trim() ? (
					<WikiArticle article={s.body} heading={label} accent={s.accent ?? "orange"} />
				) : (
					<h2 className="font-saiyan text-2xl text-white">{label}</h2>
				)}
				<WikiSectionLinks links={s.links} />
				{/* Le contenu long du wiki vit ici, pas dans la fiche : sans point
				    d'entrée par section, « corriger le wiki » resterait théorique.
				    Un LIEN, pas une modale — un îlot client par section coûtait le
				    build (mort en OOM à la compilation). */}
				<div className="pt-2">
					<Link
						href={`/wiki/corriger?table=db_wiki_sections&row=${s.id}&col=body`}
						className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/30 transition-colors hover:text-dbz-orange"
					>
						<Crayon className="h-3 w-3" /> Corriger cette partie
					</Link>
				</div>
			</div>
		),
	}));

	const panels = [...leading, ...sectionPanels, ...trailing];
	if (panels.length === 0) return null;

	return <WikiSectionsReader panels={panels} />;
}
