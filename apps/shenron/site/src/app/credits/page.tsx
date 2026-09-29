import { PageShell } from "@/components/kit";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import type { Metadata } from "next";
import { DISCORD_INVITE } from "@/lib/config";
import { T } from "@/components/T";

export const metadata: Metadata = {
	title: "Crédits & sources",
	description:
		"Crédits, attributions et sources des contenus utilisés sur DBFR. Marque Dragon Ball © Bird Studio / Shueisha / Toei Animation.",
	alternates: { canonical: "/credits" },
};

const RIGHTS_HOLDERS = [
	{
		name: "Akira Toriyama / Bird Studio",
		role: "Auteur original du manga Dragon Ball (1984)",
		link: "https://www.bird-studio.com/",
	},
	{
		name: "Shueisha",
		role: "Éditeur du manga (Weekly Shōnen Jump, Shōnen Jump+)",
		link: "https://www.shueisha.co.jp/",
	},
	{
		name: "Toei Animation",
		role: "Studio d'animation (Dragon Ball, DBZ, DB Super, DB Daima)",
		link: "https://corp.toei-anim.co.jp/en/",
	},
	{
		name: "Bandai Namco Entertainment",
		role: "Éditeur jeux vidéo officiels (Kakarot, Sparking! ZERO, Xenoverse)",
		link: "https://en.bandainamcoent.eu/dragon-ball",
	},
	{
		name: "Viz Media",
		role: "Distributeur officiel anglophone",
		link: "https://www.viz.com/dragon-ball-super",
	},
];

const DATA_SOURCES = [
	{
		name: "dragonball-api.com",
		desc: "Personnages, planètes, transformations — corpus principal du wiki",
		license: "Open-source (GitHub web0zz/dragon-ball-api)",
		link: "https://dragonball-api.com/",
	},
	{
		name: "Jikan (MyAnimeList scraper)",
		desc: "Métadonnées épisodes, dates, staff",
		license: "API publique, libre d'usage avec rate-limit",
		link: "https://jikan.moe/",
	},
	{
		name: "Kitsu",
		desc: "Posters et synopsis multilingues",
		license: "API publique JSON:API",
		link: "https://kitsu.io/",
	},
	{
		name: "AniList",
		desc: "Relations entre médias et calendriers",
		license: "GraphQL public",
		link: "https://anilist.co/",
	},
	{
		name: "Bandai Namco — sitemaps publics",
		desc: "Liens sortants vers les pages produits officielles (jamais de copie)",
		license: "Liens et titres publics uniquement",
		link: "https://en.bandainamcoent.eu/dragon-ball",
	},
];

const TECH = [
	{ name: "Next.js 15", link: "https://nextjs.org" },
	{ name: "Tailwind CSS v4", link: "https://tailwindcss.com" },
	{
		name: "Google Sans Flex (Google Fonts)",
		link: "https://fonts.google.com/specimen/Google+Sans+Flex",
	},
	{
		name: "Noto Sans JP (Google Fonts)",
		link: "https://fonts.google.com/specimen/Noto+Sans+JP",
	},
	{ name: "Better Auth", link: "https://better-auth.com" },
	{ name: "Drizzle ORM", link: "https://orm.drizzle.team" },
	{ name: "Vercel", link: "https://vercel.com" },
];

