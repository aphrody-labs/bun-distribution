import {
	AdminPageHeader,
	Badge,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@rosegriffon/ui";
import { Hash } from "lucide-react";
import Link from "next/link";

import {
	bilanCampagne,
	chargerCampagneAdmin,
	etatSalonsCampagne,
	listerCampagnesAdmin,
	listerCreationsAdmin,
} from "@/lib/x-campagnes/admin";
import { etatCampagne, libelleEtatCampagne } from "@/lib/x-campagnes/types";

import { GestionCampagne } from "./GestionCampagne";

/*
 * Poste de pilotage d'une campagne à hashtag.
 *
 * ── POURQUOI UN ÉCRAN, ALORS QUE TOUT ÉTAIT DÉJÀ PILOTABLE ─────────────────
 * Une campagne se pilotait par trois chemins qui ne se parlent pas : du SQL à la
 * main sur `x_campagnes`, une commande du bot, et trois CLI du paquet cron. Ils
 * fonctionnent tous — mais aucun ne montre l'ÉTAT, et c'est l'état qui coûte du
 * temps pendant une campagne : est-ce que la récolte tourne, est-ce que le salon
 * de dépôt est bien sous veille, combien de créations attendent le relais, quelle
 * création a été masquée et pourquoi.
 *
 * Cet écran ne remplace rien : il rassemble les quatre objets qui bougent —
 * la configuration, les deux salons Discord, les tâches cron, les créations — et
 * il les montre AVANT de proposer de les changer.
 *
 * `force-dynamic` + `revalidate = 0` : ce sont des compteurs d'exploitation. Une
 * page de suivi mise en cache est une page qui ment, et elle ment d'autant plus
 * qu'on la consulte au moment où quelque chose ne va pas.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
	description: "Suivi, configuration et modération d'une campagne à hashtag.",
	title: "IERG Day — Administration",
};

export default async function AdminIergDayPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = await searchParams;
	const slugDemande = typeof params.campagne === "string" ? params.campagne : undefined;

	const [campagne, campagnes] = await Promise.all([
		chargerCampagneAdmin(slugDemande),
		listerCampagnesAdmin(),
	]);

	// Aucune campagne en base : état légitime (table vide juste après migration).
	// On l'explique plutôt que de rendre un formulaire qui n'écrirait nulle part.
	if (!campagne) {
		return (
			<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
				<AdminPageHeader
					icon={<Hash className="size-5" />}
					title="Campagne à hashtag"
					description="Suivi, configuration et modération."
				/>
				<Card>
					<CardHeader>
						<CardTitle>Aucune campagne en base</CardTitle>
						<CardDescription>
							{slugDemande
								? `La campagne « ${slugDemande} » n'existe pas.`
								: "Aucune campagne n'est marquée comme principale dans « x_campagnes »."}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">
						Une campagne se crée par migration SQL (voir{" "}
						<code className="rounded bg-muted px-1.5 py-0.5">
							apps/website/sql/migrations/
						</code>
						). Cet écran administre une campagne existante, il n&apos;en crée pas — la création
						d&apos;une campagne engage un slug, une URL publique et des index.
					</CardContent>
				</Card>
			</div>
		);
	}

	const [salons, bilan, creations] = await Promise.all([
		etatSalonsCampagne(campagne),
		bilanCampagne(campagne),
		listerCreationsAdmin(campagne.slug, 40),
	]);

	const etat = etatCampagne(campagne);

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				icon={<Hash className="size-5" />}
				title={campagne.titre}
				description="Suivi, configuration, salons Discord, tâches cron et modération."
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={etat === "en-cours" ? "default" : "secondary"}>
							{libelleEtatCampagne(etat)}
						</Badge>
						<Badge variant={campagne.publiee ? "default" : "destructive"}>
							{campagne.publiee ? "Publiée" : "Non publiée"}
						</Badge>
						<Badge variant={campagne.actif ? "default" : "secondary"}>
							{campagne.actif ? "Récolte active" : "Récolte à l'arrêt"}
						</Badge>
						{/* La page publique dans un onglet à côté : on administre ce qu'on voit. */}
						<Link
							href={campagne.principale ? "/iergday" : `/iergday?campagne=${campagne.slug}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm font-medium text-primary underline underline-offset-4"
						>
							Voir la page publique
						</Link>
					</div>
				}
			/>

			<GestionCampagne
				campagne={campagne}
				campagnes={campagnes}
				salons={salons}
				bilan={bilan}
				creations={creations}
			/>
		</div>
	);
}
