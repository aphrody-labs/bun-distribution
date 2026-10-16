"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { useProfileSync } from "@/hooks/use-profile-sync";
import { getCurrentPublicProfile } from "@/app/settings/actions";
import type { PublicProfile } from "@rosegriffon/db";

// Le client navigateur (clé anon) ne peut lire QUE les colonnes publiques :
// typer le contexte avec la ligne complète promettait des champs (adresse,
// e-mail) que la requête ne ramène jamais.
type Profile = PublicProfile;

interface ProfileContextType {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

/**
 * Provider du profil utilisateur avec synchronisation en temps réel
 * Écoute les changements broadcast du profil
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Récupérer le profil initial
  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const data = await getCurrentPublicProfile();
      if (!data) {
        console.error("[ProfileProvider] Profil introuvable");
        setError("Profil introuvable");
        setProfile(null);
        return;
      }

      setProfile(data);
      setError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";
      console.error("[ProfileProvider] Erreur inattendue:", error);
      setError(errorMessage);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Charger le profil au montage et quand l'utilisateur change
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchProfile();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchProfile]);

  // Écouter les changements broadcast du profil
  useProfileSync({
    enabled: !!user?.id,
    onProfileChange: updatedProfile => {
      console.warn("[ProfileProvider] Profil mis à jour via broadcast:", updatedProfile);
      setProfile(updatedProfile);
      setError(null);
    },
    userId: user?.id,
  });

  const value: ProfileContextType = {
    error,
    isLoading: authLoading || isLoading,
    profile,
    refreshProfile: fetchProfile,
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/**
 * Hook pour accéder au contexte du profil
 */
export function useProfile(): ProfileContextType {
  const context = useContext(ProfileContext);

  if (context === undefined) {
    throw new Error("useProfile doit être utilisé dans un ProfileProvider");
  }

  return context;
}
