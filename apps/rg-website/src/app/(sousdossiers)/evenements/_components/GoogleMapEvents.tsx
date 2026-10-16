"use client";

import { useEffect, useRef } from "react";

import { useGoogleMaps } from "@/hooks/useGoogleMaps";
import { GOOGLE_MAPS_ID } from "@/lib/maps";

import type { EventData } from "../useEvents";

interface GoogleMapEventsProps {
  events: EventData[];
  isLoading: boolean;
}

export default function GoogleMapEvents({ events, isLoading }: GoogleMapEventsProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const { isLoaded, importLibrary } = useGoogleMaps();

  useEffect(() => {
    if (!isLoaded || !importLibrary || !mapRef.current) {
      return;
    }

    const initMap = async () => {
      try {
        const { Map } = await importLibrary("maps");
        const { AdvancedMarkerElement } = (await importLibrary("marker")) as google.maps.MarkerLibrary;

        const mapOptions = {
          center: { lat: 46.603354, lng: 1.888334 }, // Centre de la France
          mapId: GOOGLE_MAPS_ID, // Use the provided Map ID
          zoom: 5,
        };

        const map = new Map(mapRef.current as HTMLElement, mapOptions);
        const bounds = new google.maps.LatLngBounds();
        let hasValidMarkers = false;

        events.forEach(event => {
          if (!event.position) {
            return;
          }

          // Marqueurs et infobulle sont injectés en HTML brut dans le DOM de Google
          // Maps : Tailwind ne les atteint pas. On y branche donc directement les
          // variables CSS du thème, qui, elles, cascadent jusque-là.
          const markerColor =
            event.type === "upcoming"
              ? "var(--rg-succes)"
              : event.type === "today"
                ? "var(--rg-info)"
                : "var(--destructive)";

          let icon = "RG";
          switch (event.category) {
            case "Meet-up": {
              icon = "M";
              break;
            }
            case "Stand artiste RG": {
              icon = "A";
              break;
            }
            case "Stand associatif": {
              icon = "S";
              break;
            }
            case "Conventions": {
              icon = "C";
              break;
            }
          }

          const markerElement = document.createElement("div");
          markerElement.className = "marker-content";
          markerElement.innerHTML = `
            <div style="background-color: ${markerColor}; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--rg-sur-marine); font-weight: bold; border: 2px solid var(--rg-sur-marine); box-shadow: 0 2px 4px color-mix(in oklch, var(--foreground) 30%, transparent);">
              <span style="font-size: 14px;">${icon}</span>
            </div>
          `;

          const marker = new AdvancedMarkerElement({
            content: markerElement,
            map,
            position: event.position,
            title: event.name,
          });

          const infoContent = `
            <div style="padding: 12px; max-width: 250px; font-family: inherit;">
              <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 4px; color: var(--foreground);">${event.name}</h3>
              <p style="font-size: 13px; color: var(--muted-foreground); margin-bottom: 4px;">
                <strong>Date:</strong> ${event.date}
              </p>
              <p style="font-size: 13px; color: var(--muted-foreground); margin-bottom: 8px;">
                <strong>Lieu:</strong> ${event.location}
              </p>
              <div style="display: inline-block; padding: 2px 8px; border-radius: 12px; background-color: var(--muted); font-size: 11px; font-weight: 600; color: var(--muted-foreground);">
                ${event.category}
              </div>
            </div>
          `;

          const infoWindow = new google.maps.InfoWindow({
            content: infoContent,
          });

          marker.addListener("click", () => {
            infoWindow.open({
              anchor: marker,
              map,
            });
          });

          bounds.extend(event.position);
          hasValidMarkers = true;
        });

        if (hasValidMarkers && events.length > 1) {
          map.fitBounds(bounds);
        }
      } catch (error) {
        console.error("Erreur lors de l'initialisation de la carte:", error);
      }
    };

    initMap();
  }, [events, isLoaded, importLibrary]);

  const showLoading = isLoading || !isLoaded;

  return (
    <div className="relative w-full h-[400px] md:h-[500px] rounded-2xl overflow-hidden border-2 border-border shadow-inner bg-muted/40">
      {showLoading && (
        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full size-10 border-b-2 border-primary" />
            <p className="text-sm font-medium text-muted-foreground">
              {isLoading ? "Localisation des événements..." : "Chargement de la carte..."}
            </p>
          </div>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}
