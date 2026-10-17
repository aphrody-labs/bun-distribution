// LobbyRoom — salon de présence ranked. Tous les joueurs en ligne sur la page
// ranked y sont listés (state synchronisé) pour permettre le défi direct
// (« inviter un adversaire en ligne »).
//
// Flux invitation :
//   - inviteur : onMessage("invite", { targetUserId, mode }) → la cible reçoit
//     client.send("invited", { fromUserId, … }).
//   - cible : onMessage("invite-response", { accept, fromUserId, mode })
//     (ou "accept" { fromUserId, mode }) :
//       * accept → createRankedMatch(inviteur, invité) → "matched" { reservation }
//         à chacun + push Socket.IO match_found (mutualisé avec QueueRoom).
//       * refus  → l'inviteur reçoit "invite-declined".

import { Room, type Client } from "@colyseus/core";
import { parseMode } from "@rosegriffon/achillea-core";

import type { SessionUser } from "../auth";
import { authFromColyseus } from "../auth";
import { getActiveSeason, getOrCreateElo, getUserRow } from "../db";
import { createRankedMatch } from "../match-factory";
import { LobbyPlayer, LobbyState } from "../schema/LobbyState";
import { logMatchEvent } from "../telemetry";

const INVITE_TTL_MS = 60 * 1000;

interface PresentPlayer {
  client: Client;
  userId: string;
  displayName: string;
  avatar: string;
  elo: number;
  mode: number;
}

interface PendingInvite {
  fromUserId: string;
  toUserId: string;
  mode: number;
  ranked: boolean;
  expiresAt: number;
}

export class LobbyRoom extends Room<{ state: LobbyState }> {
  override maxClients = 500;
  override autoDispose = false;

  // Instance courante (la lobby est un singleton : `defineRoom(LobbyRoom)` sans filterBy).
  // Permet aux handlers REST (défi par lien) de livrer une réservation à un joueur présent.
  private static current: LobbyRoom | null = null;

  // sessionId → infos joueur connecté (résolution rapide pour l'envoi ciblé).
  private present = new Map<string, PresentPlayer>();
  // inviteId → invitation en cours (purge auto après INVITE_TTL_MS).
  private invites = new Map<string, PendingInvite>();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Livre une réservation de match à un joueur PRÉSENT dans la lobby (via son client
   * Colyseus existant). Utilisé par l'acceptation d'un défi par lien : l'inviteur, resté
   * sur la page ranked, reçoit `matched` exactement comme pour une invitation directe.
   * Renvoie true si le joueur était présent et a été notifié.
   */
  static deliverMatchTo(userId: string, reservation: unknown): boolean {
    const room = LobbyRoom.current;
    if (!room) return false;
    const present = room.findByUserId(userId);
    if (!present) return false;
    present.client.send("matched", { reservation });
    return true;
  }

  /**
   * Pousse un évènement (`match_found`, `rematch_offer`, `ranked_dispute_resolved`…) aux joueurs
   * PRÉSENTS dans la lobby. Remplace l'ancien relais Socket.IO du bot TSed : le bot, Colyseus et
   * l'API partagent désormais le processus `rg-core`, la livraison se fait donc en mémoire.
   * Best-effort : un joueur absent de la lobby ne reçoit rien. Renvoie le nombre de joueurs notifiés.
   */
  static livrerEvenement(userIds: readonly string[], evenement: string, charge: unknown): number {
    const room = LobbyRoom.current;
    if (!room) return 0;
    let livres = 0;
    for (const userId of new Set(userIds)) {
      const present = room.findByUserId(userId);
      if (!present) continue;
      present.client.send(evenement, charge);
      livres++;
    }
    return livres;
  }

