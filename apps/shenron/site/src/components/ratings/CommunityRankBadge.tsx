/**
 * Badge podium (#1 / #2 / #3) — server component.
 * Affiché à côté de la moyenne quand la fiche est dans un Top 3.
 */
import Link from "next/link";
import { getCommunityRankFor } from "@/lib/community-tops-data";
import { rankMedal, type CommunityTopKind } from "@/lib/community-tops";

export async function CommunityRankBadge({
	kind,
	targetId,
	className = "",
}: {
	kind: CommunityTopKind;
	targetId: string | number;
	className?: string;
}) {
	const info = await getCommunityRankFor(kind, targetId);
	if (!info) return null;

	const medal = rankMedal(info.rank);
	const isFirst = info.rank === 1;

	return (
		<Link
			href={info.href}
			title={`${info.boardTitle} — ${medal.label} (${info.average.toFixed(1)}★ · ${info.count} note${info.count > 1 ? "s" : ""})`}
			className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-display font-bold uppercase tracking-wider transition-transform hover:scale-105 ${medal.className} ${
				isFirst ? "shadow-[0_0_16px_rgba(251,191,36,0.25)]" : ""
			} ${className}`}
		>
			<span aria-hidden>{medal.emoji}</span>
			<span>
				{medal.label} {info.boardLabel}
			</span>
			{isFirst && (
				<span className="hidden font-normal normal-case tracking-normal text-amber-200/70 sm:inline">
					communauté
				</span>
			)}
		</Link>
	);
}
