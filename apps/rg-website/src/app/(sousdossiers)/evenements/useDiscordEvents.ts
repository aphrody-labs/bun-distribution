"use client";

import { useQuery } from "@tanstack/react-query";

import { createLogger } from "@/lib/logger";

const logger = createLogger("Discord Events Hook");

// Statuts des événements Discord
export type DiscordEventStatus = 1 | 2 | 3 | 4; // SCHEDULED, ACTIVE, COMPLETED, CANCELED

// Types d'entité
export type DiscordEventEntityType = 1 | 2 | 3; // STAGE_INSTANCE, VOICE, EXTERNAL

export interface DiscordScheduledEvent {
  id: string;
  name: string;
  description: string;
  scheduledStartTime: string;
  scheduledEndTime: string | null;
  status: DiscordEventStatus;
  entityType: DiscordEventEntityType;
  entityMetadata: {
    location?: string;
  };
  creator: {
    id: string;
    username: string;
    avatar: string;
  } | null;
  userCount: number;
  image: string | null;
}

/**
 * Récupère les événements programmés depuis l'API Discord
 */
async function fetchDiscordScheduledEvents(): Promise<DiscordScheduledEvent[]> {
  try {
    const response = await fetch("/api/discord/scheduled-events");

    if (!response.ok) {
      throw new Error(`Erreur lors de la récupération des événements Discord: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !data.data?.events) {
      logger.error("Format de réponse invalide", { data });
      return [];
    }

    return data.data.events;
  } catch (error) {
    logger.error("Erreur lors de la récupération des événements Discord", {
      error,
    });
    return [];
  }
}

/**
 * Hook pour récupérer les événements programmés du serveur Discord
 *
 * @returns {Object} - { events: DiscordScheduledEvent[], isLoading: boolean, error: Error | null }
 */
export function useDiscordEvents() {
  const { data, isLoading, error } = useQuery<DiscordScheduledEvent[]>({
    gcTime: 1000 * 60 * 30, // Gardé en cache pendant 30 minutes
    queryFn: fetchDiscordScheduledEvents,
    queryKey: ["discord-scheduled-events"],
    staleTime: 1000 * 60 * 5, // Considéré frais pendant 5 minutes
  });

  if (error) {
    logger.error("Erreur dans le hook Discord Events", { error });
  }

  const events = Array.isArray(data) ? data : [];

  return { error: error as Error | null, events, isLoading };
}

/**
 * Obtient le statut en français d'un événement Discord
 */
export function getEventStatusLabel(status: DiscordEventStatus): string {
  switch (status) {
    case 1: {
      return "Programmé";
    }
    case 2: {
      return "En cours";
    }
    case 3: {
      return "Terminé";
    }
    case 4: {
      return "Annulé";
    }
    default: {
      return "Inconnu";
    }
  }
}

/**
 * Obtient la couleur associée au statut
 */
export function getEventStatusColor(status: DiscordEventStatus): string {
  switch (status) {
    case 1: {
      return "blue";
    }
    case 2: {
      return "green";
    }
    case 3: {
      return "gray";
    }
    case 4: {
      return "red";
    }
    default: {
      return "gray";
    }
  }
}
