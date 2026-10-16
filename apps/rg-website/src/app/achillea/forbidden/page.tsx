import Link from "next/link";
import { Button } from "@rosegriffon/ui";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";

export const metadata = metadonneesAchillea({
	titre: "Accès refusé",
	description: "Vous n'avez pas les autorisations requises pour afficher cette ressource.",
	chemin: "/achillea/forbidden",
	indexable: false,
});

export default function AchilleaForbiddenPage() {
	return (
		<div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
			<div className="max-w-md w-full text-center space-y-6">
				<div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
					<ShieldAlert className="size-8" />
				</div>

				<div className="space-y-2">
					<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Accès Refusé</h1>
					<p className="text-sm text-muted-foreground">
						Vous ne possédez pas les autorisations nécessaires pour accéder à cette page ou effectuer
						cette action.
					</p>
				</div>

				<div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
					<Link href="/achillea">
						<Button variant="outline" className="gap-2">
							<ArrowLeft className="size-4" />
							Accueil Achilléa
						</Button>
					</Link>
					<Link href="/login?redirect=/achillea">
						<Button className="gap-2">Changer de compte</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}
