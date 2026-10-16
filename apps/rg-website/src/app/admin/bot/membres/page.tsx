import { Trophy } from "lucide-react";

import {
	AdminPageHeader,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@rosegriffon/ui";
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { classementMembres, couvertureImport, estTriMembres } from "@/lib/bot/membres";

import { TableauMembres } from "./TableauMembres";

export const dynamic = "force-dynamic";

export const metadata = {
	description:
		"Classement des membres : expérience, niveau, messages et jetons Kizuna, avec la provenance de chaque valeur.",
	title: "Membres — Administration du bot",
};

/**
 * Le classement de communauté.
 *
 * ── LA PAGE QUI MANQUAIT ───────────────────────────────────────────────────
 * Les données existaient (`bot_profils`, alimentée par trois imports
 * successifs) mais ne se voyaient que depuis Discord, dix lignes à la fois,
 * dans l'embed de `/classement`. Le staff n'avait aucun moyen de regarder la
 * distribution complète, ni de savoir quelles valeurs sont fiables.
 *
 * ── LA COUVERTURE EST AFFICHÉE, PAS SUPPOSÉE ───────────────────────────────
 * L'en-tête dit combien de membres ont de l'XP sur combien d'humains présents,
 * et d'où viennent les archives. C'est la seule façon de répondre honnêtement à
 * « est-ce que l'import est fini ? » — la question qu'on se pose vraiment en
 * ouvrant cette page.
 */
export default async function MembresPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string; tri?: string }>;
}) {
	const parametres = await searchParams;
	const page = Number(parametres.page);
	const tri = estTriMembres(parametres.tri) ? parametres.tri : "xp";

	const [classement, couverture] = await Promise.all([
		classementMembres(RG_GUILD_ID, {
			page: Number.isFinite(page) && page > 0 ? page : 1,
			tri,
		}),
		couvertureImport(RG_GUILD_ID),
	]);

	const pourcentage =
		couverture.humains > 0 ? Math.round((couverture.avecXp / couverture.humains) * 100) : 0;

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				breadcrumbs={[
					{ href: "/admin", label: "Administration" },
					{ href: "/admin/bot", label: "Bot Discord" },
					{ label: "Membres" },
				]}
				icon={<Trophy className="size-5" />}
				title="Classement des membres"
				description="Expérience, niveau, messages et jetons Kizuna — avec la provenance de chaque valeur."
			/>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Couverture des données</CardTitle>
					<CardDescription>
						{couverture.avecXp} membre(s) avec de l&apos;expérience sur {couverture.humains}{" "}
						humain(s) présent(s) — {pourcentage} %.
						{couverture.dernierImportLe
							? ` Dernier import Noctaly le ${new Date(couverture.dernierImportLe).toLocaleString("fr-FR")}.`
							: " Aucun import Noctaly enregistré."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
						<div>
							<dt className="text-xs text-muted-foreground">Archives Noctaly</dt>
							<dd className="font-medium">{couverture.archives}</dd>
						</div>
						<div>
							<dt className="text-xs text-muted-foreground">dont API</dt>
							<dd className="font-medium">{couverture.archivesApi}</dd>
						</div>
						<div>
							<dt className="text-xs text-muted-foreground">dont classement public</dt>
							<dd className="font-medium">{couverture.archivesClassement}</dd>
						</div>
						<div>
							<dt className="text-xs text-muted-foreground">Niveau le plus haut</dt>
							<dd className="font-medium">{couverture.niveauMax}</dd>
						</div>
						<div className="col-span-2">
							<dt className="text-xs text-muted-foreground">Expérience cumulée</dt>
							<dd className="font-medium">{couverture.xpTotale.toLocaleString("fr-FR")}</dd>
						</div>
					</dl>
				</CardContent>
			</Card>

			<TableauMembres page={classement} />
		</div>
	);
}
