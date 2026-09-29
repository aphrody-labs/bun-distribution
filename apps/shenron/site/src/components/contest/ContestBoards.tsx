/**
 * Tableaux du concours communautaire : « plus grand nombre de notes » et
 * « plus grand nombre de Zénis ». Composant de présentation pur — les deux
 * jeux de données sont chargés par la page (`/classements`) pour qu'un échec
 * de l'API du bot ne prive pas le site du classement des noteurs.
 */
import Link from "next/link";
import type { ContributorRow } from "@/lib/contributors";
import type { LeaderboardEntry } from "@/lib/shenron";
import { formatZeni } from "@/lib/zeni";
import { Avatar } from "@/components/Avatar";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const RANK_TONE = [
	"text-amber-300",
	"text-slate-200",
	"text-orange-400",
	"text-white/45",
] as const;
const rankTone = (rank: number) => RANK_TONE[Math.min(rank, 4) - 1];

function Panel({
	id,
	kanji,
	eyebrow,
	title,
	subtitle,
	children,
}: {
	id: string;
	kanji: string;
	eyebrow: string;
	title: string;
	subtitle: string;
	children: React.ReactNode;
}) {
	return (
		<section
			id={id}
			className="toriyama-card scroll-mt-24 overflow-hidden rounded-2xl border-2 border-black bg-black/40 p-4 shadow-[6px_6px_0px_#000] sm:p-6"
		>
			<div className="border-b border-white/10 pb-4">
				<span className="rounded border border-black bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400 shadow-[1px_1px_0px_#000]">
					{eyebrow}
				</span>
				<h3 className="mt-2 flex items-center gap-2.5 font-saiyan text-xl uppercase leading-none text-white sm:text-2xl">
					<span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-amber-400 font-saiyan text-sm font-bold text-black shadow-[2px_2px_0px_#000]">
						{kanji}
					</span>
					{title}
				</h3>
				<p className="mt-1.5 text-sm text-white/60">{subtitle}</p>
			</div>
			{children}
		</section>
	);
}

/** Classement des membres qui ont déposé le plus de notes. */
export function TopRatersBoard({ rows }: { rows: ContributorRow[] }) {
	return (
		<Panel
			id="noteurs"
			kanji="評"
			eyebrow="Concours notes"
			title="Top noteurs du site"
			subtitle="Notes déposées sur les fiches épisodes, films, jeux et arcs. Départage aux avis rédigés."
		>
			{rows.length === 0 ? (
				<p className="py-8 text-center font-saiyan text-lg uppercase text-amber-400">
					Aucune note enregistrée pour l&apos;instant — sois le premier.
				</p>
			) : (
				<ul className="mt-4 divide-y divide-white/5">
					{rows.map((r) => (
						<li key={r.userId} className="flex items-center gap-3 py-2.5">
							<span className={`w-10 shrink-0 font-saiyan text-lg ${rankTone(r.rank)}`}>
								#{r.rank}
							</span>
							<Avatar
								src={r.avatar}
								userId={r.discordId}
								size={32}
								className="border border-dbz-border bg-black/60"
							/>
							<Link
								href={`/profil/${r.discordId}`}
								className="min-w-0 flex-1 truncate text-sm font-semibold text-white/85 transition-colors hover:text-amber-300"
							>
								{r.username}
							</Link>
							<span className="hidden shrink-0 text-right text-xs text-white/45 sm:block">
								{fmt(r.ratingComments)} avis · {fmt(r.comments)} comm.
							</span>
							<span className="w-20 shrink-0 text-right font-mono text-sm font-bold text-amber-300">
								{fmt(r.ratings)} ★
							</span>
						</li>
					))}
				</ul>
			)}
		</Panel>
	);
}

/** Classement des plus grosses fortunes en Zénis (économie du bot). */
export function TopZeniBoard({ rows }: { rows: LeaderboardEntry[] }) {
	return (
		<Panel
			id="zeni"
			kanji="銭"
			eyebrow="Économie DBFR"
			title="Top fortunes en Zénis"
			subtitle="Les plus riches du serveur Discord. Les Zénis se gagnent en activité, jeux et boutique."
		>
			{rows.length === 0 ? (
				<p className="py-8 text-center font-saiyan text-lg uppercase text-amber-400">
					Le coffre est vide : le bot n&apos;a rien renvoyé.
				</p>
			) : (
				<ul className="mt-4 divide-y divide-white/5">
					{rows.map((e, i) => (
						<li key={e.discordId} className="flex items-center gap-3 py-2.5">
							<span className={`w-10 shrink-0 font-saiyan text-lg ${rankTone(e.rank || i + 1)}`}>
								#{e.rank || i + 1}
							</span>
							<Avatar
								src={e.avatarUrl}
								userId={e.discordId}
								size={32}
								className="border border-dbz-border bg-black/60"
							/>
							<Link
								href={`/profil/${e.discordId}`}
								className="min-w-0 flex-1 truncate text-sm font-semibold text-white/85 transition-colors hover:text-amber-300"
							>
								{e.username ?? `Guerrier #${e.discordId.slice(-4)}`}
							</Link>
							<span className="hidden shrink-0 text-right text-xs text-white/45 sm:block">
								Niv. {e.level}
							</span>
							<span className="w-24 shrink-0 text-right font-mono text-sm font-bold text-amber-300">
								{formatZeni(e.zeni)}
							</span>
						</li>
					))}
				</ul>
			)}
		</Panel>
	);
}
