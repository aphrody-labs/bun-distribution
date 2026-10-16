import { AlertTriangle, CheckCircle2, Timer, XCircle } from "lucide-react";

import {
	AdminPageHeader,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@rosegriffon/ui";

import { requireAdmin } from "@/lib/auth-helpers";
import { etatDuCron, historiqueDuCron } from "@/lib/bot/cron";

import { TableauTaches } from "./TableauTaches";

export const dynamic = "force-dynamic";

export const metadata = {
	description:
		"Les tâches planifiées de rg-cron.service : planification, portée et déclenchement manuel.",
	title: "Tâches planifiées — Administration",
};

function duree(secondes: number): string {
	if (secondes < 60) {
		return `${Math.round(secondes)} s`;
	}
	const minutes = Math.floor(secondes / 60);
	if (minutes < 60) {
		return `${minutes} min`;
	}
	const heures = Math.floor(minutes / 60);
	return heures < 24 ? `${heures} h ${minutes % 60} min` : `${Math.floor(heures / 24)} j`;
}

function dureeMs(millisecondes: number): string {
	return duree(Math.max(0, millisecondes) / 1000);
}

/**
 * L'ordonnanceur, vu depuis le site.
 *
 * Le catalogue est celui de `@rosegriffon/types/cron`, partagé avec le démon et
 * avec les commandes `/cron` du bot. Les trois surfaces ne peuvent donc plus
 * diverger — c'était exactement le défaut d'avant : dix-huit tâches connues du
 * bot pour vingt-deux servies, si bien que quatre tâches parfaitement
 * fonctionnelles répondaient « tâche inconnue ».
 */
export default async function CronPage() {
	const { role } = await requireAdmin();
	const [cron, historique] = await Promise.all([etatDuCron(), historiqueDuCron()]);

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				breadcrumbs={[
					{ href: "/admin", label: "Administration" },
					{ href: "/admin/bot", label: "Bot Discord" },
					{ label: "Tâches planifiées" },
				]}
				icon={<Timer className="size-5" />}
				title="Tâches planifiées"
				description="rg-cron.service — ce qui tourne tout seul, et ce qu'on peut relancer à la main."
			/>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						{cron.joignable ? (
							<CheckCircle2 className="size-4 text-succes" aria-hidden />
						) : (
							<XCircle className="size-4 text-destructive" aria-hidden />
						)}
						Ordonnanceur
					</CardTitle>
					<CardDescription>
						{cron.joignable && cron.sante
							? `En ligne depuis ${duree(cron.sante.uptime)} · ${cron.sante.wsConnections} client(s) attaché(s) au flux de journaux · ${cron.taches.length} tâches au catalogue.`
							: (cron.erreur ??
								"Injoignable. Les tâches ci-dessous sont celles du catalogue partagé, pas celles que le démon sert.")}
					</CardDescription>
				</CardHeader>
				{cron.catalogueDesynchronise && (
					<CardContent>
						<p className="flex items-start gap-2 text-sm text-alerte">
							<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
							Le démon sert une liste plus ancienne que celle du site : il tourne sur des sources
							antérieures au catalogue partagé. Redémarre <code>rg-cron.service</code> après
							déploiement.
						</p>
					</CardContent>
				)}
			</Card>

			<TableauTaches taches={cron.taches} role={role} cronJoignable={cron.joignable} />

			<Card>
				<CardHeader>
					<CardTitle>Dernières exécutions</CardTitle>
					<CardDescription>
						Historique persistant PostgreSQL, alimenté nativement par <code>rg-cron</code>.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{historique.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Aucune exécution disponible : vérifier la migration <code>cron_executions</code>.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead className="border-b text-xs text-muted-foreground">
									<tr>
										<th className="px-2 py-2 font-medium">Tâche</th>
										<th className="px-2 py-2 font-medium">État</th>
										<th className="px-2 py-2 font-medium">Durée</th>
										<th className="px-2 py-2 font-medium">Début</th>
									</tr>
								</thead>
								<tbody>
									{historique.map((execution, index) => (
										<tr key={`${execution.demarre_le}-${execution.tache}-${index}`} className="border-b last:border-0">
											<td className="px-2 py-2 font-mono text-xs">{execution.tache}</td>
											<td className={`px-2 py-2 ${execution.succes ? "text-succes" : "text-destructive"}`}>
												{execution.succes ? "Réussie" : "Échec"}
											</td>
											<td className="px-2 py-2">{dureeMs(execution.duree_ms)}</td>
											<td className="px-2 py-2 text-muted-foreground">
												{new Date(execution.demarre_le).toLocaleString("fr-FR")}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