export default function CreditsPage() {
	return (
		<PageShell width="narrow" rhythm="loose">
			<PageHeader
				eyebrow={<T k="legal.eyebrow" />}
				title={<T k="legal.credits.title" />}
				subtitle={
					<>
						DBFR est un site <strong>communautaire de fans francophones</strong>, édité bénévolement
						et <strong>sans but lucratif</strong>. Il n'est affilié à aucun ayant droit. Cette page
						liste toutes les sources de contenu, données et technologies utilisées.
					</>
				}
			/>

			<section className="mb-16">
				<h2 className="font-display font-bold text-[28px] text-white mb-6 border-b border-white/10 pb-3">
					<T k="legal.credits.rightsTitle" />
				</h2>
				<p className="text-[15px] text-white/65 leading-relaxed mb-6">
					<strong className="text-white">
						Dragon Ball, Dragon Ball Z, Dragon Ball Super, Dragon Ball Daima
					</strong>{" "}
					et l'ensemble des personnages, lieux, attaques et éléments graphiques qui en sont issus
					sont la propriété exclusive de leurs ayants droit. Toutes les images de personnages, scans
					manga, stills anime et artworks officiels présents sur ce site restent la propriété de :
				</p>
				<ul className="grid gap-3">
					{RIGHTS_HOLDERS.map((r) => (
						<li
							key={r.name}
							className="p-5 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-start justify-between gap-4"
						>
							<div>
								<a
									href={r.link}
									target="_blank"
									rel="noopener noreferrer"
									className="font-display font-bold text-[17px] text-white hover:text-dbz-orange transition-colors"
								>
									{r.name}
								</a>
								<p className="text-[14px] text-white/65 mt-1">{r.role}</p>
							</div>
						</li>
					))}
				</ul>
			</section>

			<section className="mb-16">
				<h2 className="font-display font-bold text-[28px] text-white mb-6 border-b border-white/10 pb-3">
					<T k="legal.credits.dataTitle" />
				</h2>
				<p className="text-[15px] text-white/65 leading-relaxed mb-6">
					<T k="legal.credits.dataLead" />
				</p>
				<ul className="grid gap-3">
					{DATA_SOURCES.map((s) => (
						<li key={s.name} className="p-5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
							<div className="flex items-start justify-between gap-4 flex-wrap">
								<div className="flex-1">
									<a
										href={s.link}
										target="_blank"
										rel="noopener noreferrer"
										className="font-display font-bold text-[17px] text-white hover:text-dbz-orange transition-colors"
									>
										{s.name}
									</a>
									<p className="text-[14px] text-white/65 mt-1">{s.desc}</p>
								</div>
								<span className="text-[11px] font-display font-semibold tracking-[0.12em] uppercase text-dbz-orange shrink-0">
									{s.license}
								</span>
							</div>
						</li>
					))}
				</ul>
			</section>

			<section className="mb-16">
				<h2 className="font-display font-bold text-[28px] text-white mb-6 border-b border-white/10 pb-3">
					<T k="legal.credits.techTitle" />
				</h2>
				<div className="flex flex-wrap gap-2">
					{TECH.map((t) => (
						<a
							key={t.name}
							href={t.link}
							target="_blank"
							rel="noopener noreferrer"
							className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[13px] text-white/80 hover:text-white transition-colors"
						>
							{t.name}
						</a>
					))}
				</div>
			</section>

			<section
				id="contact"
				className="p-8 rounded-2xl bg-dbz-orange/10 border border-dbz-orange/30"
			>
				<h2 className="font-display font-bold text-[24px] text-white mb-3">
					<T k="legal.credits.contactTitle" />
				</h2>
				<p className="text-[15px] text-white/80 leading-relaxed mb-4">
					{/* Le délai de 48 heures reste écrit ici : le dictionnaire refuse un
					    nombre suivi d'un pluriel (garde anti-compteur des messages), et on
					    ne réécrit pas un engagement de retrait pour contourner un test. */}
					Si vous représentez un ayant droit et souhaitez voir un contenu retiré (image, citation,
					lien), contactez-nous via le serveur Discord ou par e-mail. Nous traitons toute demande
					sous 48 heures.
				</p>
				<div className="flex flex-wrap gap-3">
					<a
						href={DISCORD_INVITE}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center h-10 px-5 rounded-full bg-dbz-orange hover:bg-white text-black font-display font-bold text-[13px] tracking-[0.10em] uppercase transition-colors"
					>
						<T k="legal.credits.contactDiscord" />
					</a>
					<Link
						href="/licence"
						className="inline-flex items-center h-10 px-5 rounded-full border border-white/20 hover:border-white text-white font-display font-semibold text-[13px] tracking-[0.10em] uppercase transition-colors"
					>
						<T k="legal.credits.readLicence" />
					</Link>
				</div>
			</section>
		</PageShell>
	);
}
