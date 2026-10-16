"use client";

import { useCallback, useMemo, useState } from "react";
import { Ban, Loader2, Play, ShieldAlert } from "lucide-react";

import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@rosegriffon/ui";
import {
	FAMILLES_TACHES,
	peutDeclencher,
	type DescriptionTache,
	type FamilleTache,
} from "@rosegriffon/types/cron";

/** Libellés des familles — l'ordre du tableau de bord. */
const LIBELLES_FAMILLES: Readonly<Record<FamilleTache, string>> = {
	donnees: "Données et caches",
	discord: "Discord",
	campagnes: "Campagnes et veille",
	patreon: "Patreon",
	seo: "Référencement",
	publication: "Publication",
	stats: "Statistiques",
	qa: "Qualité et QA",
};

type Retour = { statut: "ok" | "erreur"; message: string };

/**
 * Les tâches de `rg-cron.service`, avec leur bouton de déclenchement.
 *
 * ── LE BOUTON ABSENT N'EST PAS LA GARDE ────────────────────────────────────
 * Une tâche interdite ou hors de portée du rôle n'affiche pas de bouton, mais
 * ce n'est qu'une politesse : la vraie garde est côté serveur
 * (`/api/admin/cron/lancer` relit le catalogue). Cacher un bouton n'a jamais
 * empêché personne de poster la requête à la main.
 *
 * ── « DÉMARRÉE », JAMAIS « RÉUSSIE » ───────────────────────────────────────
 * Le démon lance en tâche de fond et répond immédiatement. Prétendre que la
 * tâche a réussi enverrait chercher un résultat qui n'existe pas encore —
 * certaines durent plusieurs minutes.
 */
export function TableauTaches({
	taches,
	role,
	cronJoignable,
}: {
	taches: readonly DescriptionTache[];
	role: string | null;
	cronJoignable: boolean;
}) {
	const [enCours, setEnCours] = useState<string | null>(null);
	const [retours, setRetours] = useState<Record<string, Retour>>({});

	const lancer = useCallback(async (nom: string) => {
		setEnCours(nom);
		try {
			const reponse = await fetch("/api/admin/cron/lancer", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ tache: nom }),
			});
			const charge = (await reponse.json()) as { message?: string; error?: string };
			setRetours((precedent) => ({
				...precedent,
				[nom]: {
					statut: reponse.ok ? "ok" : "erreur",
					message: charge.message ?? charge.error ?? `HTTP ${reponse.status}`,
				},
			}));
		} catch (erreur) {
			setRetours((precedent) => ({
				...precedent,
				[nom]: {
					statut: "erreur",
					message: erreur instanceof Error ? erreur.message : String(erreur),
				},
			}));
		} finally {
			setEnCours(null);
		}
	}, []);

	const parFamille = useMemo(() => {
		return FAMILLES_TACHES.map((famille) => ({
			famille,
			taches: taches.filter((tache) => tache.famille === famille),
		})).filter((groupe) => groupe.taches.length > 0);
	}, [taches]);

	return (
		<div className="space-y-8">
			{parFamille.map(({ famille, taches: liste }) => (
				<section key={famille} className="space-y-3">
					<h2 className="text-lg font-semibold">{LIBELLES_FAMILLES[famille]}</h2>
					<div className="grid gap-3 md:grid-cols-2">
						{liste.map((tache) => {
							const autorisee = peutDeclencher(tache.nom, role);
							const retour = retours[tache.nom];
							return (
								<Card key={tache.nom}>
									<CardHeader className="pb-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<CardTitle className="text-base">{tache.titre}</CardTitle>
												<CardDescription className="mt-1">{tache.role}</CardDescription>
											</div>
											{tache.niveau === "interdit" ? (
												<Badge variant="outline" className="shrink-0 gap-1">
													<Ban className="size-3" aria-hidden />
													interdite
												</Badge>
											) : tache.niveau === "admin-strict" ? (
												<Badge variant="secondary" className="shrink-0 gap-1">
													<ShieldAlert className="size-3" aria-hidden />
													admin
												</Badge>
											) : (
												<Badge variant="outline" className="shrink-0">
													staff
												</Badge>
											)}
										</div>
									</CardHeader>
									<CardContent className="space-y-3">
										<dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
											<div className="flex gap-1.5">
												<dt>Nom :</dt>
												<dd className="font-mono text-foreground">{tache.nom}</dd>
											</div>
											<div className="flex gap-1.5">
												<dt>Planification :</dt>
												<dd className="font-mono text-foreground">
													{tache.planification === "manuel"
														? "manuelle"
														: tache.planification}
												</dd>
											</div>
											{tache.dureeIndicative && (
												<div className="flex gap-1.5">
													<dt>Durée :</dt>
													<dd className="text-foreground">{tache.dureeIndicative}</dd>
												</div>
											)}
										</dl>

										{tache.motifInterdiction ? (
											<p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
												Jamais déclenchable à distance : {tache.motifInterdiction}. Elle reste
												lançable en SSH.
											</p>
										) : (
											<Button
												size="sm"
												variant="outline"
												disabled={!autorisee || !cronJoignable || enCours === tache.nom}
												onClick={() => lancer(tache.nom)}
												title={
													!cronJoignable
														? "L'ordonnanceur est arrêté."
														: autorisee
															? undefined
															: "Ton rôle ne permet pas de déclencher cette tâche."
												}
											>
												{enCours === tache.nom ? (
													<Loader2 className="size-4 animate-spin" aria-hidden />
												) : (
													<Play className="size-4" aria-hidden />
												)}
												Lancer maintenant
											</Button>
										)}

										{retour && (
											<p
												className={`text-xs ${retour.statut === "ok" ? "text-succes" : "text-destructive"}`}
											>
												{retour.message}
											</p>
										)}
									</CardContent>
								</Card>
							);
						})}
					</div>
				</section>
			))}
		</div>
	);
}
