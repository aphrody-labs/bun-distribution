// Fabrique de match ranked partagée — utilisée par QueueRoom.pair() (file aléatoire)
// ET par LobbyRoom (défi direct). Crée une MatchRoom, réserve une place pour
// chacun des 2 joueurs, et déclenche le toast Socket.IO `match_found` côté front.
// Zéro duplication : tout passe par createRankedMatch().

import { matchMaker } from "@colyseus/core";

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
//   3. émet le push Socket.IO `match_found` aux 2 joueurs.
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

  // Push Socket.IO `match_found` aux 2 joueurs (sub-process Colyseus -> bot TSed)
  // pour qu'un toast + son soient déclenchés sur n'importe quelle page front.
  const apiPort = Number(process.env.API_PORT ?? 4000);
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
  // Secret partage : prouve au bot TSed que l'appel vient bien du sub-process
  // interne (l'IP loopback ne suffit pas, cf. notifications.ts emit-match-found).
  const internalSecret = process.env.RANKED_INTERNAL_SECRET ?? "";
  fetch(`http://127.0.0.1:${apiPort}/notifications/emit-match-found`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
    },
    body: JSON.stringify({ userIds: [a.userId, b.userId], payload }),
  }).catch(err => {
    console.error("[ranked] emit-match-found fetch failed", err);
  });

  return { roomId: room.roomId, reservationA, reservationB };
}
