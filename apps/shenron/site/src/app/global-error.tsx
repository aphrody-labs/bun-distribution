"use client";

import { useEffect } from "react";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<html lang="fr">
			<body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased flex flex-col items-center justify-center p-4">
				<div className="max-w-md w-full text-center p-8 bg-zinc-900 border border-zinc-800 rounded-lg">
					<h2 className="text-2xl font-bold text-red-500 mb-4">Une erreur critique est survenue</h2>
					<p className="text-zinc-400 mb-6">L'application a rencontré un problème inattendu.</p>
					<button
						type="button"
						onClick={() => reset()}
						className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition"
					>
						Réessayer
					</button>
				</div>
			</body>
		</html>
	);
}
