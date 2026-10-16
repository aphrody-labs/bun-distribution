import { Alert, AlertDescription, AlertTitle } from "@rosegriffon/ui";
import { AlertTriangle } from "lucide-react";

import { getAllTeamMembers } from "./actions";
import { StaffClientPage } from "./StaffClientPage";

export const dynamic = "force-dynamic";

export const metadata = {
	title: "Gestion du staff | Administration Rose Griffon",
};

export default async function StaffAdminPage() {
	const { data: members, error } = await getAllTeamMembers();

	return (
		<div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
			{/* L'erreur était silencieusement jetée : une base injoignable affichait
			    « Aucun membre pour le moment », indiscernable d'une base vide. */}
			{error && (
				<Alert variant="destructive" className="mb-6">
					<AlertTriangle className="size-4" />
					<AlertTitle>Impossible de charger les membres</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			<StaffClientPage initialMembers={members ?? []} />
		</div>
	);
}
