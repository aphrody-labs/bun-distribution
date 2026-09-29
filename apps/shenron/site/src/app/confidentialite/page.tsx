import { PageShell } from "@/components/kit";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import type { Metadata } from "next";
import { DISCORD_INVITE } from "@/lib/config";
import { T } from "@/components/T";

/**
 * Politique de confidentialité — page **exigée** par les règles du programme
 * Google AdSense : un site qui diffuse des annonces doit publier une politique
 * indiquant l'usage de cookies tiers par Google et ses partenaires, et les
 * moyens de s'y opposer. Sans cette page, la demande de validation du site est
 * refusée (motif « contenu de faible valeur / règles non respectées »).
 *
 * Page statique, sans cookie ni header → cache CDN préservé.
 */
export const metadata: Metadata = {
	title: "Politique de confidentialité",
	description:
		"Cookies, mesure d'audience, publicité Google AdSense, données de compte Discord : ce que DBFR collecte, pourquoi, et comment refuser ou effacer.",
	alternates: { canonical: "/confidentialite" },
};

export default function ConfidentialitePage() {
	return (
		<PageShell width="narrow" rhythm="loose">
			<PageHeader
				eyebrow={<T k="legal.eyebrow" />}
				title={<T k="confidentialite.title" />}
				subtitle={<T k="confidentialite.subtitle" />}
			/>

			<div className="prose prose-invert prose-headings:font-display prose-headings:font-bold prose-headings:text-white prose-h2:text-[24px] prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-2 prose-h3:text-[18px] prose-h3:mt-8 prose-p:text-white/75 prose-p:leading-relaxed prose-p:text-[15px] prose-a:text-dbz-orange prose-a:no-underline hover:prose-a:underline prose-strong:text-white prose-li:text-white/75 prose-li:text-[15px] max-w-none">
				<h2>
					<T k="confidentialite.s1" />
				</h2>
				<p>
					DBFR (<strong>dragonballfr.com</strong>) est édité bénévolement par l'équipe de la
					communauté Dragon Ball FR. Le site et sa base de données sont hébergés sur un serveur
					dédié <a href="https://www.ovhcloud.com/">OVHcloud</a> situé en France (Gravelines) — vos
					données de compte ne quittent pas l'Union européenne, à l'exception des traitements
					publicitaires décrits en section 4.
				</p>
				<p>
					Contact pour toute question ou demande d'exercice de droits : le canal <code>#admin</code>{" "}
					du{" "}
					<a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
						serveur Discord DBFR
					</a>
					.
				</p>

				<h2>
					<T k="confidentialite.s2" />
				</h2>
				<p>
					Consulter le wiki, les épisodes, les films ou le manga{" "}
					<strong>ne demande aucun compte</strong>. Dans ce cas, les seules données traitées sont :
				</p>
				<ul>
					<li>
						les <strong>journaux techniques</strong> du serveur (adresse IP, page demandée,
						navigateur), conservés au maximum 30 jours pour la sécurité et le diagnostic de pannes —
						base légale : intérêt légitime ;
					</li>
					<li>
						un cookie strictement nécessaire de <strong>préférences</strong> (thème, choix de
						consentement), stocké sur votre appareil et jamais transmis à un tiers.
					</li>
				</ul>

				<h2>
					<T k="confidentialite.s3" />
				</h2>
				<p>
					La mesure d'audience (pages vues, parcours, contenus populaires) n'est déclenchée{" "}
					<strong>qu'après votre accord explicite</strong> via le bandeau de consentement. Refuser
					n'enlève aucune fonctionnalité du site.
				</p>
				<ul>
					<li>
						<strong>Télémétrie interne</strong> — enregistrée dans notre propre base de données, sur
						notre serveur. Les adresses IP y sont <strong>hachées avec un sel secret</strong>{" "}
						(jamais stockées en clair) et un identifiant anonyme est utilisé pour distinguer les
						visites. Conservation : 13 mois.
					</li>
					<li>
						<strong>Google Tag Manager / Google Analytics</strong> — déclenchés uniquement si le
						consentement « mesure d'audience » est accordé, via le{" "}
						<a
							href="https://support.google.com/analytics/answer/9976101"
							target="_blank"
							rel="noopener noreferrer"
						>
							mode Consentement v2 de Google
						</a>
						. Sans accord, ces balises sont chargées en mode restreint et n'écrivent aucun cookie.
					</li>
				</ul>

				<h2>
					<T k="confidentialite.s4" />
				</h2>
				<p>
					DBFR est gratuit et le restera. Pour couvrir l'hébergement, le nom de domaine et la bande
					passante, le site affiche des annonces fournies par <strong>Google AdSense</strong>.
					Concrètement :
				</p>
				<ul>
					<li>
						Google, en tant que fournisseur tiers, utilise des <strong>cookies</strong> et
						identifiants similaires pour diffuser des annonces sur ce site.
					</li>
					<li>
						L'usage par Google de cookies publicitaires lui permet, ainsi qu'à ses partenaires, de
						diffuser des annonces basées sur vos visites sur ce site{" "}
						<strong>et/ou sur d'autres sites</strong>.
					</li>
					<li>
						Dans l'Espace économique européen, au Royaume-Uni et en Suisse, ces traitements sont
						conditionnés à votre choix recueilli par un{" "}
						<strong>outil de gestion du consentement certifié par Google</strong> (cadre IAB TCF).
						Vous pouvez modifier ce choix à tout moment en rouvrant ce bandeau depuis le lien
						présent en pied de page du bandeau lui-même.
					</li>
					<li>
						En cas de refus, la publicité reste affichée mais devient{" "}
						<strong>non personnalisée</strong> : elle n'est plus fondée sur votre historique de
						navigation.
					</li>
				</ul>
				<p>
					<T k="confidentialite.s4Further" />
				</p>
				<ul>
					<li>
						désactiver la personnalisation des annonces Google :{" "}
						<a href="https://myadcenter.google.com/" target="_blank" rel="noopener noreferrer">
							myadcenter.google.com
						</a>{" "}
						;
					</li>
					<li>
						détail des données traitées par Google :{" "}
						<a
							href="https://policies.google.com/technologies/partner-sites"
							target="_blank"
							rel="noopener noreferrer"
						>
							« Utilisation des données par Google sur les sites partenaires »
						</a>{" "}
						;
					</li>
					<li>
						se désinscrire d'autres régies publicitaires tierces :{" "}
						<a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">
							aboutads.info/choices
						</a>{" "}
						et{" "}
						<a
							href="https://www.youronlinechoices.com/fr/"
							target="_blank"
							rel="noopener noreferrer"
						>
							youronlinechoices.com
						</a>
						.
					</li>
				</ul>

				<h2>
					<T k="confidentialite.s5" />
				</h2>
				<p>
					<T k="confidentialite.s5Text" />
				</p>
				<p>
					Elles ne sont <strong>ni revendues, ni transmises à des annonceurs</strong>. Elles sont
					conservées tant que le compte existe, puis effacées sur demande — via le canal{" "}
					<code>#admin</code> du serveur Discord.
				</p>

				<h2>
					<T k="confidentialite.s6" />
				</h2>
				<ul>
					<li>
						<strong>Nécessaires</strong> — session d'authentification (Better Auth), protection
						anti-abus, mémorisation de votre choix de consentement. Toujours actifs, sans quoi le
						site ne peut pas fonctionner.
					</li>
					<li>
						<strong>Mesure d'audience</strong> — soumis à consentement (section 3).
					</li>
					<li>
						<strong>Publicité</strong> — déposés par Google et ses partenaires, soumis au choix
						exprimé dans l'outil de consentement (section 4).
					</li>
				</ul>
				<p>
					Vous pouvez également bloquer ou supprimer les cookies depuis les réglages de votre
					navigateur, et activer le signal <em>Do Not Track</em> : dans ce cas, aucune mesure
					d'audience n'est déclenchée et aucun bandeau ne vous est présenté.
				</p>

				<h2>
					<T k="confidentialite.s7" />
				</h2>
				<p>
					Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement, de
					limitation, d'opposition et de portabilité sur vos données. Toute demande est traitée sous
					30 jours via le canal <code>#admin</code> du serveur Discord. Vous pouvez également
					introduire une réclamation auprès de la{" "}
					<a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener noreferrer">
						CNIL
					</a>
					.
				</p>

				<h2>
					<T k="confidentialite.s8" />
				</h2>
				<p>
					{/* L'âge minimum reste écrit ici : « 13 ans » déclenche la garde
					    anti-compteur du dictionnaire, et la phrase est un engagement. */}
					Le site s'adresse à un public général. La création de compte passe par Discord, dont les
					conditions d'utilisation imposent un âge minimum (13 ans, ou davantage selon le pays).
					Aucune publicité n'est ciblée sur les mineurs et aucun contenu réservé aux adultes n'est
					accepté par la régie.
				</p>

				<h2>
					<T k="confidentialite.s9" />
				</h2>
				<p>
					Cette politique peut évoluer, notamment si de nouveaux services sont ajoutés. La version
					en vigueur est celle publiée sur cette page. Voir aussi la{" "}
					<Link href="/licence">licence &amp; usage des contenus</Link> et les{" "}
					<Link href="/credits">crédits &amp; sources</Link>.
				</p>
			</div>
		</PageShell>
	);
}
