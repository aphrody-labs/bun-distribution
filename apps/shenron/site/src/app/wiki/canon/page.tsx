import { DomainBar, PageShell } from "@/components/kit";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { assetUrl } from "@/lib/assets";

import { canonPreuves, type PlanchePreuve } from "@/lib/canon-preuves";
import { chercherPlanches, type ResultatPlanche } from "@/lib/manga-api";
import { chercherScenes, type SceneTrouvee } from "@/lib/frames-map";
import { unstable_cache } from "next/cache";
import { ogMeta } from "@/lib/og";
import { DragonRadarSearch } from "@/components/wiki/DragonRadarSearch";

/**
 * La page est dynamique (la question vit dans l'URL) : sans cache, chaque vue
 * rejouerait les deux recherches de trigrammes. Dix minutes suffisent — les
 * transcriptions et les synopsis ne bougent pas à l'échelle d'une lecture.
 */
const planchesEnCache = unstable_cache(
	(q: string) => chercherPlanches(q, 6),
	["canon-planches-manga"],
	{ revalidate: 600 }
);
const scenesEnCache = unstable_cache((q: string) => chercherScenes(q, 6), ["canon-scenes"], {
	revalidate: 600,
});
import { getCanonConfig } from "@/lib/canon-config";
import type { CanonConfig, CanonReference } from "@/lib/canon-engine";
import { T } from "@/components/T";

// Rendu à la demande, toujours : la page lit `?q=` (API dynamique) ET la
// doctrine en base, qui s'édite dans /admin/ia?tab=canon. Un prérendu figerait la
// doctrine à l'heure du build et servirait une page périmée après chaque
// enregistrement de l'éditeur. `force-dynamic` ne fait donc que rendre
// explicite ce que `await searchParams` impose déjà.
export const dynamic = "force-dynamic";

export const revalidate = 3600;

