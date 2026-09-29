import { PageShell } from "@/components/kit";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import type { Metadata } from "next";
import { DISCORD_INVITE } from "@/lib/config";
import { T } from "@/components/T";

export const metadata: Metadata = {
	title: "Licence & usage",
	description:
		"Politique d'usage des contenus DBFR, mentions fair-use, sources éditoriales, contact pour demande de retrait.",
	alternates: { canonical: "/licence" },
};

export default function LicencePage() {
	return (
		<PageShell width="narrow" rhythm="loose">
			<PageHeader
				eyebrow={<T k="legal.eyebrow" />}
				title={<T k="licence.title" />}
				subtitle={<T k="licence.subtitle" />}
			/>

			<div className="prose prose-invert prose-headings:font-display prose-headings:font-bold prose-headings:text-white prose-h2:text-[24px] prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-2 prose-h3:text-[18px] prose-h3:mt-8 prose-p:text-white/75 prose-p:leading-relaxed prose-p:text-[15px] prose-a:text-dbz-orange prose-a:no-underline hover:prose-a:underline prose-strong:text-white prose-li:text-white/75 prose-li:text-[15px] max-w-none">
				<h2>
					<T k="licence.s1" />
				</h2>
				<p>
					DBFR est un projet associatif, édité bénévolement par des fans francophones de Dragon
					Ball. Le site <strong>ne vend ni produits dérivés ni abonnement</strong> et ne
					commercialise aucun contenu Dragon Ball. Il affiche en revanche des{" "}
					<strong>annonces publicitaires</strong> (Google AdSense) dont les recettes servent
					exclusivement à couvrir les frais d'hébergement, de nom de domaine et de bande passante du
					projet — voir la <Link href="/confidentialite">politique de confidentialité</Link>. Les
					éventuels liens vers des boutiques officielles (Bandai Namco, dbz-store, Toei Shop) ne
					sont pas affiliés.
				</p>
				<p>
					Le site n'est <strong>en aucune façon affilié, sponsorisé, ou approuvé</strong> par Bird
					Studio, Shueisha, Toei Animation, Bandai Namco Entertainment ou tout autre ayant droit de
					la franchise Dragon Ball.
				</p>

				<h2>
					<T k="licence.s2" />
				</h2>
				<p>
					Dragon Ball, Dragon Ball Z, Dragon Ball Super, Dragon Ball GT, Dragon Ball Daima, Dragon
					Ball Heroes, ainsi que l'ensemble des personnages, lieux, attaques, transformations et
					éléments graphiques associés sont la <strong>propriété exclusive</strong> de leurs ayants
					droit respectifs :
				</p>
				<ul>
					<li>
						<T k="licence.s2Original" />
					</li>
					<li>
						<T k="licence.s2Manga" />
					</li>
					<li>
						<T k="licence.s2Anime" />
					</li>
					<li>
						<T k="licence.s2Games" />
					</li>
				</ul>
				<p>
					Les images, scans, stills, artworks officiels et noms de marque apparaissant sur ce site
					sont utilisés à des fins
					<strong> strictement informatives et éditoriales</strong>, encyclopédiques et non
					commerciales, dans un cadre comparable aux encyclopédies en ligne.
				</p>

				<h2>
					<T k="licence.s3" />
				</h2>
				<p>
					Le contenu rédactionnel original (articles de news, résumés de sagas, classements, code
					applicatif) est publié par défaut sous licence{" "}
					<a
						href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr"
						target="_blank"
						rel="noopener noreferrer"
					>
						Creative Commons BY-SA 4.0
					</a>{" "}
					(attribution + partage à l'identique). Tu peux reprendre, citer et modifier ce contenu en
					créditant DBFR et en redistribuant sous la même licence.
				</p>

				<h2>
					<T k="licence.s4" />
				</h2>
				<h3>
					<T k="licence.s4Wikis" />
				</h3>
				<p>
					DBFR n'utilise plus les wikis de fans comme source éditoriale. Les références qui
					pointaient vers <em>dragonball.fandom.com</em> ont été retirées des bibliographies du
					wiki et de la base de connaissances du bot : les fiches se sourcent désormais sur le
					manga, les databooks et guides officiels, les catalogues d'éditeurs et les APIs
					publiques.
				</p>
				<p>
					Certains articles hérités de cet import restent en cours de ré-écriture à partir des
					sources de première main. Tant qu'un passage dérive d'un wiki sous{" "}
					<a
						href="https://creativecommons.org/licenses/by-sa/3.0/"
						target="_blank"
						rel="noopener noreferrer"
					>
						CC-BY-SA 3.0
					</a>
					, il reste couvert par cette licence. Signale-nous tout passage à créditer ou à
					retirer : nous le traitons comme une demande de retrait (section 6).
				</p>
				<h3>
					<T k="licence.s4Api" />
				</h3>
				<p>
					Les fiches personnages et planètes proviennent de l'API open-source{" "}
					<a href="https://dragonball-api.com/" target="_blank" rel="noopener noreferrer">
						dragonball-api.com
					</a>
					. Les métadonnées anime/manga proviennent de Jikan, Kitsu et AniList (APIs publiques).
				</p>

				<h2>
					<T k="licence.s5" />
				</h2>
				<p>
					Site hébergé sur un serveur dédié <a href="https://www.ovhcloud.com/">OVHcloud</a>{" "}
					(France, Gravelines). Authentification via Discord OAuth (
					<a href="https://discord.com/developers/docs">Discord Inc.</a>). Aucune donnée personnelle
					n'est revendue. Tu peux demander suppression de ton compte à tout moment via le serveur
					Discord. Le détail des traitements (mesure d'audience, publicité, cookies) figure dans la{" "}
					<Link href="/confidentialite">politique de confidentialité</Link>.
				</p>

				<h2 id="takedown">
					<T k="licence.s6" />
				</h2>
				<p>
					Si vous êtes ayant droit et estimez qu'un contenu publié sur DBFR porte atteinte à vos
					droits, nous procédons au retrait <strong>sous 48 heures</strong> sur simple demande
					motivée. Aucun recours juridique préalable n'est nécessaire.
				</p>
				<p>
					<T k="licence.s6Instructions" />
				</p>
				<ul>
					<li>
						Serveur Discord :{" "}
						<a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
							discord.gg/dragonballfr
						</a>{" "}
						(canal #admin)
					</li>
					<li>
						<T k="licence.s6Email" />
					</li>
				</ul>

				<h2>
					<T k="licence.s7" />
				</h2>
				<p>
					<T
						k="licence.s7Text"
						values={{
							date: new Date().toLocaleDateString("fr-FR", {
								day: "numeric",
								month: "long",
								year: "numeric",
							}),
						}}
					/>
				</p>
			</div>

			<div className="mt-16 p-8 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex flex-wrap items-center justify-between gap-4">
				<p className="text-[14px] text-white/70 max-w-md">
					<T k="licence.askBefore" /> <code className="text-dbz-orange">#admin</code>{" "}
					<T k="licence.askAfter" />
				</p>
				<Link
					href="/credits"
					className="inline-flex items-center h-10 px-5 rounded-full border border-white/20 hover:border-dbz-orange hover:text-dbz-orange text-white font-display font-semibold text-[13px] tracking-[0.10em] uppercase transition-colors"
				>
					<T k="licence.seeCredits" />
				</Link>
			</div>
		</PageShell>
	);
}
