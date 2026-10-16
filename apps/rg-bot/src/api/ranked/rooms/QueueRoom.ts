// Matchmaking room — joueurs entrent en queue, on les apparie quand 2 sont
// dans une fenêtre elo±200. Une fois apparié, on crée un MatchRoom et on
// envoie une seat reservation aux 2 clients.

import { Room, type Client } from "@colyseus/core";
import { parseMode, selectQueuePair } from "@rosegriffon/achillea-core";

import type { SessionUser } from "../auth";
import { authFromColyseus } from "../auth";
import { getActiveSeason, getOrCreateElo, getUserRow } from "../db";
import { createRankedMatch } from "../match-factory";
import { logMatchEvent } from "../telemetry";

const ELO_WINDOW = 200;

interface QueueClient {
  client: Client;
  user: SessionUser;
  displayName: string;
  avatar: string;
  elo: number;
  mode: number;
  ranked: boolean;
  enqueuedAt: number;
}

export class QueueRoom extends Room {
  override maxClients = 200;

  // État local en RAM — pas de schema sync, le client n'a pas besoin de voir la queue.
  private waiting: QueueClient[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;

  override onCreate(_options: any) {
    this.interval = setInterval(() => {
      this.tryMatch().catch(err => {
        console.error("[ranked] QueueRoom.tryMatch failed", err);
      });
    }, 1000);
  }

  override async onAuth(_client: Client, options: any, request: any): Promise<SessionUser> {
    const auth = await authFromColyseus(options, request);
    if (auth) return auth;
    throw new Error("Non authentifié");
  }

  override async onJoin(client: Client, options: any, auth: SessionUser) {
    const mode = parseMode(options?.mode);
    const ranked = options?.ranked !== false; // défaut : classé
    const userRow = await getUserRow(auth.id);
    const season = await getActiveSeason();
    const baseRating = season?.config?.baseRating ?? 0;
    const elo = await getOrCreateElo(auth.id, mode, season?.id ?? null, baseRating);

    // Anti double-file (multi-onglets) : on retire toute entrée existante du même joueur
    // avant d'ajouter la nouvelle. Empêche en amont qu'un joueur soit candidat à
    // s'apparier contre lui-même (le tri par elo les rendrait adjacents).
    this.waiting = this.waiting.filter(q => q.user.id !== auth.id);

    this.waiting.push({
      client,
      user: auth,
      displayName: userRow?.display_name ?? auth.username ?? auth.id,
      avatar: userRow?.avatar ?? auth.avatar ?? "",
      elo: elo.elo,
      mode,
      ranked,
      enqueuedAt: Date.now(),
    });

    void logMatchEvent({
      type: "queue_join",
      mode,
      userId: auth.id,
      detail: { elo: elo.elo, ranked },
    });

    // ETA naïf : moyenne des temps d'attente récents — pour le MVP on émet juste 30s.
    client.send("eta", { seconds: 30 });
  }

  override onLeave(client: Client) {
    this.waiting = this.waiting.filter(q => q.client.sessionId !== client.sessionId);
  }

  override onDispose() {
    if (this.interval) clearInterval(this.interval);
  }

  private async tryMatch() {
    // Group by mode
    const byMode = new Map<number, QueueClient[]>();
    for (const q of this.waiting) {
      const arr = byMode.get(q.mode) ?? [];
      arr.push(q);
      byMode.set(q.mode, arr);
    }

    const now = Date.now();
    for (const [mode, list] of byMode) {
      // Trie par elo asc, puis délègue la sélection (anti auto-appariement + fenêtre
      // dynamique) à la logique pure testable `selectQueuePair`.
      list.sort((a, b) => a.elo - b.elo);
      const pair = selectQueuePair(
        list.map(q => ({ userId: q.user.id, elo: q.elo, enqueuedAt: q.enqueuedAt })),
        now,
        ELO_WINDOW,
      );
      if (!pair) continue;
      const [i, j] = pair;
      const a = list[i];
      const b = list[j];
      await this.pair(mode, a, b);
      this.waiting = this.waiting.filter(
        q => q.client.sessionId !== a.client.sessionId && q.client.sessionId !== b.client.sessionId,
      );
    }
  }

  private async pair(mode: number, a: QueueClient, b: QueueClient) {
    // Création de match mutualisée avec LobbyRoom (cf match-factory.ts). Le classé/non
    // classé est porté par les candidats (file partitionnée par ["mode","ranked"]).
    const { reservationA, reservationB } = await createRankedMatch(
      mode,
      { userId: a.user.id, displayName: a.displayName, avatar: a.avatar, elo: a.elo },
      { userId: b.user.id, displayName: b.displayName, avatar: b.avatar, elo: b.elo },
      a.ranked,
    );

    void logMatchEvent({
      type: "queue_pair",
      mode,
      detail: {
        ranked: a.ranked,
        a: { userId: a.user.id, elo: a.elo },
        b: { userId: b.user.id, elo: b.elo },
        source: "queue",
      },
    });

    a.client.send("matched", { reservation: reservationA });
    b.client.send("matched", { reservation: reservationB });
  }
}
