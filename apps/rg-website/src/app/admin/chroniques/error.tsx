"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@rosegriffon/ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AlertCircle, RefreshCw } from "@/lib/icons-config";

export default function ChroniquesError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const router = useRouter();

	useEffect(() => {
		console.error("Chroniques Error:", error);
	}, [error]);

	return (
		<div className="container max-w-4xl py-10 space-y-6">
			<div className="flex flex-col items-center justify-center text-center space-y-4">
				<h2 className="text-2xl font-bold tracking-tight text-rg-rose">
					Une erreur est survenue
				</h2>
				<p className="text-muted-foreground max-w-lg">
					Nous avons rencontré un problème lors du chargement de cette page. Cela peut être dû à une
					erreur de connexion ou à un problème temporaire.
				</p>
			</div>

			<Alert variant="destructive" className="max-w-2xl mx-auto">
				<AlertCircle className="size-4" />
				<AlertTitle>Détails de l'erreur</AlertTitle>
				<AlertDescription className="mt-2 font-mono text-xs bg-red-950/10 p-2 rounded overflow-auto max-h-64">
					<div className="font-bold mb-2">{error.message || "Erreur inconnue"}</div>
					{error.digest && <div className="mb-2 text-xs opacity-70">Digest: {error.digest}</div>}
					{error.stack && (
						<div className="whitespace-pre-wrap opacity-70 border-t border-red-200/20 pt-2">
							{error.stack}
						</div>
					)}
				</AlertDescription>
			</Alert>

			<div className="flex justify-center gap-4">
				<Button onClick={() => router.push("/admin/chroniques")} variant="outline">
					Retour à la liste
				</Button>
				<Button onClick={() => reset()} variant="default">
					<RefreshCw className="mr-2 size-4" />
					Réessayer
				</Button>
			</div>
		</div>
	);
}
