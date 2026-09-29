import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageShell } from "@/components/kit";
import { externalSourceUrlFromId, readExternalSource } from "@/lib/external-source-catalog";
import { ogMeta } from "@/lib/og";
import { markdownToPlainText } from "@/lib/markdown-plain";

export const revalidate = 300;

const KIND_LABEL: Record<string, string> = {
	publisher: "Éditeur",
	reference: "Référence",
	archive: "Archive",
	wayback: "Archive web",
	encyclopedia: "Encyclopédie",
	statistics: "Statistiques",
	media: "Média",
};

function hostOf(url: string): string {
	return new URL(url).hostname.replace(/^www\./, "");
}

function formatFetchedAt(value: Date): string {
	return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(value);
}

async function sourceFromId(sourceId: string) {
	const url = externalSourceUrlFromId(sourceId);
	return url ? readExternalSource(url) : null;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ sourceId: string }>;
}): Promise<Metadata> {
	const { sourceId } = await params;
	const source = await sourceFromId(sourceId);
	if (!source) return { title: "Source introuvable" };
	const description =
		markdownToPlainText(source.excerpt, { max: 160 }) || `Document attribué à ${hostOf(source.url)}.`;
	return {
		title: `${source.title} — Source Dragon Ball`,
		description,
		...ogMeta({
			title: `${source.title} — DBFR`,
			description,
			canonical: `/sources/dragon-ball/${sourceId}`,
		}),
	};
}

export default async function ExternalSourcePage({
	params,
}: {
	params: Promise<{ sourceId: string }>;
}) {
	const { sourceId } = await params;
	const source = await sourceFromId(sourceId);
	if (!source) notFound();

	const provenance =
		typeof source.provenance.crawlSource === "string" ? source.provenance.crawlSource : null;
	return (
		<PageShell rhythm="loose">
			<Breadcrumbs
				className="mb-8"
				items={[
					{ label: "Sources Dragon Ball", href: "/sources/dragon-ball" },
					{ label: source.title },
				]}
			/>
			<article className="mx-auto max-w-4xl">
				<header className="rounded-2xl border border-dbz-orange/30 bg-[radial-gradient(circle_at_90%_0%,rgba(243,132,24,.18),transparent_35%),rgba(255,255,255,.03)] p-6 sm:p-8">
					<p className="text-xs font-semibold uppercase tracking-[.22em] text-dbz-orange">
						{KIND_LABEL[source.kind] ?? source.kind} · {hostOf(source.url)}
					</p>
					<h1 className="mt-3 font-display text-3xl font-bold leading-tight text-white sm:text-5xl">
						{source.title}
					</h1>
					<div className="mt-5 flex flex-wrap gap-3 text-xs text-white/60">
						<span className="rounded-full border border-white/15 px-3 py-1">
							HTTP {source.httpStatus}
						</span>
						<span className="rounded-full border border-white/15 px-3 py-1">
							Collectée le {formatFetchedAt(source.fetchedAt)}
						</span>
					</div>
					<a
						href={source.url}
						target="_blank"
						rel="noreferrer"
						className="mt-6 inline-flex rounded-lg bg-dbz-orange px-4 py-2 text-sm font-bold text-black transition hover:bg-dbz-yellow"
					>
						Ouvrir la source originale ↗
					</a>
				</header>

				<section className="mt-8 rounded-2xl border border-white/10 bg-white/[.03] p-6">
					<h2 className="font-display text-xl font-bold text-white">Extrait collecté</h2>
					<p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/70">
						{source.excerpt || "Le document ne contient pas d’extrait textuel exploitable."}
					</p>
				</section>

				<section className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-6 text-sm text-white/65">
					<h2 className="font-display text-xl font-bold text-white">Provenance</h2>
					<p className="mt-3 leading-6">
						Cette page présente une copie d’index attribuée. Elle ne remplace pas la source
						originale et ne constitue pas, à elle seule, une décision de canonicité.
					</p>
					{provenance ? (
						<p className="mt-3 break-all font-mono text-xs text-white/40">
							Campagne : {provenance}
						</p>
					) : null}
				</section>
				<Link
					href="/sources/dragon-ball"
					className="mt-8 inline-flex text-sm font-semibold text-dbz-orange hover:text-white"
				>
					← Toutes les sources
				</Link>
			</article>
		</PageShell>
	);
}
