/**
 * FeedStream — le rendu du fil d'actualité unifié.
 *
 * Quatre natures d'événements cohabitent (article, modification du wiki,
 * contribution acceptée, discussion) et elles n'ont ni le même poids ni la même
 * forme : un article mérite sa vignette et son chapô, une révision de fiche tient
 * en une ligne. Les afficher toutes avec la même carte donnerait un mur plat où
 * l'éditorial se noie ; leur donner quatre mises en page étrangères casserait la
 * lecture. Compromis tenu ici : **une seule colonne, une seule grammaire
 * visuelle** (badge de nature + titre + acteur + date), et seul l'article gagne
 * une vignette et un chapô.
 *
 * Server component : aucune interaction, donc aucun JavaScript envoyé.
 */
import Image from "next/image";
import Link from "next/link";
import { Chip, ChipRow, SocialCounts } from "@/components/kit";
import type { FeedEntry, FeedKind } from "@/lib/feed";

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});

/** Date courte relative pour l'immédiat, absolue au-delà — lisible dans un fil. */
function when(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const minutes = Math.round((Date.now() - d.getTime()) / 60_000);
	if (minutes < 1) return "à l'instant";
	if (minutes < 60) return `il y a ${minutes} min`;
	if (minutes < 60 * 24) return `il y a ${Math.round(minutes / 60)} h`;
	return dateFormat.format(d);
}

/** Couleur du liseré gauche par nature — le repère qu'on attrape en défilant. */
const KIND_ACCENT: Record<FeedKind, string> = {
	article: "border-l-dbz-orange",
	wiki: "border-l-[color:var(--color-toriyama-capsule,#00bcd4)]",
	contribution: "border-l-[color:var(--color-toriyama-shenron,#1b7340)]",
	discussion: "border-l-white/30",
};

export function FeedStream({ entries }: { entries: readonly FeedEntry[] }) {
	return (
		<ol className="space-y-4">
			{entries.map((entry) => (
				<li key={entry.id}>
					<FeedRow entry={entry} />
				</li>
			))}
		</ol>
	);
}

function FeedRow({ entry }: { entry: FeedEntry }) {
	const isArticle = entry.kind === "article";
	const Title = entry.href ? (
		<Link href={entry.href} className="transition-colors hover:text-dbz-orange">
			{entry.title}
		</Link>
	) : (
		<>{entry.title}</>
	);

	return (
		<article
			className={`flex gap-4 rounded-xl border border-white/[0.08] border-l-[3px] bg-dbz-card/80 p-4 transition-colors hover:border-dbz-orange/40 sm:gap-5 sm:p-5 ${KIND_ACCENT[entry.kind]}`}
		>
			{/* La vignette n'apparaît que pour l'éditorial : une révision de fiche n'a
			    pas d'image propre, et en inventer une serait décoratif. */}
			{isArticle && entry.image && (
				<Link
					href={entry.href ?? "#"}
					tabIndex={-1}
					aria-hidden
					className="relative hidden w-[160px] shrink-0 overflow-hidden rounded-lg border border-white/[0.08] sm:block"
				>
					<Image
						src={entry.image}
						alt=""
						width={160}
						height={100}
						sizes="160px"
						className="h-full w-full object-cover"
					/>
				</Link>
			)}

			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-[0.625rem] font-bold uppercase tracking-[0.12em]">
					<span className="text-dbz-orange">{entry.badge}</span>
					{entry.actor && <span className="text-white/45">{entry.actor}</span>}
					<time dateTime={entry.at} className="text-white/35">
						{when(entry.at)}
					</time>
					{entry.readingMinutes !== null && (
						<span className="text-white/35">{entry.readingMinutes} min</span>
					)}
				</p>

				<h3
					className={`mt-1.5 font-display font-bold leading-[1.22] tracking-[-0.012em] text-white ${
						isArticle ? "text-[1.0625rem] sm:text-[1.25rem]" : "text-[0.9375rem] sm:text-[1.0625rem]"
					}`}
				>
					{Title}
				</h3>

				{entry.summary && (
					<p className="mt-1.5 line-clamp-2 text-[0.875rem] leading-relaxed text-white/60">
						{entry.summary}
					</p>
				)}

				{(entry.fields.length > 0 || entry.tags.length > 0) && (
					<ChipRow className="mt-2.5">
						{entry.fields.map((f) => (
							<Chip key={f} tone="quiet">
								{f}
							</Chip>
						))}
						{entry.tags.slice(0, 3).map((t) => (
							<Chip key={t} tone="neutral" href={`/news/theme/${encodeURIComponent(t.toLowerCase())}`}>
								{t}
							</Chip>
						))}
					</ChipRow>
				)}

				{/* Glyphes du jeu maison, pas d'emoji : DESIGN.md les exclut de
				    l'interface, et « 💬 » se dessine différemment par système. */}
				<SocialCounts className="mt-2.5" likes={entry.likes} comments={entry.comments} />
			</div>
		</article>
	);
}
