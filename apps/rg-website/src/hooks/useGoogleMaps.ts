import { useEffect, useState } from "react";

import type { importLibrary as ImportLibraryFn } from "@googlemaps/js-api-loader";

// Le module `@googlemaps/js-api-loader` touche le runtime navigateur dès son
// évaluation : un `import` statique en tête de fichier s'exécutait au prérendu
// statique (SSG) de toute page important une carte → « ReferenceError: window is
// not defined » (cassait le build de /evenements, /epita-map…). On charge donc le
// loader paresseusement, côté client uniquement (dans l'effet), et on le configure
// une seule fois.
let loaderConfigured = false;

export const useGoogleMaps = () => {
	const [isLoaded, setIsLoaded] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [importLibrary, setImportLibrary] = useState<typeof ImportLibraryFn | null>(null);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const loader = await import("@googlemaps/js-api-loader");
				if (!loaderConfigured) {
					loader.setOptions({
						key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
						libraries: ["marker", "places"],
						v: "weekly",
					});
					loaderConfigured = true;
				}
				if (cancelled) return;
				setImportLibrary(() => loader.importLibrary);
				await loader.importLibrary("maps");
				if (!cancelled) setIsLoaded(true);
			} catch (err: unknown) {
				if (!cancelled) setError(err as Error);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return { error, isLoaded, importLibrary };
};
