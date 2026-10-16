"use client";

export const dynamic = "force-dynamic";

import {
	Alert,
	AlertDescription,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@rosegriffon/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AlertCircle, ArrowLeft } from "@/lib/icons-config";

export default function AuthCodeErrorPage() {
	const searchParams = useSearchParams();
	const error = searchParams?.get("error");
	const errorDescription = searchParams?.get("error_description");

	const displayError = error || errorDescription || "Lien d'authentification invalide ou expiré";

	return (
		<div className="w-full min-h-[calc(100vh-10rem)] flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900/50">
			<Card className="w-full max-w-md shadow-lg border-red-200 dark:border-red-800">
				<CardHeader className="text-center">
					<CardTitle className="text-2xl text-red-600 dark:text-red-400">
						Erreur d'authentification
					</CardTitle>
					<CardDescription>Une erreur s'est produite lors de la connexion</CardDescription>
				</CardHeader>

				<CardContent className="space-y-6">
					<Alert variant="destructive">
						<AlertCircle className="size-4" />
						<AlertDescription>{displayError}</AlertDescription>
					</Alert>

					<div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
						<p className="font-semibold">Cela peut se produire si :</p>
						<ul className="list-disc list-inside space-y-2">
							<li>Le lien a expiré (après 24h)</li>
							<li>Vous avez fermé le navigateur en cours d'authentification</li>
							<li>Il y a un problème de connexion</li>
							<li>Vous avez modifié le lien</li>
						</ul>
					</div>

					<div className="flex gap-3">
						<Link href="/login" className="flex-1">
							<Button className="w-full gap-2">
								<ArrowLeft className="size-4" />
								Retour à la connexion
							</Button>
						</Link>
					</div>

					<p className="text-xs text-gray-500 dark:text-gray-500 text-center">
						Si le problème persiste, contactez le support
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