export async function generateMetadata({
	searchParams,
}: {
	searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
	const q = (await searchParams).q?.trim() ?? "";
	if (!q) {
		return {
			title: "Dragon Radar — Recherche Globale & Canonicité Dragon Ball",
			description:
				"Le Dragon Radar centralise la recherche de tout le site : épisodes, chapitres, informations canoniques et fiches de lore de l'univers Dragon Ball.",
			...ogMeta({
				title: "Dragon Radar — Recherche Globale & Canonicité DBFR",
				description:
					"Interface interactive Dragon Radar : recherchez épisodes, tomes, chapitres et interrogez l'arbitre officiel de canonicité.",
				canonical: "/wiki/canon",
			}),
		};
	}
	return {
		title: `${q} — Dragon Radar & Arbitre Canon`,
		description: `Verdict officiel pour « ${q} » : rang de canonicité, preuves manga et citations d'Akira Toriyama.`,
		...ogMeta({
			title: `${q} — Dragon Radar & Arbitre Canon`,
			description: `Verdict officiel pour « ${q} » : rang de canonicité, preuves manga et citations d'Akira Toriyama.`,
			canonical: `/wiki/canon?q=${encodeURIComponent(q)}`,
		}),
	};
}

export default async function CanonPage({
	searchParams,
}: {
	searchParams: Promise<{ q?: string }>;
}) {
	const q = (await searchParams).q?.trim() ?? "";
	const config = await getCanonConfig();

	return (
		<PageShell width="narrow" rhythm="loose" wikiDecorative>
			<div className="flex flex-wrap items-center justify-between gap-4 mb-6">
				<DomainBar domain="canon" />
				<WikiDrawer />
			</div>
			<header className="mb-8 space-y-3">
				<p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
					Dragon Radar · Recherche Globale &amp; Canonicité
				</p>
				<h1 className="font-saiyan text-4xl sm:text-5xl text-white tracking-wide">
					Le Dragon Radar
				</h1>
				<p className="text-sm sm:text-base leading-relaxed text-white/80 max-w-2xl">
					Interface de détection et d&apos;arbitrage officielle : recherchez simultanément les épisodes d&apos;animés, chapitres du manga, informations canoniques et fiches encyclopédiques de l&apos;univers Dragon Ball.
				</p>
			</header>

			<DragonRadarSearch initialQuery={q} />
			{config.intro && (
				<p id="canon-intro" className="mt-4 text-sm leading-relaxed text-white/75">
					{config.intro}
				</p>
			)}
			<p className="mt-3 text-xs sm:text-sm text-white/70">
				<Link
					href="/wiki/toriyama"
					className="text-dbz-orange font-medium underline-offset-4 hover:underline"
				>
					<T k="wiki.canon.readToriyama" />
				</Link>{" "}
				<T k="wiki.canon.readToriyamaAfter" />
			</p>
			<div className="mt-5 flex flex-wrap items-center gap-2">
				<span className="text-xs font-bold uppercase tracking-[0.1em] text-white/70">
					<T k="wiki.canon.examples" />
				</span>
				{[
					"Broly",
					"Gogeta",
					"Vegetto",
					"Super Saiyan 4",
					"Dragon Ball GT",
					"Bardock",
					"Dragon Ball Daima",
					"Gine",
					"Uub",
					"C-16",
				].map((ex) => (
					<Link
						key={ex}
						href={`/wiki/canon?q=${encodeURIComponent(ex)}`}
						className="rounded-full border border-white/20 bg-white/[0.05] px-3.5 py-1 text-xs text-white/90 transition-colors hover:border-dbz-gold hover:text-white"
					>
						{ex}
					</Link>
				))}
			</div>
			{q ? (
				<>
					{/* Région live STABLE : elle est rendue par la coquille de la page,
					    hors frontière `<Suspense>`, donc elle existe déjà dans le DOM
					    quand le verdict arrive en streaming. C'est la condition pour
					    qu'un lecteur d'écran l'annonce — une région insérée après coup
					    ne l'est pas de façon fiable. Seul son TEXTE change. */}
					<div className="sr-only" role="status" aria-live="polite">
						<Suspense key={q} fallback={<T k="wiki.canon.searching" />}>
							<AnnonceVerdict question={q} />
						</Suspense>
					</div>
					<Suspense key={q} fallback={<Chargement />}>
						<Resultat question={q} />
					</Suspense>
				</>
			) : (
				<Doctrine config={config} />
			)}
		</PageShell>
	);
}

/**
 * Le résumé annoncé aux lecteurs d'écran, en une phrase.
 *
 * Il ne refait aucun travail : `canonPreuves` est mémoïsé par requête (React
 * `cache`), donc cette frontière et celle du résultat partagent la MÊME
 * promesse — une seule analyse, une seule interrogation du corpus.
 */
async function AnnonceVerdict({ question }: { question: string }) {
	const { verdict, planches, fiches } = await canonPreuves(question);
	const preuves = planches.length + fiches.length;
	return (
		<>
			{verdict.nature === "verdict" ? (
				<T
					k="wiki.canon.announceScored"
					values={{ tier: verdict.tierLabel, score: verdict.score, phrase: verdict.verdict }}
				/>
			) : (
				<T
					k="wiki.canon.announce"
					values={{ tier: verdict.tierLabel, phrase: verdict.verdict }}
				/>
			)}{" "}
			{preuves === 0 ? (
				<T k="wiki.canon.evidenceNone" />
			) : (
				<T
					k={preuves > 1 ? "wiki.canon.evidenceMany" : "wiki.canon.evidenceOne"}
					values={{ count: preuves }}
				/>
			)}
		</>
	);
}

/**
 * La doctrine, en clair, tant qu'aucune question n'est posée.
 *
 * La page promet un verdict qui ne vient ni d'un modèle ni d'un wiki de fans.
 * Une promesse ne vaut que si le lecteur peut lire la règle : les rangs
 * de canonicité avec leur définition, les sources admises et celles qu'on refuse. Tout vient
 * de `/admin/ia?tab=canon` — changer la doctrine change cette page.
 */
function Doctrine({ config }: { config: CanonConfig }) {
	return (
		<div className="mt-14 space-y-12">
			{/* Note : Les sujets tranchés sont masqués de l'affichage public direct et exploités en coulisses comme guardrails de vérité terrain pour l'IA Shenron. */}

			<section>
				<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
					<T k="wiki.canon.tiers" />
				</h2>
				<dl className="mt-5 space-y-5">
					{config.tiers.map((rang) => (
						<div key={rang.id} className="border-l-2 pl-4" style={{ borderColor: rang.couleur }}>
							<dt className="flex items-baseline justify-between gap-3">
								<span
									className="font-display text-sm font-bold uppercase tracking-[0.1em]"
									style={{ color: rang.couleur }}
								>
									{rang.court}
								</span>
								<span className="font-scouter text-xs tabular-nums text-white/70">
									{rang.score} / 100
								</span>
							</dt>
							<dd className="mt-1.5 text-sm leading-relaxed text-white/80">
								{rang.definition}
							</dd>
							{rang.inclut.length > 0 && (
								<dd className="mt-2.5 flex flex-wrap gap-1.5">
									{rang.inclut.map((oeuvre) => (
										<span
											key={oeuvre}
											className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-0.5 text-xs text-white/80"
										>
											{oeuvre}
										</span>
									))}
								</dd>
							)}
						</div>
					))}
				</dl>
			</section>

			{config.doctrine.length > 0 && (
				<section>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
						<T k="wiki.canon.rules" />
					</h2>
					<ol className="mt-5 space-y-2.5">
						{config.doctrine.map((regle, i) => (
							<li key={regle} className="flex gap-3 text-sm sm:text-base leading-relaxed text-white/85">
								<span className="font-scouter shrink-0 tabular-nums text-white/60 font-bold">
									{String(i + 1).padStart(2, "0")}
								</span>
								<span>{regle}</span>
							</li>
						))}
					</ol>
				</section>
			)}

			{/* The multipliers come from the edited doctrine */}
			{config.powerScaling?.enabled && config.powerScaling.multipliers.length > 0 && (
				<section>
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
							<T k="wiki.canon.multipliers" />
						</h2>
						<Link
							href="/wiki/guide-officiel-power-scaling-sentoryoku-kiri"
							className="text-xs text-dbz-orange font-medium underline-offset-4 hover:underline"
						>
							<T k="wiki.canon.fullDossier" />
						</Link>
					</div>
					<ul className="mt-5 grid gap-3 sm:grid-cols-2">
						{config.powerScaling.multipliers.map((m) => {
							const rang = config.tiers.find((t) => t.id === m.canonTier);
							return (
								<li
									key={m.form}
									className="rounded-xl border border-white/15 bg-white/[0.03] p-4 transition-colors hover:border-dbz-gold"
								>
									<div className="flex items-baseline justify-between gap-3">
										<span className="font-display text-sm font-semibold text-white">{m.form}</span>
										<span className="font-mono text-lg font-bold text-white">×{m.multiplier}</span>
									</div>
									<p className="mt-1 text-xs text-white/70">
										<T k="wiki.canon.multiplierBase" values={{ base: m.baseForm, source: m.source }} />
									</p>
									{m.notes && <p className="mt-2 text-xs sm:text-sm leading-relaxed text-white/80">{m.notes}</p>}
									{rang && (
										<p
											className="mt-2 font-display text-[10px] uppercase tracking-[0.12em] font-bold"
											style={{ color: rang.couleur }}
										>
											{rang.court}
										</p>
									)}
								</li>
							);
						})}
					</ul>
					{config.powerScaling.kiriToBpRate > 0 && (
						<p className="mt-4 text-xs sm:text-sm text-white/75">
							<T
								k="wiki.canon.kiriScale"
								values={{
									rate: config.powerScaling.kiriToBpRate.toLocaleString("fr-FR"),
									floor: config.powerScaling.planetDestructionKiriFloor,
								}}
							/>
						</p>
					)}
				</section>
			)}

			<section className="grid gap-8 sm:grid-cols-2">
				<div>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/90">
						<T k="wiki.canon.sourcesAllowed" />
					</h2>
					<ul className="mt-4 space-y-1.5">
						{config.sourcesAdmises.map((s) => (
							<li key={s} className="text-xs sm:text-sm leading-relaxed text-white/80">
								{s}
							</li>
						))}
					</ul>
				</div>
				<div>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/90">
						<T k="wiki.canon.sourcesRefused" />
					</h2>
					<ul className="mt-4 space-y-1.5">
						{config.sourcesInterdites.map((s) => (
							<li
								key={s}
								className="text-xs sm:text-sm leading-relaxed text-white/65 line-through decoration-white/50"
							>
								{s}
							</li>
						))}
					</ul>
				</div>
			</section>
		</div>
	);
}

/**
 * Le gabarit d'attente.
 *
 * Il occupe à peu près la place du bloc de verdict pour que l'arrivée du
 * résultat ne fasse pas sauter la page, et il est masqué aux technologies
 * d'assistance : c'est la région live au-dessus qui parle, pas deux rectangles
 * gris.
 */
function Chargement() {
	return (
		<div className="mt-12 space-y-4" aria-hidden="true">
			<div className="h-52 animate-pulse rounded-xl bg-white/[0.04]" />
			<div className="h-40 animate-pulse rounded-xl bg-white/[0.03]" />
		</div>
	);
}

async function Resultat({ question }: { question: string }) {
	const { verdict, planches, fiches, suggestions } = await canonPreuves(question);
	const couleur = verdict.color;
	// A troll or an open question has no score: printing « 0 / 100 » would rank
	// something the doctrine explicitly refused to rank.
	const note = verdict.nature === "verdict";

	return (
		<div className="mt-12 space-y-12">
			{/* ---- Le verdict, en une phrase ---------------------------------- */}
			<section
				aria-labelledby="canon-verdict-rang"
				className="rounded-xl border border-white/15 bg-white/[0.03] p-6 sm:p-8"
				style={{ borderLeft: `4px solid ${couleur}` }}
			>
				<div className="flex flex-wrap items-baseline justify-between gap-3">
					<h2
						id="canon-verdict-rang"
						className="font-display text-sm font-bold uppercase tracking-[0.14em]"
						style={{ color: couleur }}
					>
						{verdict.tierLabel}
					</h2>
					{note && (
						<p className="font-scouter text-sm tabular-nums text-white/75 font-semibold">
							{verdict.score} / 100
						</p>
					)}
				</div>
				<p className="mt-3 font-serif text-2xl sm:text-3xl leading-snug text-white font-medium">{verdict.verdict}</p>
				<p className="mt-4 text-base leading-relaxed text-white/85">{verdict.explanation}</p>

				{/* Ruled topics next to the question */}
				{suggestions.length > 0 && (
					<div className="mt-5 flex flex-wrap items-center gap-2">
						<span className="text-xs uppercase tracking-[0.12em] text-white/70 font-semibold">
							<T
								k={verdict.nature === "verdict" ? "wiki.canon.seeAlso" : "wiki.canon.nearbyTopics"}
							/>
						</span>
						{suggestions.map((s) => (
							<Link
								key={s.href}
								href={s.href}
								className="rounded-full border border-white/20 bg-white/[0.05] px-3.5 py-1 text-xs text-white/85 transition-colors hover:border-dbz-gold hover:text-white"
							>
								{s.titre}
							</Link>
						))}
					</div>
				)}

				{verdict.toriyamaQuote && (
					<div className="mt-6">
						<Citation
							texte={verdict.toriyamaQuote.text}
							source={verdict.toriyamaQuote.source}
							annee={verdict.toriyamaQuote.year}
							auteur="Akira Toriyama"
							provenance="aphrody"
						/>
					</div>
				)}

				{verdict.sources.length > 0 && (
					<ul className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-4">
						{verdict.sources.map((s) => (
							<li
								key={s}
								className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80"
							>
								{s}
							</li>
						))}
					</ul>
				)}

				{/* Sur quoi le verdict se base */}
				{(verdict.tierDefinition || (verdict.doctrineRules?.length ?? 0) > 0) && (
					<details className="group mt-6 border-t border-white/10 pt-4">
						<summary className="cursor-pointer list-none text-xs uppercase tracking-[0.12em] text-white/70 transition-colors hover:text-white font-semibold">
							<T k="wiki.canon.basis" />
							<span
								aria-hidden="true"
								className="ml-2 inline-block transition-transform group-open:rotate-90"
							>
								›
							</span>
						</summary>
						{verdict.tierDefinition && (
							<p className="mt-4 text-sm sm:text-base leading-relaxed text-white/85">
								<span className="font-semibold" style={{ color: couleur }}>
									{verdict.tierLabel}
								</span>{" "}
								— {verdict.tierDefinition}
							</p>
						)}
						{verdict.doctrineRules && verdict.doctrineRules.length > 0 && (
							<ul className="mt-4 space-y-2">
								{verdict.doctrineRules.map((r) => (
									<li key={r} className="flex gap-2.5 text-xs sm:text-sm leading-relaxed text-white/80">
										<span aria-hidden className="text-dbz-orange font-bold">
											•
										</span>
										<span>{r}</span>
									</li>
								))}
							</ul>
						)}
					</details>
				)}
			</section>

			{/* ---- Ce que l'auteur en a dit ------------------------------------ */}
			{verdict.references && verdict.references.length > 0 && (
				<section>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
						<T k="wiki.canon.authorSays" />
					</h2>
					<div className="mt-5 space-y-6">
						{verdict.references.map((r) => (
							<Citation
								key={r.id}
								texte={r.text}
								texteFr={r.textFr}
								source={r.source}
								href={r.href}
								annee={r.year}
								lang={r.lang}
								sujet={r.subject}
								provenance={r.provenance}
							/>
						))}
					</div>
				</section>
			)}

			{/* ---- Les planches, avec image et transcription ------------------- */}
			{planches.length > 0 && (
				<section>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
						<T k="wiki.canon.inDatabooks" />
					</h2>
					<div className="mt-5 space-y-4">
						{planches.map((p) => (
							<Planche key={p.href} planche={p} />
						))}
					</div>
				</section>
			)}

			{/* ---- Le manga et les épisodes : la recherche inverse -------------- */}
			{/* Leur propre frontière : 700 ms de trigrammes sur 12 593 planches ne
			    doivent pas retenir le verdict, déjà rendu au-dessus. */}
			<Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-white/[0.03]" />}>
				<MangaEtScenes question={question} />
			</Suspense>

			{/* ---- Les fiches du wiki ----------------------------------------- */}
			{fiches.length > 0 && (
				<section>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
						<T k="wiki.canon.inWiki" />
					</h2>
					{/* A card with the entity's own picture when the page has one: a
					    preview of where the link goes, not decoration. Text-only rows
					    keep the same card so the grid stays even. */}
					<ul className="mt-5 grid gap-3 sm:grid-cols-2">
						{fiches.map((f) => {
							const src = f.image ? assetUrl(f.image) : "";
							return (
								<li key={f.href}>
									<Link
										href={f.href}
										className="group flex h-full gap-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] transition-colors hover:border-dbz-gold/60"
									>
										{src && (
											<Image
												src={src}
												alt=""
												width={160}
												height={160}
												sizes="96px"
												className="h-auto w-24 shrink-0 self-stretch object-cover"
											/>
										)}
										<span className={`min-w-0 py-3 pr-4${src ? "" : " pl-4"}`}>
											<span className="font-scouter block text-[10px] uppercase tracking-[0.1em] text-white/50">
												{f.kind}
											</span>
											<span className="mt-0.5 block text-[15px] font-semibold text-white transition-colors group-hover:text-dbz-orange">
												{f.titre}
												{f.nameJa && (
													<span lang="ja" className="ml-2 font-jp text-[12px] font-normal text-white/50">
														{f.nameJa}
													</span>
												)}
											</span>
											<span className="mt-1 block line-clamp-3 text-[13px] leading-relaxed text-white/60">
												{f.extrait}
											</span>
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</section>
			)}

			{planches.length === 0 && fiches.length === 0 && verdict.nature !== "troll" && (
				<p className="text-[14px] text-white/60">
					<T k="wiki.canon.noEvidence" />
				</p>
			)}
		</div>
	);
}

/**
 * Une citation d'auteur ou de guide, avec sa source.
 *
 * Le même bloc servait deux fois — la citation attachée au verdict et celles du
 * corpus `.aphrody` — dans deux copies qui avaient déjà divergé : `lang`
 * n'était posé que d'un côté. Une seule implémentation, et la langue est
 * TOUJOURS déclarée, sinon une synthèse vocale francophone prononce le japonais
 * et l'anglais avec la phonétique française.
 */
function Citation({
	texte,
	texteFr,
	source,
	href,
	annee,
	lang = "fr",
	sujet,
	auteur,
	provenance,
}: {
	texte: string;
	/** Traduction française, quand le corpus la porte. */
	texteFr?: string;
	source: string;
	/** Lien vers la planche scannée, quand la citation vient de nos propres scans. */
	href?: string;
	annee?: number;
	lang?: CanonReference["lang"];
	/** Le sujet dont la déclaration traite, quand le corpus le porte. */
	sujet?: string;
	/** Préfixe d'attribution, quand la source seule ne nomme pas l'auteur. */
	auteur?: string;
	provenance?: CanonReference["provenance"];
}) {
	return (
		<blockquote className="border-l-2 border-white/25 pl-5">
			<div className="flex flex-wrap items-center gap-2">
				{sujet && (
					<p className="font-scouter text-xs uppercase tracking-[0.12em] text-white/70 font-semibold">
						{sujet}
					</p>
				)}
				{provenance && (
					<span
						className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
							provenance === "manga"
								? "bg-dbz-orange/20 text-dbz-orange"
								: provenance === "databooks"
									? "bg-dbz-gold/20 text-dbz-gold"
									: provenance === "aphrody"
										? "bg-sky-500/20 text-sky-300"
										: "bg-purple-500/20 text-purple-200"
						}`}
					>
						<T k={`wiki.canon.provenance.${provenance}`} />
					</span>
				)}
			</div>
			{/* Traduite quand elle l'est, mais l'original reste dessous */}
			<p
				lang={texteFr ? "fr" : lang}
				className={`whitespace-pre-line font-serif text-base sm:text-lg italic leading-relaxed text-white/95${sujet || provenance ? " mt-2.5" : ""}`}
			>
				« {texteFr || texte} »
			</p>
			{texteFr && (
				<p
					lang={lang}
					className="mt-2.5 whitespace-pre-line border-l border-white/15 pl-3 text-xs sm:text-sm leading-relaxed text-white/70"
				>
					{texte}
				</p>
			)}
			<footer className="mt-3 text-xs sm:text-sm text-white/75">
				{auteur ? `${auteur} — ` : ""}
				{href ? (
					<Link href={href} className="text-dbz-orange hover:underline">
						{source}
					</Link>
				) : (
					source
				)}
				{annee ? `, ${annee}` : ""}
				{lang !== "fr" && (
					<span className="ml-2 text-white/60">
						<T
							k={
								texteFr
									? "wiki.canon.translatedFromOriginal"
									: "wiki.canon.originalLanguage"
							}
						/>
					</span>
				)}
			</footer>
		</blockquote>
	);
}

/**
 * Une planche = l'image scannée, le japonais tel qu'il est imprimé, et la
 * traduction quand elle est passée en relecture.
 */
function Planche({ planche: p }: { planche: PlanchePreuve }) {
	const src = assetUrl(p.image);
	return (
		<article className="overflow-hidden rounded-xl border border-white/15 bg-white/[0.03] sm:flex">
			{src && (
				<Link href={p.href} className="block shrink-0 sm:w-[180px]">
					<Image
						src={src}
						alt={`${p.databookTitre} — planche ${p.numero}`}
						width={360}
						height={520}
						sizes="(min-width: 640px) 180px, 100vw"
						className="h-56 w-full object-cover sm:h-full"
					/>
				</Link>
			)}
			<div className="min-w-0 flex-1 p-5 sm:p-6">
				<Link
					href={p.href}
					className="font-display text-base font-semibold text-white hover:text-dbz-orange transition-colors"
				>
					{p.databookTitre}
				</Link>
				<p className="mt-1 text-xs sm:text-sm text-white/70">
					<T k="wiki.canon.plateNumber" values={{ number: p.numero }} />
					{p.verifiee && <T k="wiki.canon.plateProofread" />}
				</p>
				{p.texteFr && (
					<p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/85 line-clamp-[8]">
						{p.texteFr}
					</p>
				)}
				{p.texte && (
					<p
						lang="ja"
						className="mt-3 whitespace-pre-line border-t border-white/10 pt-3 text-xs sm:text-sm leading-relaxed text-white/70 line-clamp-4"
					>
						{p.texte}
					</p>
				)}
			</div>
		</article>
	);
}

/**
 * Planches du manga et scènes d'épisodes qui répondent à la question.
 *
 * C'est le sens inverse du Frame Finder des fiches épisodes : on part d'une
 * phrase (« kamehameha contre Cell ») et on remonte aux planches où elle est
 * imprimée et aux épisodes où la scène se joue. Une panne de l'une des deux
 * recherches n'efface pas l'autre.
 */
async function MangaEtScenes({ question }: { question: string }) {
	const [planchesManga, scenes] = await Promise.all([
		planchesEnCache(question).catch((e) => {
			console.error("[canon] planches manga indisponibles:", e);
			return [] as ResultatPlanche[];
		}),
		scenesEnCache(question).catch((e) => {
			console.error("[canon] scènes indisponibles:", e);
			return [] as SceneTrouvee[];
		}),
	]);
	if (planchesManga.length === 0 && scenes.length === 0) return null;

	return (
		<>
			{planchesManga.length > 0 && (
				<section>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
						<T k="wiki.canon.inManga" />
					</h2>
					<p className="mt-1 text-xs sm:text-sm text-white/70">
						<T k="wiki.canon.inMangaLead" />
					</p>
					<ul className="mt-5 grid gap-3 sm:grid-cols-2">
						{planchesManga.map((p) => (
							<li key={`${p.series}-${p.tome}-${p.planche}`}>
								<PlancheManga planche={p} />
							</li>
						))}
					</ul>
				</section>
			)}

			{scenes.length > 0 && (
				<section>
					<h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-dbz-orange">
						<T k="wiki.canon.inScenes" />
					</h2>
					<p className="mt-1 text-xs sm:text-sm text-white/70">
						<T k="wiki.canon.inScenesLead" />
					</p>
					<ul className="mt-5 grid gap-3 sm:grid-cols-2">
						{scenes.map((sc) => {
							const src = sc.image ? assetUrl(sc.image) : "";
							return (
								<li key={sc.id}>
									<Link
										href={sc.href}
										className="group flex h-full gap-4 overflow-hidden rounded-xl border border-white/15 bg-white/[0.03] transition-colors hover:border-dbz-gold"
									>
										{src && (
											<Image
												src={src}
												alt=""
												width={240}
												height={135}
												sizes="128px"
												className="h-auto w-32 shrink-0 self-stretch object-cover"
											/>
										)}
										<span className={`min-w-0 py-3 pr-4${src ? "" : " pl-4"}`}>
											<span className="font-scouter block text-[10px] uppercase tracking-[0.1em] text-white/70 font-semibold">
												{sc.series.replace(/_/g, " ")} · {sc.numberInSeries ?? sc.id}
											</span>
											<span className="mt-0.5 block text-sm sm:text-base font-semibold text-white transition-colors group-hover:text-dbz-orange">
												{sc.title ?? `#${sc.id}`}
											</span>
											<span className="mt-1 block line-clamp-3 text-xs sm:text-sm leading-relaxed text-white/80">
												{sc.extrait}
											</span>
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</section>
			)}
		</>
	);
}

/** Une planche du manga trouvée par sa transcription : scan, extrait, pertinence. */
function PlancheManga({ planche: p }: { planche: ResultatPlanche }) {
	const cible = p.href ? p.href.replace(/^https?:\/\/[^/]+/, "") : null;
	const contenu = (
		<>
			{p.image && (
				<Image
					src={p.image}
					alt=""
					width={180}
					height={260}
					sizes="96px"
					className="h-auto w-24 shrink-0 self-stretch object-cover"
				/>
			)}
			<span className={`min-w-0 py-3 pr-4${p.image ? "" : " pl-4"}`}>
				<span className="font-scouter block text-[10px] uppercase tracking-[0.1em] text-white/70 font-semibold">
					<T k="wiki.canon.mangaPlate" values={{ series: p.series, number: p.rang ?? p.planche }} />
					{" · "}
					<T k="wiki.canon.relevance" values={{ score: Math.round(p.score) }} />
				</span>
				<span className="mt-1 block line-clamp-4 text-xs sm:text-sm leading-relaxed text-white/85">
					{p.extrait}
				</span>
			</span>
		</>
	);
	const classe =
		"group flex h-full gap-4 overflow-hidden rounded-xl border border-white/15 bg-white/[0.03] transition-colors hover:border-dbz-gold";
	return cible ? (
		<Link href={cible} className={classe}>
			{contenu}
		</Link>
	) : (
		<div className={classe}>{contenu}</div>
	);
}
