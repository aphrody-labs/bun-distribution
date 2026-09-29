import { PageShell } from "@/components/kit";
/**
 * /wiki/contribuer — la page qui transforme « signaler » en « écrire ».
 *
 * Trois choses, dans cet ordre, parce que c'est l'ordre dans lequel on se
 * décide à contribuer :
 *   1. comment ça marche, en trois phrases (et ce qu'on risque : rien) ;
 *   2. **où il manque quelque chose**, mesuré en direct — c'est ce qui donne
 *      envie, pas l'invitation générale ;
 *   3. qui a déjà contribué, parce qu'un travail crédité en appelle d'autres.
 *
 * La règle des sources y est écrite noir sur blanc, sans détour : le wiki se
 * rédige sur le manga et les databooks, et le contenu venu de Fandom est en
 * cours de remplacement, pas de prolongement. Autant que ce soit dit ici plutôt
 * que découvert au moment d'un refus.
 */
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { BouclierCoche, Crayon, Etincelle, Livre } from "@/components/icones";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { MesContributions } from "@/components/wiki/MesContributions";
import { listeChantiers } from "@/lib/wiki-chantiers";
import { topContributors } from "@/lib/wiki-contributions";
import { ogMeta } from "@/lib/og";
import { T } from "@/components/T";

export const revalidate = 600;

export const metadata: Metadata = ogMeta({
	title: "Contribuer au wiki",
	description:
		"Corrigez et complétez le wiki Dragon Ball : chaque fiche s'édite depuis sa page, la proposition est relue puis publiée à votre nom.",
	canonical: "/wiki/contribuer",
	type: "website",
});

const ETAPES = [
	{ icon: Crayon, cle: "edit" },
	{ icon: Livre, cle: "source" },
	{ icon: BouclierCoche, cle: "review" },
];

/** Les 42 tomes du manga : un nombre imprimé, pas un compteur — mais il ne
 *  s'écrit pas dans le dictionnaire, où il deviendrait intraduisible. */
const TOMES_MANGA = 42;

