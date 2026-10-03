"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { CalendarEvent } from "@/types/api";

// Types d'événements
export type EventType = "upcoming" | "past" | "today";
export type EventCategory = "Meet-up" | "Stand artiste RG" | "Stand associatif" | "Conventions";

// Interface pour les données d'événement
export interface EventData {
  name: string;
  location: string;
  date: string;
  startDate: Date;
  endDate: Date;
  startDateFormatted: string;
  endDateFormatted: string;
  description: string;
  type: EventType;
  category: EventCategory;
  position?: { lat: number; lng: number };
  needsGeocoding?: boolean;
}

// Fonction pour déterminer la catégorie d'un événement à partir de sa description
function getCategoryFromDescription(description: string): EventCategory {
  const lowerDesc = description.toLowerCase();

  if (lowerDesc.includes("meet-up") || lowerDesc.includes("meetup")) {
    return "Meet-up";
  } else if (lowerDesc.includes("stand artiste") || lowerDesc.includes("artiste rg")) {
    return "Stand artiste RG";
  } else if (lowerDesc.includes("stand associatif")) {
    return "Stand associatif";
  }
  return "Conventions";
}

// Fonction pour géocoder une adresse avec Nominatim (OpenStreetMap)
async function geocodeWithNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encodedAddress = encodeURIComponent(address);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1&countrycodes=fr`,
      {
        headers: {
          "User-Agent": "RoseGriffon-Website/1.0",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: Number.parseFloat(data[0].lat),
        lng: Number.parseFloat(data[0].lon),
      };
    }
    return null;
  } catch (error) {
    console.error(`Erreur lors du géocodage avec Nominatim: ${error}`);
    return null;
  }
}

// Fonction pour récupérer les événements depuis Google Calendar
async function fetchGoogleCalendarEvents(): Promise<EventData[]> {
  try {
    // Appel à l'API route qui gérera l'authentification et l'appel à Google Calendar API
    const response = await fetch("/api/calendar-events");

    if (!response.ok) {
      throw new Error("Erreur lors de la récupération des événements");
    }

    const data = await response.json();

    // La réponse est encapsulée dans { success: true, data: { events: [] } }
    const eventsData = data.data?.events || [];

    // Vérifier que les événements existent et sont un tableau
    if (!Array.isArray(eventsData)) {
      console.error("Format de réponse invalide:", data);
      return [];
    }

    // Transformer les données Google Calendar en format EventData
    return eventsData.map((event: CalendarEvent) => {
      // Déterminer le type d'événement basé sur la date
      const now = new Date();

      // Gestion des dates (format dateTime ou date)
      let eventStart: Date;
      let eventEnd: Date;

      if (event.start?.dateTime) {
        eventStart = new Date(event.start.dateTime);
      } else if (event.start?.date) {
        eventStart = new Date(event.start.date);
      } else {
        eventStart = new Date(); // Fallback au cas où
      }

      if (event.end?.dateTime) {
        eventEnd = new Date(event.end.dateTime);
      } else if (event.end?.date) {
        eventEnd = new Date(event.end.date);
      } else {
        eventEnd = new Date(); // Fallback au cas où
      }

      let type: EventType = "upcoming";
      if (eventEnd < now) {
        type = "past";
      } else if (eventStart <= now && eventEnd >= now) {
        type = "today";
      }

      // Formater la date pour l'affichage
      const dateOptions: Intl.DateTimeFormatOptions = {
        day: "numeric",
        month: "long",
        year: "numeric",
      };

      const timeOptions: Intl.DateTimeFormatOptions = {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "long",
        year: "numeric",
      };

      // Gestion des erreurs de formatage de date
      let formattedDate: string;
      let startDateFormatted: string;
      let endDateFormatted: string;

      try {
        formattedDate = eventStart.toLocaleDateString("fr-FR", dateOptions);

        // Formater les dates de début et de fin avec l'heure si disponible
        if (event.start?.dateTime) {
          startDateFormatted = eventStart.toLocaleString("fr-FR", timeOptions);
        } else {
          startDateFormatted = eventStart.toLocaleDateString("fr-FR", dateOptions);
        }

        if (event.end?.dateTime) {
          endDateFormatted = eventEnd.toLocaleString("fr-FR", timeOptions);
        } else {
          endDateFormatted = eventEnd.toLocaleDateString("fr-FR", dateOptions);
        }

        // Vérifier si les dates sont valides
        if (formattedDate === "Invalid Date") {
          formattedDate = "Date non spécifiée";
          startDateFormatted = "Date non spécifiée";
          endDateFormatted = "Date non spécifiée";
        }
      } catch (error) {
        formattedDate = "Date non spécifiée";
        startDateFormatted = "Date non spécifiée";
        endDateFormatted = "Date non spécifiée";
        console.error("Erreur lors du formatage de la date:", error);
      }

      // Déterminer la catégorie à partir de la description
      const eventCategory = event.description
        ? getCategoryFromDescription(event.description)
        : "Conventions";

      // Extraire les coordonnées de la description (format: lat:48.8566,lng:2.3522)
      let lat = 46.603_354; // Centre de la France par défaut
      let lng = 1.888_334;
      let coordsFound = false;

      if (event.description) {
        const coordsMatch = event.description.match(/lat:([\d.-]+),lng:([\d.-]+)/);
        if (coordsMatch && coordsMatch.length >= 3 && coordsMatch[1] && coordsMatch[2]) {
          lat = Number.parseFloat(coordsMatch[1]);
          lng = Number.parseFloat(coordsMatch[2]);
          coordsFound = true;
        }
      }

      return {
        category: eventCategory,
        date: formattedDate,
        description: event.description || "Pas de description disponible",
        endDate: eventEnd,
        endDateFormatted,
        location: event.location || "Lieu non précisé",
        name: event.summary || "Événement sans titre",
        needsGeocoding: !coordsFound && !!event.location && event.location.trim() !== "",
        position: { lat, lng },
        startDate: eventStart,
        startDateFormatted,
        type,
      };
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des événements:", error);
    return [];
  }
}

/**
 * Hook pour récupérer les événements depuis Google Calendar
 *
 * @returns {Object} - { events: EventData[], isLoading: boolean }
 */
export function useEvents() {
  const [geocoded, setGeocoded] = useState<{ source: EventData[]; events: EventData[] } | null>(
    null,
  );

  const { data, isLoading, error } = useQuery<EventData[]>({
    gcTime: 1000 * 60 * 30,
    queryFn: fetchGoogleCalendarEvents,
    queryKey: ["events"],
    staleTime: 1000 * 60 * 5,
  });

  const isGeocoding = !!data?.some((event) => event.needsGeocoding) && geocoded?.source !== data;
  useEffect(() => {
    if (!data || !data.some((event) => event.needsGeocoding)) return;
    let cancelled = false;
    const processGeocoding = async () => {
      const updated = [...data];
      let requests = 0;
      for (let i = 0; i < updated.length; i++) {
        const current = updated[i];
        if (!current?.needsGeocoding) continue;
        if (requests > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
        if (cancelled) return;
        const coords = await geocodeWithNominatim(current.location);
        requests++;
        if (cancelled) return;
        if (coords) updated[i] = { ...current, needsGeocoding: false, position: coords };
      }
      if (!cancelled) setGeocoded({ source: data, events: updated });
    };
    void processGeocoding().catch((cause) => {
      if (!cancelled) {
        console.error("Failed to geocode events:", cause);
        setGeocoded({ source: data, events: data });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) {
    console.error("Failed to fetch events:", error);
  }

  return {
    events: geocoded && geocoded.source === data ? geocoded.events : data || [],
    isLoading: isLoading || isGeocoding,
  };
}
