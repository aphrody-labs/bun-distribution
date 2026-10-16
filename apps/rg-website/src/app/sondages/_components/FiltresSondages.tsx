// Barre de filtres de la liste des sondages — composant serveur.
//
// Le formulaire est un `GET` natif : la recherche fonctionne sans hydratation,
// sans état client et reste partageable par simple copie de l'URL.

import { Button, Input } from "@rosegriffon/ui";
import { Search } from "lucide-react";
import Link from "next/link";

import type { StatutSondage } from "@/lib/discord/polls";

const ONGLETS: Array<{ statut: StatutSondage; libelle: string }> = [
	{ libelle: "Tous", statut: "tous" },
	{ libelle: "En cours", statut: "en-cours" },
	{ libelle: "Terminés", statut: "termines" },
];

/** Lien d'onglet : conserve la recherche en cours, repart à la page 1. */
function lienStatut(statut: StatutSondage, q: string): string {
	const params = new URLSearchParams();
	if (statut !== "tous") params.set("statut", statut);
	if (q) params.set("q", q);
	const requete = params.toString();
	return requete ? `/sondages?${requete}` : "/sondages";
}

export function FiltresSondages({
	q,
	statut,
	resultats,
	total,
	enCours,
}: {
	q: string;
	statut: StatutSondage;
	/** Sondages correspondant au filtre courant. */
	resultats: number;
	/** Sondages archivés, tous filtres confondus. */
	total: number;
	enCours: number;
}) {
	const filtre = q.length > 0 || statut !== "tous";
	return (
		<section
			aria-label="Filtrer les sondages"
			className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:p-6"
		>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<form action="/sondages" method="get" className="flex flex-col gap-2 xs:flex-row">
					{/* Le statut courant suit la recherche : filtrer puis chercher ne doit
					    pas silencieusement remettre la liste sur « Tous ». */}
					{statut !== "tous" && <input type="hidden" name="statut" value={statut} />}
					<label className="sr-only" htmlFor="recherche-sondage">
						Rechercher un mot dans la question
					</label>
					<Input
						id="recherche-sondage"
						type="search"
						name="q"
						defaultValue={q}
						placeholder="Rechercher une question…"
						maxLength={120}
						className="w-full xs:w-72"
					/>
					<Button type="submit" className="shrink-0">
						<Search className="size-4" aria-hidden />
						Rechercher
					</Button>
				</form>

				<nav aria-label="Filtrer par état" className="flex flex-wrap items-center gap-2">
					{ONGLETS.map((onglet) => {
						const actif = onglet.statut === statut;
						return (
							<Link
								key={onglet.statut}
								href={lienStatut(onglet.statut, q)}
								aria-current={actif ? "page" : undefined}
								className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
									actif
										? "border-transparent bg-primary text-primary-foreground"
										: "border-outline-variant/60 bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
								}`}
							>
								{onglet.libelle}
							</Link>
						);
					})}
				</nav>
			</div>

			<p aria-live="polite" className="mt-4 text-sm text-on-surface-variant">
				{filtre ? (
					<>
						<span className="font-semibold text-on-surface">
							{resultats} résultat{resultats > 1 ? "s" : ""}
						</span>{" "}
						sur {total} sondage{total > 1 ? "s" : ""} archivé{total > 1 ? "s" : ""}
					</>
				) : (
					<>
						{total} sondage{total > 1 ? "s" : ""} archivé{total > 1 ? "s" : ""}
						{/* « en cours » ne s'affiche que s'il y en a vraiment. Le compteur
						    portait auparavant les sondages sans état publié, ce qui annonçait
						    « 25 en cours » sur des sondages clos depuis 2023. */}
						{enCours > 0 && ` · ${enCours} en cours`}
					</>
				)}
			</p>
		</section>
	);
}
