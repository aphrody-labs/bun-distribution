"use client";

import { useEffect, useRef } from "react";

import { useGoogleMaps } from "@/hooks/useGoogleMaps";
import { EPITA_COORDS, EPITA_PLACE_ID, GOOGLE_MAPS_ID } from "@/lib/maps";

export default function GoogleMapEpita() {
	const mapRef = useRef<HTMLDivElement>(null);
	const { isLoaded, error, importLibrary } = useGoogleMaps();

	useEffect(() => {
		if (!isLoaded || !importLibrary || !mapRef.current) {
			return;
		}

		const initMap = async () => {
			try {
				const { Map } = await importLibrary("maps");
				const { AdvancedMarkerElement, PinElement } = (await importLibrary(
					"marker"
				)) as google.maps.MarkerLibrary;

				const map = new Map(mapRef.current as HTMLElement, {
					center: EPITA_COORDS,
					disableDefaultUI: false,
					gestureHandling: "cooperative", // Meilleure UX sur mobile
					mapId: GOOGLE_MAPS_ID,
					zoom: 18, // Zoom élevé pour voir les bâtiments
				});

				// Personnalisation du pin pour correspondre à l'identité visuelle (optionnel)
				const pin = new PinElement({
					background: "#1d4ed8", // Blue-700
					borderColor: "#1e3a8a", // Blue-900
					glyphColor: "white",
				});

				// Création du marqueur avancé
				const marker = new AdvancedMarkerElement({
					content: pin.element,
					map,
					position: EPITA_COORDS,
					title: "EPITA Kremlin-Bicêtre",
				});

				// Ajout d'un événement au clic pour ouvrir Google Maps avec le Place ID spécifique
				marker.addListener("click", () => {
					const url = `https://www.google.com/maps/search/?api=1&query=EPITA&query_place_id=${EPITA_PLACE_ID}`;
					window.open(url, "_blank");
				});
			} catch (error) {
				console.error("Erreur lors du chargement de Google Maps:", error);
			}
		};

		initMap();
	}, [isLoaded, importLibrary]);

	if (error) {
		return (
			<div className="w-full h-96 flex items-center justify-center bg-gray-50 rounded-xl border border-red-200">
				<p className="text-red-600 font-medium px-4 text-center">
					Impossible de charger la carte. Vérifiez votre connexion ou la clé API.
				</p>
			</div>
		);
	}

	return (
		<div
			ref={mapRef}
			className="w-full h-[500px] rounded-xl shadow-lg border border-gray-200 overflow-hidden"
			aria-label="Carte de localisation de l'EPITA"
		/>
	);
}
