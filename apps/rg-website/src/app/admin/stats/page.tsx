import {
	AdminPageHeader,
	Badge,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@rosegriffon/ui";
import { formatBytes } from "@rosegriffon/db/platform";
import { BarChart3, CheckCircle2, ExternalLink, Gauge, Users, XCircle } from "lucide-react";
import Link from "next/link";

import { lireAudience, lireAudienceDistante, type StatsDomaine } from "@/lib/stats/audience";
import { lireSites, type Site } from "@/lib/stats/sites";

export const dynamic = "force-dynamic";

export const metadata = {
	description: "Audience et contenu de chaque domaine Rose Griffon.",
	title: "Statistiques — Administration",
};

const FENETRE_HEURES = 24;

function nombre(n: number): string {
	return n.toLocaleString("fr-FR");
}

/** Bandeau de disponibilité, identique pour tous les domaines. */
function Disponibilite({ statut }: { statut: Site["statut"] }) {
	return (
		<span className="flex items-center gap-1.5 text-xs">
			{statut.ok ? (
				<CheckCircle2 className="size-4 shrink-0 text-succes" aria-hidden />
			) : (
				<XCircle className="size-4 shrink-0 text-destructive" aria-hidden />
			)}
			<span className="text-muted-foreground">
				{statut.ok
					? `HTTP ${statut.code} · ${statut.latenceMs} ms`
					: (statut.erreur ?? `HTTP ${statut.code ?? "—"}`)}
			</span>
		</span>
	);
}

function CarteAudience({ stats }: { stats: StatsDomaine }) {
	const tauxErreur =
		stats.requetes > 0 ? ((stats.erreurs4xx + stats.erreurs5xx) / stats.requetes) * 100 : 0;

	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
			{[
				{ label: "Requêtes", valeur: nombre(stats.requetes) },
				{ label: "Visiteurs uniques", valeur: nombre(stats.visiteurs) },
				{ label: "Trafic", valeur: formatBytes(stats.octets) },
				{ label: "Médiane", valeur: `${nombre(stats.medianeMs)} ms` },
				{ label: "95ᵉ centile", valeur: `${nombre(stats.p95Ms)} ms` },
				{
					label: "Erreurs",
					valeur: `${tauxErreur.toFixed(1).replace(".", ",")} %`,
				},
			].map((m) => (
				<div key={m.label} className="rounded-lg border border-border p-3">
					<p className="text-xs text-muted-foreground">{m.label}</p>
					<p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{m.valeur}</p>
				</div>
			))}
		</div>
	);
}

/**
 * Page « Statistiques » de l'administration.
 *
 * Un onglet par domaine Rose Griffon. Chacun croise deux sources indépendantes :
 * l'audience réelle, agrégée depuis le journal nginx unifié, et l'inventaire de
 * contenu lu en base. Aucun chiffre n'est estimé.
 *
 * Le journal ne remonte qu'au dernier changement de configuration : les
 * premières heures affichent donc peu de données, ce que la page annonce
 * explicitement plutôt que de laisser croire à une chute d'audience.
 */
