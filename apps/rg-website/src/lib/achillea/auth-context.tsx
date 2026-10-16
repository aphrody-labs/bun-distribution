"use client";

import type { SessionUserDTO } from "@rosegriffon/achillea-types/domain/user";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { safeReturnUrl } from "./auth-session";
import { failedIdentityStatus } from "./auth-status";
import { createAchilleaClient } from "./client";

export type AchilleaAuthStatus = "unknown" | "loading" | "authenticated" | "anonymous" | "error";

export interface AchilleaAuthContextType {
  user: SessionUserDTO | null;
  status: AchilleaAuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Conduit à la connexion Rose Griffon — il n'y a plus de connexion Achilléa. */
  login: (returnUrl?: string) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AchilleaAuthContext = createContext<AchilleaAuthContextType | undefined>(undefined);

/**
 * Session Achilléa DÉRIVÉE de la session Rose Griffon.
 *
 * UN SEUL COMPTE
 * Ce fournisseur portait sa propre authentification : son bouton « Connexion »,
 * son OAuth Discord, sa déconnexion. Un membre connecté à Rose Griffon depuis
 * dix minutes se voyait donc proposer de se connecter une seconde fois en
 * arrivant sur `/achillea` — au même service, avec le même compte Discord.
 *
 * Il ne décide plus rien : quand une session Rose Griffon existe,
 * `POST /api/achillea/session` échange cette session contre le jeton qu'attend
 * l'API Achilléa, sans écran intermédiaire. Quand elle n'existe pas, il n'y a
 * pas de session e-sport non plus, et `login()` mène au formulaire unique.
 *
 * L'échange n'a lieu QU'UNE FOIS par session : `me()` est retenté après, et son
 * échec (Discord non lié, passerelle non configurée) laisse l'état `anonymous`
 * plutôt que de boucler.
 *
 * Il n'interroge PAS le fournisseur de session Rose Griffon : la passerelle
 * répond déjà `401` quand il n'y en a pas. En dépendre importerait le client
 * Better Auth dans ce module, donc dans tout ce qui passe par le baril
 * `lib/achillea` — y compris des tests purs qui n'ont ni fenêtre ni URL de base.
 */
export function AchilleaAuthProvider({ children }: { children: ReactNode }) {
  const { user: account, isLoading: accountLoading, logout: logoutAccount } = useAuth();
  const [user, setUser] = useState<SessionUserDTO | null>(null);
  const [status, setStatus] = useState<AchilleaAuthStatus>("unknown");

  const lireSession = useCallback(async (isCurrent: () => boolean = () => true): Promise<boolean> => {
    const client = createAchilleaClient({ credentials: "include" });
    const res = await client.auth.me();
    if (!isCurrent()) return false;
    if (res.ok && res.value?.id) {
      setUser(res.value);
      setStatus("authenticated");
      return true;
    }
    setUser(null);
    setStatus(failedIdentityStatus(res));
    return false;
  }, []);

  const refreshUser = useCallback(async () => {
    if (!account) {
      setUser(null);
      setStatus("anonymous");
      return;
    }
    setStatus("loading");
    try {
      await lireSession();
    } catch {
      setUser(null);
      setStatus("error");
    }
  }, [account, lireSession]);

  useEffect(() => {
    let annule = false;
    if (accountLoading) return;
    if (!account) {
      const timer = setTimeout(() => {
        setUser(null);
        setStatus("anonymous");
      }, 0);
      return () => clearTimeout(timer);
    }

    const synchroniser = async () => {
      setStatus("loading");
      try {
        // Toujours échanger l'identité RG avant de lire le cookie Achilléa :
        // celui-ci peut encore appartenir au compte RG précédent.
        // La passerelle répond `401`
        // s'il n'y a pas de session Rose Griffon, `409` si aucun compte
        // Discord n'y est lié — deux informations, pas des pannes. L'état
        // reste `anonymous`.
        const reponse = await fetch("/api/achillea/session", {
          method: "POST",
          // Explicite pour conserver la session RG quand le site est servi
          // derrière un domaine parent/proxy ; le jeton HTTP-only est ensuite
          // lu par ranked.rosegriffon.fr.
          credentials: "include",
          cache: "no-store",
        });
        if (annule) return;
        if (!reponse.ok) {
          setUser(null);
          setStatus(reponse.status === 401 || reponse.status === 409 ? "anonymous" : "error");
          return;
        }
        await lireSession(() => !annule);
      } catch {
        if (!annule) {
          setUser(null);
          setStatus("error");
        }
      }
    };

    void synchroniser();
    return () => {
      annule = true;
    };
  }, [account?.id, accountLoading, lireSession]);

  const login = useCallback(
    (returnUrl = "/achillea") => {
      if (account) {
        window.location.assign("/settings?tab=connections");
        return;
      }
      // Une seule porte d'entrée. `safeReturnUrl` reste indispensable : un
      // chemin non validé (`//ailleurs.test`, `/\\ailleurs.test`) transforme le
      // formulaire de connexion en redirection ouverte.
      window.location.assign(`/login?redirect=${encodeURIComponent(safeReturnUrl(returnUrl))}`);
    },
    [account],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/achillea/session", {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
    } finally {
      setUser(null);
      setStatus("anonymous");
      await logoutAccount();
      window.location.assign("/");
    }
  }, [logoutAccount]);

  const value: AchilleaAuthContextType = {
    user,
    status,
    isLoading: accountLoading || status === "loading" || status === "unknown",
    isAuthenticated: status === "authenticated" && user !== null,
    login,
    logout,
    refreshUser,
  };

  return <AchilleaAuthContext.Provider value={value}>{children}</AchilleaAuthContext.Provider>;
}

export function useAchilleaAuth(): AchilleaAuthContextType {
  const context = useContext(AchilleaAuthContext);
  if (!context) {
    throw new Error("useAchilleaAuth doit être utilisé dans un AchilleaAuthProvider");
  }
  return context;
}