export default async function PageContribuer() {
	const [chantiers, contributeurs] = await Promise.all([
		listeChantiers().catch(() => []),
		topContributors(20).catch(() => []),
	]);

	const totalVides = chantiers.reduce((n, c) => n + c.vides, 0);

	return (
		<PageShell width="narrow" rhythm="loose" wikiDecorative>
			<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
				<Breadcrumbs items={[{ label: "Contribuer", display: <T k="wiki.contribuer.breadcrumb" /> }]} />
				<WikiDrawer />
			</div>

			<PageHeader
				eyebrow={<T k="wiki.contribuer.eyebrow" />}
				title={
					<>
						<T k="wiki.contribuer.titleBefore" />{" "}
						<span className="text-dbz-orange">
							<T k="wiki.contribuer.titleAccent" />
						</span>
					</>
				}
				className="mb-0"
				subtitle={<T k="wiki.contribuer.subtitle" values={{ tomes: TOMES_MANGA }} />}
			/>

			{/* --- Comment ça marche --- */}
			<section className="mt-14">
				<h2 className="font-saiyan text-2xl uppercase text-white">
					<T k="wiki.contribuer.howTitle" />
				</h2>
				<ol className="mt-6 grid gap-4 md:grid-cols-3">
					{ETAPES.map((e, i) => (
						<li
							key={e.cle}
							className="rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-dbz-orange/30"
						>
							<div className="flex items-center gap-2 text-dbz-orange">
								<e.icon className="h-4 w-4" />
								<span className="text-xs font-bold uppercase tracking-widest">
									<T k="wiki.contribuer.step" values={{ number: i + 1 }} />
								</span>
							</div>
							<h3 className="mt-3 text-sm font-bold leading-snug text-white">
								<T k={`wiki.contribuer.steps.${e.cle}Title`} />
							</h3>
							<p className="mt-2 text-xs leading-relaxed text-white/50">
								<T k={`wiki.contribuer.steps.${e.cle}Text`} />
							</p>
						</li>
					))}
				</ol>
			</section>

			{/* --- La règle des sources --- */}
			<section className="mt-14 rounded-xl border border-white/10 bg-white/[0.02] p-6">
				<h2 className="font-saiyan text-2xl uppercase text-white">
					<T k="wiki.contribuer.sourcesTitle" />
				</h2>
				<div className="mt-4 grid gap-6 md:grid-cols-2">
					<div>
						<p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
							<T k="wiki.contribuer.accepted" />
						</p>
						<ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/60">
							<li>
								<strong className="text-white/80">
									<T k="wiki.contribuer.acceptedMangaTerm" />
								</strong>{" "}
								<T k="wiki.contribuer.acceptedMangaText" />
							</li>
							<li>
								<strong className="text-white/80">
									<T k="wiki.contribuer.acceptedDatabooksTerm" />
								</strong>{" "}
								<T k="wiki.contribuer.acceptedDatabooksText" />
							</li>
							<li>
								<strong className="text-white/80">
									<T k="wiki.contribuer.acceptedAnimeTerm" />
								</strong>
								<T k="wiki.contribuer.acceptedAnimeText" />
							</li>
						</ul>
					</div>
					<div>
						<p className="text-xs font-bold uppercase tracking-widest text-dbz-red">
							<T k="wiki.contribuer.refused" />
						</p>
						<ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/60">
							<li>
								<strong className="text-white/80">
									<T k="wiki.contribuer.refusedWikisTerm" />
								</strong>
								<T k="wiki.contribuer.refusedWikisText" />
							</li>
							<li>
								<strong className="text-white/80">
									<T k="wiki.contribuer.refusedGamesTerm" />
								</strong>{" "}
								<T k="wiki.contribuer.refusedGamesText" />
							</li>
							<li>
								<strong className="text-white/80">
									<T k="wiki.contribuer.refusedGuessTerm" />
								</strong>{" "}
								<T k="wiki.contribuer.refusedGuessText" />
							</li>
						</ul>
					</div>
				</div>
			</section>

			{/* --- Où il manque quelque chose --- */}
			<section className="mt-14">
				<h2 className="font-saiyan text-2xl uppercase text-white">
					<T k="wiki.contribuer.gapsTitle" />
				</h2>
				{chantiers.length === 0 ? (
					<p className="mt-4 text-sm text-white/50">
						<T k="wiki.contribuer.gapsNone" />
					</p>
				) : (
					<>
						<p className="mt-2 text-sm text-white/50">
							<T
								k="wiki.contribuer.gapsCount"
								values={{ count: totalVides.toLocaleString("fr-FR") }}
							/>
						</p>
						<div className="mt-6 space-y-4">
							{chantiers.map((c) => (
								<div
									key={c.table}
									className="rounded-xl border border-white/10 bg-white/[0.02] p-5"
								>
									<div className="flex flex-wrap items-baseline justify-between gap-2">
										<h3 className="text-sm font-bold text-white">{c.rubrique}</h3>
										<p className="text-xs text-white/45">
											<span className="font-bold text-dbz-orange">{c.vides}</span>{" "}
											<T k="wiki.contribuer.gapsToWrite" /> {c.total}
										</p>
									</div>
									<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/8">
										<div
											className="h-full rounded-full bg-dbz-orange/70"
											style={{
												width: `${Math.round(((c.total - c.vides) / Math.max(c.total, 1)) * 100)}%`,
											}}
										/>
									</div>
									{c.exemples.length > 0 ? (
										<ul className="mt-3 flex flex-wrap gap-2">
											{c.exemples.map((e) => (
												<li key={e.href}>
													<Link
														href={e.href}
														className="inline-block rounded-full border border-white/12 px-3 py-1 text-xs text-white/60 transition-colors hover:border-dbz-orange/50 hover:text-white"
													>
														{e.label}
													</Link>
												</li>
											))}
										</ul>
									) : null}
								</div>
							))}
						</div>
					</>
				)}
			</section>

			{/* --- Les contributeurs --- */}
			<section className="mt-14">
				<h2 className="flex items-center gap-2 font-saiyan text-2xl uppercase text-white">
					<Etincelle className="h-5 w-5 text-dbz-orange" />{" "}
					<T k="wiki.contribuer.contributorsTitle" />
				</h2>
				{contributeurs.length === 0 ? (
					<p className="mt-4 text-sm leading-relaxed text-white/50">
						<T k="wiki.contribuer.contributorsNone" />
					</p>
				) : (
					<ol className="mt-6 grid gap-2 sm:grid-cols-2">
						{contributeurs.map((c, i) => (
							<li
								key={c.authorId}
								className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-4 py-2.5"
							>
								<span className="flex min-w-0 items-center gap-3">
									<span className="w-5 shrink-0 text-right text-xs font-bold text-white/30">
										{i + 1}
									</span>
									<span className="truncate text-sm text-white/80">{c.authorName}</span>
								</span>
								<span className="shrink-0 text-xs text-white/45">
									<T
										k={
											c.accepted > 1
												? "wiki.contribuer.contributionMany"
												: "wiki.contribuer.contributionOne"
										}
										values={{ count: c.accepted }}
									/>
								</span>
							</li>
						))}
					</ol>
				)}
			</section>

			<MesContributions />

			{/* --- Les autres façons de participer ---
			    La page ne présentait qu'un seul geste (corriger un champ), alors que
			    deux autres existent désormais et n'avaient aucune porte d'entrée. */}
			<section className="mt-14">
				<h2 className="flex items-center gap-2 font-saiyan text-2xl uppercase text-white">
					<Etincelle className="h-5 w-5 text-dbz-orange" />{" "}
					<T k="wiki.contribuer.participateTitle" />
				</h2>
				<div className="mt-6 grid gap-4 sm:grid-cols-3">
					{[
						{ href: "/wiki/personnages", cle: "waysFix" },
						{ href: "/news/fil/discussions", cle: "waysTalk" },
						{ href: "/wiki/databooks", cle: "waysTranscribe" },
					].map((c) => (
						<Link
							key={c.href}
							href={c.href}
							className="group flex flex-col border border-white/[0.08] bg-dbz-card/80 p-4 transition-transform hover:-translate-y-0.5 hover:border-dbz-orange"
						>
							<span className="font-display text-[15px] font-bold text-white group-hover:text-dbz-orange">
								<T k={`wiki.contribuer.${c.cle}Title`} />
							</span>
							<span className="mt-1.5 text-[13px] leading-relaxed text-white/55">
								<T k={`wiki.contribuer.${c.cle}Text`} />
							</span>
						</Link>
					))}
				</div>
			</section>

			<p className="mt-14 border-t border-white/8 pt-6 text-xs leading-relaxed text-white/40">
				<T k="wiki.contribuer.footnote" />
			</p>
		</PageShell>
	);
}
