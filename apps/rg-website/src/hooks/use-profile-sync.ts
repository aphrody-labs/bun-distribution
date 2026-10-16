"use client";

import { useEffect } from "react";

import { subscribeTable } from "@/lib/realtime";
import { getCurrentPublicProfile } from "@/app/settings/actions";
import type { PublicProfile } from "@rosegriffon/db/profiles";

type Profile = PublicProfile;

interface UseProfileSyncOptions {
  userId?: string | null;
  onProfileChange?: (profile: Profile) => void;
  enabled?: boolean;
}

/**
 * Hook pour synchroniser les changements de profil en temps réel
 * Écoute les événements INSERT, UPDATE, DELETE du table profiles
 */
export function useProfileSync({ userId, onProfileChange, enabled = true }: UseProfileSyncOptions) {
  useEffect(() => {
    // Ne pas s'abonner si pas d'userId ou si désactivé
    if (!userId || !enabled) return;
    let cancelled = false;

    // Le flux SSE de rg-realtime gère lui-même la reconnexion (EventSource) :
    // plus de machinerie de retry ni de statuts de canal à surveiller.
    const unsubscribe = subscribeTable<{ id: string }>({ filter: `id=eq.${userId}`, table: "profiles" }, event => {
      if (process.env.NODE_ENV === "development") {
        console.info("[useProfileSync] Changement reçu:", event.eventType);
      }

      if (event.eventType === "DELETE") {
        console.warn("[useProfileSync] Le profil a été supprimé");
        return;
      }

      if (event.new?.id === userId && onProfileChange) {
        void getCurrentPublicProfile()
          .then(profile => {
            if (!cancelled && profile?.id === userId) onProfileChange(profile);
          })
          .catch(error => console.error("[useProfileSync] Lecture du profil impossible", error));
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, enabled, onProfileChange]);
}
