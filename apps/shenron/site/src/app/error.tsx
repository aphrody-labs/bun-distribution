"use client";

import { useEffect } from "react";
import Link from "next/link";

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
		<div className="container mx-auto px-4 py-24 max-w-2xl text-center">
			<div className="dbz-panel p-12 border-l-4 border-fuchsia-500">
				<p className="font-scouter text-xs tracking-[0.5em] text-fuchsia-300 mb-4">
					❯ ANOMALIE COSMIQUE ❮
				</p>
				<h1 className="title-jagged text-5xl md:text-7xl leading-none mb-6">ERREUR</h1>
				<p className="text-white/70 mb-2">Quelque chose s'est mal passé.</p>
				{error.digest && (
					<p className="text-xs text-white/50 font-mono mb-6">digest: {error.digest}</p>
				)}
				<div className="flex items-center justify-center gap-3 mt-6">
					<button type="button" onClick={() => reset()} className="dbz-button !text-xs">
						Réessayer
					</button>
					<Link href="/" className="dbz-button-ghost !text-xs">
						Accueil
					</Link>
				</div>
			</div>
		</div>
	);
}
