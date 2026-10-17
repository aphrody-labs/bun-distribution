// Fabrique de match ranked partagée — utilisée par QueueRoom.pair() (file aléatoire)
// ET par LobbyRoom (défi direct). Crée une MatchRoom, réserve une place pour
// chacun des 2 joueurs, et pousse `match_found` aux joueurs présents dans la lobby.
// Zéro duplication : tout passe par createRankedMatch().

import { matchMaker } from "@colyseus/core";

import { LobbyRoom } from "./rooms/LobbyRoom";

// Représentation minimale d'un joueur pour la création de match. Reprend
// exactement le payload attendu par MatchRoom.onCreate (MatchOptions.players).
export interface RankedMatchPlayer {
  userId: string;
  displayName: string;
  avatar: string;
  elo: number;
}

export interface RankedMatchReservations {
  roomId: string;
  reservationA: unknown;
  reservationB: unknown;
}

// Crée le match pour 2 joueurs (a vs b) sur un mode donné :
//   1. matchMaker.createRoom("match", …) avec les 2 joueurs,
//   2. réserve une place pour chacun (seat reservation),
//   3. pousse `match_found` aux 2 joueurs (LobbyRoom, en mémoire).
// `ranked` = true (classé, ELO appliqué) / false (non classé, partie amicale sans ELO).
// Renvoie les 2 réservations pour que l'appelant fasse le `send("matched", …)`.
export async function createRankedMatch(
  mode: number,
  a: RankedMatchPlayer,
  b: RankedMatchPlayer,
  ranked = true,
): Promise<RankedMatchReservations> {
  // Garde-fou ABSOLU : jamais s'apparier soi-même. La MatchRoom indexe ses joueurs par
  // userId (MapSchema) → 2 fois le même id collapse en une seule entrée et casse le match
  // (homeAway null → « disputed »). La QueueRoom (multi-onglets) et un défi mal formé
  // pourraient l'atteindre : on refuse net ici, en dernier rempart.
  if (a.userId === b.userId) {
    throw new Error("Un joueur ne peut pas s'apparier contre lui-même");
  }

  const room = await matchMaker.createRoom("match", {
    mode,
    ranked,
    players: [
      {
        userId: a.userId,
        displayName: a.displayName,
        avatar: a.avatar,
        elo: a.elo,
      },
      {
        userId: b.userId,
        displayName: b.displayName,
        avatar: b.avatar,
        elo: b.elo,
      },
    ],
  });

  const reservationA = await matchMaker.reserveSeatFor(room, { userId: a.userId });
  const reservationB = await matchMaker.reserveSeatFor(room, { userId: b.userId });

  // Évènement `match_found` aux 2 joueurs présents dans la lobby (toast + son sur toute page du site).
  const payload = {
    roomId: room.roomId,
    mode,
    ranked,
    opponents: {
      [a.userId]: {
        userId: b.userId,
        displayName: b.displayName,
        avatar: b.avatar,
        elo: b.elo,
      },
      [b.userId]: {
        userId: a.userId,
        displayName: a.displayName,
        avatar: a.avatar,
        elo: a.elo,
      },
    },
  };
  LobbyRoom.livrerEvenement([a.userId, b.userId], "match_found", payload);

  return { roomId: room.roomId, reservationA, reservationB };
}