  override onCreate(_options: any) {
    LobbyRoom.current = this;
    this.setState(new LobbyState());

    // Purge périodique des invitations expirées.
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, inv] of this.invites) {
        if (inv.expiresAt <= now) this.invites.delete(id);
      }
    }, 5000);

    this.onMessage("invite", (client, payload: { targetUserId?: string; mode?: number; ranked?: boolean }) => {
      this.handleInvite(client, payload);
    });

    // Réponse à une invitation (accept/refus dans un seul message).
    this.onMessage(
      "invite-response",
      (client, payload: { accept?: boolean; fromUserId?: string; mode?: number; ranked?: boolean }) => {
        if (payload?.accept) {
          void this.handleAccept(client, {
            fromUserId: payload?.fromUserId,
            mode: payload?.mode,
            ranked: payload?.ranked,
          });
        } else {
          this.handleDecline(client, { fromUserId: payload?.fromUserId });
        }
      },
    );

    // Acceptation directe (alias pratique).
    this.onMessage("accept", (client, payload: { fromUserId?: string; mode?: number; ranked?: boolean }) => {
      void this.handleAccept(client, payload);
    });

    // Refus direct.
    this.onMessage("decline", (client, payload: { fromUserId?: string }) => {
      this.handleDecline(client, payload);
    });
  }

  override async onAuth(_client: Client, options: any, request: any): Promise<SessionUser> {
    const auth = await authFromColyseus(options, request);
    if (auth) return auth;
    throw new Error("Non authentifié");
  }

  override async onJoin(client: Client, options: any, auth: SessionUser) {
    const mode = parseMode(options?.mode);
    const userRow = await getUserRow(auth.id);
    const season = await getActiveSeason();
    const baseRating = season?.config?.baseRating ?? 0;
    const elo = await getOrCreateElo(auth.id, mode, season?.id ?? null, baseRating);

    const displayName = userRow?.display_name ?? auth.username ?? auth.id;
    const avatar = userRow?.avatar ?? auth.avatar ?? "";

    this.present.set(client.sessionId, {
      client,
      userId: auth.id,
      displayName,
      avatar,
      elo: elo.elo,
      mode,
    });

    const ps = new LobbyPlayer();
    ps.userId = auth.id;
    ps.displayName = displayName;
    ps.avatar = avatar;
    ps.elo = elo.elo;
    ps.mode = mode;
    this.state.players.set(client.sessionId, ps);
  }

  override onLeave(client: Client) {
    this.present.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    // Purge les invitations dont ce joueur est partie prenante.
    const goneUserId = this.userIdOf(client);
    if (goneUserId) {
      for (const [id, inv] of this.invites) {
        if (inv.fromUserId === goneUserId || inv.toUserId === goneUserId) {
          this.invites.delete(id);
        }
      }
    }
  }

  override onDispose() {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    if (LobbyRoom.current === this) LobbyRoom.current = null;
  }

  private userIdOf(client: Client): string | undefined {
    return this.present.get(client.sessionId)?.userId;
  }

  // Trouve le premier présent (1 session) correspondant à un userId.
  private findByUserId(userId: string): PresentPlayer | undefined {
    for (const p of this.present.values()) {
      if (p.userId === userId) return p;
    }
    return undefined;
  }

  private inviteKey(fromUserId: string, toUserId: string): string {
    return `${fromUserId}->${toUserId}`;
  }

  private handleInvite(client: Client, payload: { targetUserId?: string; mode?: number; ranked?: boolean }) {
    const from = this.present.get(client.sessionId);
    if (!from) return;
    const targetUserId = String(payload?.targetUserId ?? "");
    if (!targetUserId || targetUserId === from.userId) return;

    const target = this.findByUserId(targetUserId);
    if (!target) {
      client.send("invite-error", { reason: "offline" });
      return;
    }

    const mode = Number(payload?.mode ?? from.mode ?? 2);
    const ranked = payload?.ranked !== false; // défaut : classé
    this.invites.set(this.inviteKey(from.userId, targetUserId), {
      fromUserId: from.userId,
      toUserId: targetUserId,
      mode,
      ranked,
      expiresAt: Date.now() + INVITE_TTL_MS,
    });

    void logMatchEvent({
      type: "invite_sent",
      mode,
      userId: from.userId,
      detail: { targetUserId, ranked },
    });

    target.client.send("invited", {
      fromUserId: from.userId,
      fromDisplayName: from.displayName,
      fromAvatar: from.avatar,
      fromElo: from.elo,
      mode,
      ranked,
    });
  }

  private async handleAccept(client: Client, payload: { fromUserId?: string; mode?: number; ranked?: boolean }) {
    const invitee = this.present.get(client.sessionId);
    if (!invitee) return;
    const fromUserId = String(payload?.fromUserId ?? "");
    if (!fromUserId) return;

    const key = this.inviteKey(fromUserId, invitee.userId);
    const invite = this.invites.get(key);
    if (!invite || invite.expiresAt <= Date.now()) {
      this.invites.delete(key);
      client.send("invite-expired", { fromUserId });
      return;
    }
    this.invites.delete(key);

    const inviter = this.findByUserId(fromUserId);
    if (!inviter) {
      client.send("invite-error", { reason: "offline" });
      return;
    }

    const mode = Number(payload?.mode ?? invite.mode ?? 2);
    const ranked = (payload?.ranked ?? invite.ranked) !== false; // défaut : classé

    try {
      // Création de match mutualisée avec QueueRoom (cf match-factory.ts).
      // a = inviteur, b = invité (celui qui accepte).
      const { reservationA, reservationB } = await createRankedMatch(
        mode,
        {
          userId: inviter.userId,
          displayName: inviter.displayName,
          avatar: inviter.avatar,
          elo: inviter.elo,
        },
        {
          userId: invitee.userId,
          displayName: invitee.displayName,
          avatar: invitee.avatar,
          elo: invitee.elo,
        },
        ranked,
      );

      void logMatchEvent({
        type: "invite_accepted",
        mode,
        userId: invitee.userId,
        detail: { inviterUserId: inviter.userId, source: "invite", ranked },
      });

      inviter.client.send("matched", { reservation: reservationA });
      invitee.client.send("matched", { reservation: reservationB });
    } catch (err) {
      console.error("[ranked] LobbyRoom.handleAccept createRankedMatch failed", err);
      client.send("invite-error", { reason: "internal" });
      inviter.client.send("invite-error", { reason: "internal" });
    }
  }

  private handleDecline(client: Client, payload: { fromUserId?: string }) {
    const invitee = this.present.get(client.sessionId);
    if (!invitee) return;
    const fromUserId = String(payload?.fromUserId ?? "");
    if (!fromUserId) return;

    const key = this.inviteKey(fromUserId, invitee.userId);
    this.invites.delete(key);

    void logMatchEvent({
      type: "invite_declined",
      userId: invitee.userId,
      detail: { inviterUserId: fromUserId },
    });

    const inviter = this.findByUserId(fromUserId);
    if (inviter) {
      inviter.client.send("invite-declined", {
        fromUserId: invitee.userId,
        fromDisplayName: invitee.displayName,
      });
    }
  }
}
