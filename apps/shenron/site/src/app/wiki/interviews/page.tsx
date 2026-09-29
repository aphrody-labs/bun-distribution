import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DomainBar } from "@/components/kit";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { PageHero } from "@/components/PageHero";
import { listToriyamaWords } from "@/lib/toriyama-words";
import { ogMeta } from "@/lib/og";
import { T } from "@/components/T";
import { InterviewsExplorer } from "@/components/wiki/InterviewsExplorer";
import { dbUniverse } from "@/lib/db-universe";
import { GatedLink } from "@/components/GatedLink";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Interviews d'Akira Toriyama — DBFR",
	description: "Entretiens, lettres et introductions d'Akira Toriyama, regroupés sur une page avec leurs sources.",
	...ogMeta({
		title: "Interviews d'Akira Toriyama — DBFR",
		description: "Toutes les prises de parole attribuées à Toriyama, rangées par document et liées à leur source.",
		canonical: "/wiki/interviews",
		type: "website",
	}),
};

export default async function InterviewsPage() {
	const [{ groups, total, translated }, rag] = await Promise.all([
		listToriyamaWords("interviews"),
		dbUniverse.rag("Akira Toriyama interview databook", 5, { lang: "fr", sourceId: "canon_references" }).catch(() => null),
	]);

	return (
		<div>
			<PageHero
				eyebrow={<T k="wiki.interviews.eyebrow" />}
				title={<T k="wiki.interviews.title" />}
				lead={<T k="wiki.interviews.lead" values={{ total: total.toLocaleString("fr-FR"), translated: translated.toLocaleString("fr-FR") }} />}
			/>
			<div className="wiki-container space-y-8">
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Interviews de Toriyama" }]} />
					<WikiDrawer />
				</div>
				<div className="mb-8 rounded-xl border border-dbz-orange/30 bg-dbz-orange/5 p-4 text-sm text-white/75">
					<T k="wiki.interviews.intro" />{" "}<Link className="font-bold text-dbz-orange hover:text-white" href="/wiki/canon"><T k="wiki.interviews.canon" /></Link>
				</div>
				<nav aria-label="Parcours éditorial" className="mb-8 flex flex-wrap gap-2 text-sm">
					<Link className="rounded-lg border border-dbz-orange/40 bg-dbz-orange/10 px-3 py-2 text-dbz-orange" href="/wiki/interviews"><T k="wiki.editorialNav.interviews" /></Link>
					<Link className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/toriyama"><T k="wiki.editorialNav.toriyama" /></Link>
					<GatedLink className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/databooks"><T k="wiki.editorialNav.catalogue" /></GatedLink>
				</nav>
				<InterviewsExplorer groups={groups} ragResults={rag?.results ?? []} />
			</div>
		</div>
	);
}
