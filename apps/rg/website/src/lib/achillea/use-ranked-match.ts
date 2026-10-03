"use client";

/**
 * Salle de match du mode classé — portage réel de `RankedRoomService`.
 *
 * CE QUE CE FICHIER REMPLACE
 * La page `/achillea/ranked/match` était SIMULÉE de bout en bout : code de
 * salon « ACH-7842 » en dur, adversaire « Adversaire_99 », ELO « 1 240 AP » et
 * « 1 215 AP » inventés, message de chat écrit dans le code, soumission de
 * score en `setTimeout(800)` et téléversement de preuve qui ne téléversait
 * rien. Le client de données était même importé sans jamais être appelé. Un
 * joueur pouvait donc « jouer » un match qui n'existait sur aucun serveur.
 *
 * Un match ne peut pas s'écrire en HTTP : les deux joueurs doivent voir le même
 * état au même instant, et c'est le serveur qui arbitre les scores. D'où
 * Colyseus, et d'où ce hook. Toute la donnée arrive par un unique
 * `onStateChange` — c'est le serveur qui pousse, jamais le client qui devine.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { createAchilleaClient } from "./client";

/** Clé de reprise après rechargement ou coupure réseau. */
const CLE_SALLE = "achillea:ranked:salle";

export interface JoueurMatch {
  userId: string;
  displayName: string;
  avatar: string;
  elo: number;
  /** 1 = domicile, 2 = extérieur, 0 = non assigné. */
  team: number;
  myScore: number;
  oppScore: number;
  startedMatch: boolean;
  submitted: boolean;
  proofUploaded: boolean;
  confirmedFinish: boolean;
}

export interface MessageMatch {
  userId: string;
  text: string;
  at: number;
}

export interface EtatMatch {
  /** `null` tant qu'aucune salle n'est rejointe. */
  codeSalle: string | null;
  lobbyId: number;
  statut: string;
  classe: boolean;
  motifLitige: string;
  joueurs: JoueurMatch[];
  messages: MessageMatch[];
  /** Résumé de fin de match, poussé par le serveur. */
  resume: unknown | null;
  connexion: "inactive" | "connexion" | "connecte" | "erreur";
  erreur: string | null;
  envoyerMessage: (texte: string) => void;
  demarrer: () => void;
  terminer: () => void;
  abandonner: () => void;
  soumettreScore: (monScore: number, scoreAdverse: number) => void;
  signalerPreuve: () => void;
}

function origineColyseus(): string {
  return process.env["NEXT_PUBLIC_ACHILLEA_COLYSEUS_URL"] ?? "wss://ranked.rosegriffon.fr";
}

type SalleMatch = {
  roomId: string;
  onStateChange: (cb: (state: unknown) => void) => void;
  onMessage: (type: string, cb: (payload: unknown) => void) => void;
  onLeave: (cb: () => void) => void;
  send: (type: string, payload?: unknown) => void;
  leave: (consented?: boolean) => Promise<number>;
};

/** Convertit la carte de joueurs du serveur, en gardant l'ordre domicile/extérieur. */
function lireJoueurs(state: unknown): JoueurMatch[] {
  const carte = (state as { players?: Iterable<[unknown, Record<string, unknown>]> })?.players;
  if (!carte) return [];

  const sortie: JoueurMatch[] = [];
  for (const [, joueur] of carte) {
    sortie.push({
      avatar: String(joueur["avatar"] ?? ""),
      confirmedFinish: Boolean(joueur["confirmedFinish"]),
      displayName: String(joueur["displayName"] ?? ""),
      elo: Number(joueur["elo"] ?? 0),
      myScore: Number(joueur["myScore"] ?? 0),
      oppScore: Number(joueur["oppScore"] ?? 0),
      proofUploaded: Boolean(joueur["proofUploaded"]),
      startedMatch: Boolean(joueur["startedMatch"]),
      submitted: Boolean(joueur["submitted"]),
      team: Number(joueur["team"] ?? 0),
      userId: String(joueur["userId"] ?? ""),
    });
  }

  // L'ordre d'une carte du serveur n'est pas garanti : sans ce tri, domicile et
  // extérieur pouvaient permuter d'un rafraîchissement à l'autre.
  sortie.sort((a, b) => (a.team || 99) - (b.team || 99));
  return sortie;
}

function lireMessages(state: unknown): MessageMatch[] {
  const liste = (state as { chat?: Iterable<Record<string, unknown>> })?.chat;
  if (!liste) return [];
  const sortie: MessageMatch[] = [];
  for (const message of liste) {
    sortie.push({
      at: Number(message["at"] ?? 0),
      text: String(message["text"] ?? ""),
      userId: String(message["userId"] ?? ""),
    });
  }
  return sortie;
}

