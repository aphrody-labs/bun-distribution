"use client";

import { useResetState } from "@/hooks/use-reset-state";

/**
 * File d'attente du mode classé — portage réel de `RankedRoomService`.
 *
 * POURQUOI CE FICHIER EXISTE
 * La page `/achillea/ranked` affichait une recherche d'adversaire entièrement
 * factice : le bouton posait `isSearching = true`, un chronomètre tournait
 * indéfiniment, et un lien libellé « Simuler match trouvé » menait à la page de
 * match. Aucun appel serveur. Le front Angular, lui, rejoint une salle Colyseus
 * (`shared/services/ranked-room-service.ts:247-290`) et attend le message
 * `matched`.
 *
 * Le matchmaking ne peut PAS se faire en HTTP : c'est un appariement temps
 * réel, arbitré par le serveur, où deux clients doivent être notifiés au même
 * instant. D'où Colyseus, et d'où ce hook.
 *
 * AUTHENTIFICATION
 * La salle exige un jeton temps réel distinct du cookie de session : un cookie
 * `httpOnly` n'est pas exploitable en WebSocket cross-domaine. Le client
 * l'expose déjà (`client.auth.realtimeToken()`), avec sa propre durée de vie.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { createAchilleaClient } from "./client";

/** Modes appariables, tels que le serveur les nomme. */
export type ModeClasse = "1v1" | "2v2";

export interface EtatFileClasse {
  /** Une recherche est-elle en cours ? */
  recherche: boolean;
  /** Estimation d'attente communiquée par le serveur, en secondes. */
  etaSecondes: number | null;
  /** Secondes écoulées depuis le début de la recherche. */
  ecoulees: number;
  /** Message d'erreur à afficher, ou `null`. */
  erreur: string | null;
  rejoindre: (mode: ModeClasse, classe?: boolean) => Promise<void>;
  annuler: () => Promise<void>;
}

/** Origine du serveur temps réel. Inlinée au build, donc déployer depuis l'app. */
function origineColyseus(): string {
  return process.env["NEXT_PUBLIC_ACHILLEA_COLYSEUS_URL"] ?? "wss://ranked.rosegriffon.fr";
}

type SalleColyseus = {
  roomId: string;
  onMessage: (type: string, cb: (payload: unknown) => void) => void;
  onLeave: (cb: () => void) => void;
  leave: (consented?: boolean) => Promise<number>;
};

export function useRankedQueue(): EtatFileClasse {
  const [recherche, setRecherche] = useState(false);
  const [etaSecondes, setEta] = useState<number | null>(null);
  const [ecoulees, setEcoulees] = useResetState(0, recherche);
  const [erreur, setErreur] = useState<string | null>(null);
  const salle = useRef<SalleColyseus | null>(null);

  // Chronomètre d'affichage. Il ne pilote rien : c'est le serveur qui décide
  // quand l'appariement aboutit, et le laisser courir sans recherche active
  // était précisément ce qui donnait l'illusion d'une file en marche.
  useEffect(() => {
    if (!recherche) return;
    const id = setInterval(() => setEcoulees((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [recherche]);

  // Quitter la salle si l'utilisateur ferme la page en cours de recherche :
  // sans cela, le serveur le garde en file et l'apparie dans le vide.
  useEffect(() => {
    return () => {
      void salle.current?.leave(true).catch(() => {});
      salle.current = null;
    };
  }, []);

  const rejoindre = useCallback(async (mode: ModeClasse, classe = true) => {
    if (salle.current) return;
    setErreur(null);

    const client = createAchilleaClient({ credentials: "include" });
    const jeton = await client.auth.realtimeToken();
    if (!jeton.ok || !jeton.value?.token) {
      setErreur("Connecte-toi avant de rechercher un adversaire.");
      return;
    }

    setRecherche(true);
    try {
      // Import dynamique : le SDK Colyseus ouvre une WebSocket et n'a aucun
      // sens au rendu serveur. L'importer au niveau du module ferait entrer
      // tout le client temps réel dans le bundle de chaque page Achilléa.
      const { Client } = await import("@colyseus/sdk");
      const colyseus = new Client(origineColyseus());
      const salleFile = (await colyseus.joinOrCreate("queue", {
        mode,
        ranked: classe,
        token: jeton.value.token,
      })) as unknown as SalleColyseus;
      salle.current = salleFile;

      salleFile.onMessage("eta", (payload) => {
        const secondes = (payload as { seconds?: unknown })?.seconds;
        setEta(typeof secondes === "number" ? secondes : null);
      });

      salleFile.onMessage("matched", (payload) => {
        const reservation = (payload as { reservation?: { room?: { roomId?: string } } })
          ?.reservation;
        const idSalle = reservation?.room?.roomId;
        salle.current = null;
        setRecherche(false);
        // La page de match consomme l'identifiant de salle. Sans lui, elle ne
        // peut rien afficher de réel — c'est exactement ce qui l'avait fait
        // naître entièrement simulée.
        window.location.assign(
          idSalle
            ? `/achillea/ranked/match?salle=${encodeURIComponent(idSalle)}`
            : "/achillea/ranked/match",
        );
      });

      salleFile.onLeave(() => {
        salle.current = null;
        setRecherche(false);
        setEta(null);
      });
    } catch (cause) {
      salle.current = null;
      setRecherche(false);
      setEta(null);
      setErreur(
        cause instanceof Error
          ? `Connexion au serveur de match impossible : ${cause.message}`
          : "Connexion au serveur de match impossible.",
      );
    }
  }, []);

  const annuler = useCallback(async () => {
    try {
      await salle.current?.leave(true);
    } catch {
      /* la salle peut déjà être fermée côté serveur */
    }
    salle.current = null;
    setRecherche(false);
    setEta(null);
  }, []);

  return { annuler, ecoulees, erreur, etaSecondes, recherche, rejoindre };
}
