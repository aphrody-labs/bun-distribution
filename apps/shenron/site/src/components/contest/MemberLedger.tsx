/**
 * Registre public des contributions d'un membre : chaque note déposée, la fiche
 * visée, le score, l'avis rédigé et l'horodatage. Rendu côté serveur, partagé
 * entre le profil public (`/profil/[id]`) et l'arbitrage du concours
 * (`/admin/concours`).
 *
 * `showSignals` n'est vrai que côté admin : les indices de triche sont des
 * mesures brutes, pas un verdict, et les afficher publiquement équivaudrait à
 * accuser un membre sur la page que tout le monde lit.
 */
import Link from "next/link";
import { T } from "@/components/T";
import type { CheatSignal, MemberContributions } from "@/lib/contributors";

const dateFmt = (iso: string) =>
	new Date(iso).toLocaleString("fr-FR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

const TARGET_KEY: Record<string, string> = {
	episode: "profile.target.episode",
	movie: "profile.target.movie",
	game: "profile.target.game",
	arc: "profile.target.arc",
};

const SIGNAL_TONE: Record<CheatSignal["level"], string> = {
	info: "border-white/15 bg-white/5 text-white/65",
	warn: "border-amber-400/50 bg-amber-400/10 text-amber-200",
	alert: "border-red-500/60 bg-red-500/10 text-red-200",
};

const KIND_LABEL: Record<string, string> = {
	post: "Article",
	wiki: "Fiche wiki",
	databook: "Databook",
	tierlist: "Tier list",
	comment: "Réponse",
};

function Stars({ score }: { score: number }) {
	return (
		<span className="font-mono text-sm font-bold text-dbz-orange" aria-label={`${score} sur 5`}>
			{score}/5
		</span>
	);
}

export function CheatSignals({ signals }: { signals: CheatSignal[] }) {
	if (signals.length === 0) {
		return (
			<p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
				Aucun signal automatique sur cette activité.
			</p>
		);
	}
	return (
		<ul className="grid gap-2 sm:grid-cols-2">
			{signals.map((s) => (
				<li key={s.code} className={`rounded-xl border p-3 text-sm ${SIGNAL_TONE[s.level]}`}>
					<p className="font-semibold">{s.label}</p>
					<p className="mt-0.5 text-xs opacity-80">{s.detail}</p>
				</li>
			))}
		</ul>
	);
}

export function MemberLedger({
	data,
	showSignals = false,
}: {
	data: MemberContributions;
	showSignals?: boolean;
}) {
	const { counts, ratings, comments } = data;
	return (
		<section
			aria-labelledby="ledger-title"
			className="mt-8 rounded-3xl border border-white/10 bg-[#141311] p-5 md:p-7"
		>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 id="ledger-title" className="font-saiyan text-3xl text-dbz-orange">
						<T k="profile.ledgerTitle" />
					</h2>
					<p className="mt-1 max-w-2xl text-sm text-white/45">
						<T k="profile.ledgerLead" />
					</p>
				</div>
				<p className="font-mono text-sm text-white/55">
					{counts.ratings} ★ · {counts.ratingComments} <T k="profile.ledgerWritten" /> ·{" "}
					<T k="profile.ledgerAverage" /> {counts.averageScore}/5
				</p>
			</div>

			{showSignals && (
				<div className="mt-5">
					<h3 className="mb-2 text-sm font-semibold text-white/75">
						Contrôle d&apos;intégrité (staff)
					</h3>
					<CheatSignals signals={data.signals} />
				</div>
			)}

			{ratings.length === 0 ? (
				<p className="mt-6 text-sm text-white/45">
					<T k="profile.ledgerEmpty" />
				</p>
			) : (
				<div className="mt-6 overflow-x-auto">
					<table className="w-full min-w-[38rem] border-collapse text-sm">
						<thead>
							<tr className="border-b border-white/10 text-left text-xs uppercase tracking-widest text-white/40">
								<th className="py-2 pr-3 font-semibold">
									<T k="profile.ledgerColTarget" />
								</th>
								<th className="py-2 pr-3 font-semibold">
									<T k="profile.ledgerColScore" />
								</th>
								<th className="py-2 pr-3 font-semibold">
									<T k="profile.ledgerColComment" />
								</th>
								<th className="py-2 font-semibold">
									<T k="profile.ledgerColDate" />
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-white/5">
							{ratings.map((r) => (
								<tr key={r.id} className="align-top">
									<td className="py-2.5 pr-3">
										<span className="mr-2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/50">
											<T k={TARGET_KEY[r.targetType] ?? "profile.target.other"} />
										</span>
										{r.href ? (
											<Link href={r.href} className="font-medium text-white/85 hover:text-dbz-orange">
												{r.title ?? `#${r.targetId}`}
											</Link>
										) : (
											<span className="text-white/50">{r.title ?? `#${r.targetId}`}</span>
										)}
									</td>
									<td className="py-2.5 pr-3 whitespace-nowrap">
										<Stars score={r.score} />
									</td>
									<td className="max-w-[24rem] py-2.5 pr-3 text-white/65">
										{(r.comment ?? "").trim() || <span className="text-white/25">—</span>}
									</td>
									<td className="py-2.5 whitespace-nowrap text-xs text-white/40">
										{dateFmt(r.updatedAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{data.truncated && (
						<p className="mt-3 text-xs text-white/40">
							<T k="profile.ledgerTruncated" />
						</p>
					)}
				</div>
			)}

			{comments.length > 0 && (
				<div className="mt-8">
					<h3 className="text-sm font-semibold text-white/75">
						<T k="profile.ledgerCommentsTitle" />
					</h3>
					<ul className="mt-3 divide-y divide-white/5">
						{comments.map((c) => (
							<li key={c.id} className="py-2.5">
								<div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
									<span className="rounded border border-white/15 px-1.5 py-0.5 uppercase tracking-wider">
										{KIND_LABEL[c.kind] ?? c.kind}
									</span>
									<span>{dateFmt(c.createdAt)}</span>
									{c.isReply && <span className="text-white/30">↳ réponse</span>}
									{c.status !== "visible" && (
										<span className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-300">
											{c.status}
										</span>
									)}
								</div>
								<p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/75">
									{c.body}
								</p>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