/**
 * Rejoint la salle de match et en suit l'état.
 *
 * @param idSalle Identifiant poussé par la file d'attente. S'il est absent, on
 * reprend celui mémorisé — une fin de match est ASYNCHRONE et doit survivre à
 * un rechargement de page ou à une coupure réseau.
 */
export function useRankedMatch(idSalle?: string | null): EtatMatch {
  const [codeSalle, setCodeSalle] = useState<string | null>(null);
  const [lobbyId, setLobbyId] = useState(0);
  const [statut, setStatut] = useState("waiting");
  const [classe, setClasse] = useState(true);
  const [motifLitige, setMotifLitige] = useState("");
  const [joueurs, setJoueurs] = useState<JoueurMatch[]>([]);
  const [messages, setMessages] = useState<MessageMatch[]>([]);
  const [resume, setResume] = useState<unknown | null>(null);
  const [connexion, setConnexion] = useState<EtatMatch["connexion"]>("inactive");
  const [erreur, setErreur] = useState<string | null>(null);
  const salle = useRef<SalleMatch | null>(null);

  useEffect(() => {
    let annule = false;

    const cible =
      idSalle ?? (typeof window === "undefined" ? null : window.localStorage.getItem(CLE_SALLE));
    if (!cible) {
      setConnexion("inactive");
      return;
    }

    void (async () => {
      setConnexion("connexion");
      setErreur(null);

      const client = createAchilleaClient({ credentials: "include" });
      const jeton = await client.auth.realtimeToken();
      if (annule) return;
      if (!jeton.ok || !jeton.value?.token) {
        setConnexion("erreur");
        setErreur("Connecte-toi pour rejoindre ton match.");
        return;
      }

      try {
        const { Client } = await import("@colyseus/sdk");
        const colyseus = new Client(origineColyseus());
        const rejointe = (await colyseus.joinById(cible, {
          token: jeton.value.token,
        })) as unknown as SalleMatch;
        if (annule) {
          void rejointe.leave(true).catch(() => {});
          return;
        }

        salle.current = rejointe;
        setConnexion("connecte");
        try {
          window.localStorage.setItem(CLE_SALLE, rejointe.roomId);
        } catch {
          /* stockage indisponible : la reprise après coupure sera perdue */
        }

        // UN SEUL point d'entrée pour tout l'état du match : code, statut,
        // joueurs, scores, chat. Le serveur pousse, le client n'infère rien.
        rejointe.onStateChange((state) => {
          const brut = state as Record<string, unknown>;
          setCodeSalle(String(brut["roomCode"] ?? "") || null);
          const idLobby = Number(brut["lobbyId"] ?? 0);
          setLobbyId(Number.isSafeInteger(idLobby) && idLobby > 0 ? idLobby : 0);
          setStatut(String(brut["status"] ?? "waiting"));
          setClasse(brut["ranked"] !== false);
          setMotifLitige(String(brut["disputeReason"] ?? ""));
          setJoueurs(lireJoueurs(state));
          setMessages(lireMessages(state));
        });

        rejointe.onMessage("matchEnded", (payload) => {
          setResume(payload);
          // Match terminé : plus rien à rejoindre, et un rejoin ne rendrait
          // pas le résumé.
          try {
            window.localStorage.removeItem(CLE_SALLE);
          } catch {
            /* sans importance */
          }
        });

        rejointe.onLeave(() => {
          salle.current = null;
          setConnexion("inactive");
        });
      } catch (cause) {
        if (annule) return;
        setConnexion("erreur");
        setErreur(
          cause instanceof Error ? `Match injoignable : ${cause.message}` : "Match injoignable.",
        );
      }
    })();

    return () => {
      annule = true;
      void salle.current?.leave(false).catch(() => {});
      salle.current = null;
    };
  }, [idSalle]);

  /** Envoie une commande au serveur. Sans salle, on ne fait rien — jamais semblant. */
  const commander = useCallback((type: string, payload?: unknown) => {
    salle.current?.send(type, payload);
  }, []);

  return {
    abandonner: useCallback(() => commander("surrender"), [commander]),
    classe,
    codeSalle,
    connexion,
    demarrer: useCallback(() => commander("start"), [commander]),
    envoyerMessage: useCallback(
      (texte: string) => {
        const propre = texte.trim();
        if (propre) commander("chat", { text: propre });
      },
      [commander],
    ),
    erreur,
    joueurs,
    lobbyId,
    messages,
    motifLitige,
    resume,
    signalerPreuve: useCallback(() => commander("proofUploaded"), [commander]),
    soumettreScore: useCallback(
      (monScore: number, scoreAdverse: number) =>
        commander("submitScore", { myScore: monScore, oppScore: scoreAdverse }),
      [commander],
    ),
    statut,
    terminer: useCallback(() => commander("finish"), [commander]),
  };
}