export default async function StatsPage() {
	const [audience, sites, distante] = await Promise.all([
		lireAudience(FENETRE_HEURES),
		lireSites(),
		lireAudienceDistante(),
	]);

	// Le cache planifié sert de repli. Le journal local est prioritaire pour un
	// même hôte afin de ne jamais additionner deux fois son trafic.
	const uniques = new Map((distante?.domaines ?? []).map((d) => [d.host, d]));
	for (const domaine of audience.domaines) uniques.set(domaine.host, domaine);
	const tousDomaines = [...uniques.values()];
	const parDomaine = new Map(tousDomaines.map((d) => [d.host, d]));
	// Domaines vus dans le journal mais absents de l'inventaire : sous-domaines
	// techniques (db., storage., realtime.) ou hôtes inattendus. On les montre
	// plutôt que de les taire — un hôte inconnu qui reçoit du trafic est en soi
	// une information.
	const connus = new Set(sites.map((s) => s.domaine));
	const autres = tousDomaines.filter((d) => !connus.has(d.host));

	const totalRequetes = tousDomaines.reduce((s, d) => s + d.requetes, 0);
	const totalOctets = tousDomaines.reduce((s, d) => s + d.octets, 0);
	const totalVisiteurs = tousDomaines.reduce((s, d) => s + d.visiteurs, 0);

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				icon={<BarChart3 className="size-5" />}
				title="Statistiques"
				description={`Audience et contenu de chaque domaine, sur les ${FENETRE_HEURES} dernières heures.`}
			/>

			{!audience.journalDisponible && (
				<Card className="border-alerte/40">
					<CardHeader>
						<CardTitle className="text-alerte">Journal d'audience introuvable</CardTitle>
						<CardDescription>
							`/var/log/nginx/rg-stats.log` n'existe pas ou n'est pas lisible par le service. Les
							chiffres d'audience ci-dessous seront vides tant que nginx n'écrit pas dans ce
							fichier ; l'inventaire de contenu, lui, reste exact.
						</CardDescription>
					</CardHeader>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Gauge className="size-5 text-muted-foreground" aria-hidden />
						Tous domaines confondus
					</CardTitle>
					<CardDescription>
						{nombre(audience.lignesLues)} requêtes analysées depuis le{" "}
						{new Date(audience.depuis).toLocaleString("fr-FR")}
						{audience.tronque && " — lecture tronquée, le journal dépasse le plafond d'analyse"}.
						{distante?.collecteLe
							? ` Agrégat Achilléa actualisé le ${new Date(distante.collecteLe).toLocaleString("fr-FR")}.`
							: " Aucun agrégat Achilléa planifié disponible."}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{[
						{ label: "Requêtes", valeur: nombre(totalRequetes) },
						{ label: "Visiteurs uniques", valeur: nombre(totalVisiteurs) },
						{ label: "Trafic sortant", valeur: formatBytes(totalOctets) },
						{ label: "Domaines actifs", valeur: nombre(tousDomaines.length) },
					].map((m) => (
						<div key={m.label} className="rounded-lg border border-border p-4">
							<p className="text-xs text-muted-foreground">{m.label}</p>
							<p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{m.valeur}</p>
						</div>
					))}
				</CardContent>
			</Card>

			<Tabs defaultValue={sites[0]?.domaine} className="w-full">
				<TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:flex sm:flex-wrap sm:justify-start">
					{sites.map((site) => (
						<TabsTrigger
							key={site.domaine}
							value={site.domaine}
							className="min-h-11 text-xs sm:min-h-9 sm:text-sm"
						>
							{site.nom}
						</TabsTrigger>
					))}
				</TabsList>

				{sites.map((site) => {
					const stats = parDomaine.get(site.domaine);
					return (
						<TabsContent
							key={site.domaine}
							value={site.domaine}
							className="mt-6 space-y-6 focus-visible:outline-hidden"
						>
							<Card>
								<CardHeader>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<CardTitle className="flex flex-wrap items-center gap-2">
												{site.nom}
												<Link
													href={`https://${site.domaine}`}
													target="_blank"
													rel="noreferrer"
													className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground"
												>
													{site.domaine}
													<ExternalLink className="size-3.5" aria-hidden />
												</Link>
												{!site.local && (
													<Badge variant="outline" className="text-muted-foreground">
														Serveur distant
													</Badge>
												)}
											</CardTitle>
											<CardDescription>{site.role}</CardDescription>
										</div>
										<Disponibilite statut={site.statut} />
									</div>
								</CardHeader>

								<CardContent className="space-y-6">
									{stats ? (
										<CarteAudience stats={stats} />
									) : (
										<p className="text-sm text-muted-foreground">
											{site.local
												? "Aucune requête enregistrée sur cette période."
												: "Second serveur : sa collecte n'a pas encore tourné. La tâche `stats:achillea` s'exécute toutes les quinze minutes."}
										</p>
									)}

									{site.metriques.length > 0 && (
										<div>
											<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
												<Users className="size-4 text-muted-foreground" aria-hidden />
												Contenu
											</h3>
											<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
												{site.metriques.map((m) => (
													<div key={m.label} className="rounded-lg border border-border p-3">
														<p className="text-xs text-muted-foreground">{m.label}</p>
														<p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
															{typeof m.valeur === "number" ? nombre(m.valeur) : m.valeur}
														</p>
														{m.detail && (
															<p className="mt-0.5 text-[11px] text-muted-foreground">{m.detail}</p>
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{stats && stats.topChemins.length > 0 && (
										<div className="grid gap-6 lg:grid-cols-2">
											<div>
												<h3 className="mb-2 text-sm font-semibold text-foreground">
													Pages les plus demandées
												</h3>
												<ul className="space-y-1">
													{stats.topChemins.map((c) => (
														<li
															key={c.chemin}
															className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5"
														>
															<span className="truncate font-mono text-xs text-foreground">
																{c.chemin}
															</span>
															<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
																{nombre(c.requetes)}
															</span>
														</li>
													))}
												</ul>
											</div>

											<div>
												<h3 className="mb-2 text-sm font-semibold text-foreground">Provenance</h3>
												{stats.topReferents.length > 0 ? (
													<ul className="space-y-1">
														{stats.topReferents.map((r) => (
															<li
																key={r.referent}
																className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5"
															>
																<span className="truncate text-xs text-foreground">
																	{r.referent}
																</span>
																<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
																	{nombre(r.requetes)}
																</span>
															</li>
														))}
													</ul>
												) : (
													<p className="text-sm text-muted-foreground">
														Aucun référent : accès directs, marque-pages ou robots.
													</p>
												)}
												{stats.tauxCache !== null && (
													<p className="mt-3 text-xs text-muted-foreground">
														Cache nginx : {(stats.tauxCache * 100).toFixed(0)} % des réponses
														cachables servies sans toucher l'origine.
													</p>
												)}
											</div>
										</div>
									)}
								</CardContent>
							</Card>
						</TabsContent>
					);
				})}
			</Tabs>

			{autres.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Autres hôtes vus dans le journal</CardTitle>
						<CardDescription>
							Sous-domaines techniques ou requêtes adressées à un hôte non répertorié.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-1">
						{autres.map((d) => (
							<div
								key={d.host}
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
							>
								<span className="font-mono text-xs text-foreground">{d.host}</span>
								<span className="text-xs text-muted-foreground">
									{nombre(d.requetes)} requêtes · {nombre(d.visiteurs)} visiteurs ·{" "}
									{formatBytes(d.octets)}
								</span>
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
