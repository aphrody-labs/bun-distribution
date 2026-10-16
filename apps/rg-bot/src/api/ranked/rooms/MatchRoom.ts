// MatchRoom — sync state des 2 joueurs : chat, scores (double validation), contestation.
//
// Le 1er joueur joue à DOMICILE (team 1), le 2e à l'EXTÉRIEUR (team 2).
//
// Fin de match ASYNCHRONE : chaque joueur clique « Fin de match » puis saisit le score
// COMPLET de son point de vue (mes buts + buts adverse), INDÉPENDAMMENT de l'autre (qui
// peut être déconnecté puis revenir via le code de salle). Dès le 1er « Fin de match », un
// lobby 'Ongoing' est créé → les DEUX joueurs peuvent uploader une preuve de score (plus
// seulement en litige). Accord des 2 scorelines (domicile 3-1 ⇄ extérieur 1-3) → match
// validé + ELO (nul possible). Désaccord → litige : preuve, lobby 'Contested', arbitrage
// admin. Tout le flow est journalisé (télémétrie).

import { Room, type Client } from "@colyseus/core";
import {
  clampScore,
  parseMode,
  resolveScores,
  resultLabel,
  teamForIndex,
  type ScoreInput,
} from "@rosegriffon/achillea-core";

import type { SessionUser } from "../auth";
import { authFromColyseus } from "../auth";
import { ChatMessage, MatchState, PlayerState } from "../schema/MatchState";
import { getActiveSeason } from "../db";
import {
  contestOngoingLobby,
  createOngoingLobby,
  finalizeOngoingLobby,
  getOrCreatePerpetualRankedEventId,
  persistAndApplyMatch,
  persistDisputedLobby,
  recordLobbyUserScore,
} from "../persistence";
import { logMatchEvent } from "../telemetry";

const TIMEOUT_SCORING_MS = 5 * 60 * 1000; // 5min après le 1er « Fin de match » sans validation des 2
const ROOM_CODE_LEN = 6;

function genRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

interface MatchOptions {
  mode: number;
  // true = classé (ELO + persistance + arbitrage) ; false = non classé (amical, éphémère).
  ranked?: boolean;
  players: Array<{
    userId: string;
    displayName: string;
    avatar: string;
    elo: number;
  }>;
}

export class MatchRoom extends Room<{ state: MatchState }> {
  override maxClients = 4; // 2 joueurs en 1v1, 4 en 2v2 (futur)
  override autoDispose = false;

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private kFactor = 32;
  private finishedPersisted = false;
  // Promesse partagée de création du lobby 'Ongoing' : garantit une seule création ET que
  // toute saisie concurrente attende le même `state.lobbyId` avant d'évaluer (anti-race).
  private lobbyPromise: Promise<void> | null = null;
  private expectedUserIds = new Set<string>();
  private sessionToUser = new Map<string, string>();

  override async onCreate(options: MatchOptions) {
    this.setState(new MatchState());
    this.state.roomCode = genRoomCode();
    this.state.mode = parseMode(options.mode);
    this.state.ranked = options.ranked !== false; // défaut : classé
    this.state.status = "waiting";
    this.state.startedAt = Date.now();

    // Index 0 → domicile (team 1), index 1 → extérieur (team 2).
    options.players.forEach((p, i) => {
      this.expectedUserIds.add(p.userId);
      const ps = new PlayerState();
      ps.userId = p.userId;
      ps.displayName = p.displayName;
      ps.avatar = p.avatar;
      ps.elo = p.elo;
      ps.team = teamForIndex(i);
      this.state.players.set(p.userId, ps);
    });

    const season = await getActiveSeason();
    this.kFactor = season?.config?.kFactor ?? 32;

    void logMatchEvent({
      type: "match_created",
      roomCode: this.state.roomCode,
      mode: this.state.mode,
      detail: {
        ranked: this.state.ranked,
        players: options.players.map((p, i) => ({
          userId: p.userId,
          elo: p.elo,
          team: teamForIndex(i),
        })),
      },
    });

    this.onMessage("chat", (client, payload: { text: string }) => {
      const userId = this.sessionToUser.get(client.sessionId);
      if (!userId) return;
      const text = String(payload?.text ?? "")
        .slice(0, 500)
        .trim();
      if (!text) return;
      const m = new ChatMessage();
      m.userId = userId;
      m.text = text;
      m.at = Date.now();
      this.state.chat.push(m);
    });

    // « Début de match » : chaque joueur confirme qu'il est prêt. Quand les 2 ont
    // confirmé → status playing (déclenche l'affichage du bouton « Fin de match »).
    this.onMessage("start", client => {
      const userId = this.sessionToUser.get(client.sessionId);
      if (!userId) return;
      const p = this.state.players.get(userId);
      if (!p || p.startedMatch) return;
      p.startedMatch = true;
      void logMatchEvent({
        type: "match_started",
        roomCode: this.state.roomCode,
        mode: this.state.mode,
        userId,
      });
      const allStarted = Array.from(this.state.players.values()).every(x => x.startedMatch);
      if (allStarted && this.state.status === "waiting") {
        this.state.status = "playing";
        void logMatchEvent({
          type: "playing",
          roomCode: this.state.roomCode,
          mode: this.state.mode,
        });
      }
    });

    // « Fin de match » ASYNCHRONE : ce joueur confirme la fin. On entre en phase de
    // saisie SANS attendre l'autre (qui peut être absent puis revenir). Le 1er « Fin de
    // match » crée le lobby 'Ongoing' → preuve uploadable par les 2 joueurs.
    this.onMessage("finish", client => {
      const userId = this.sessionToUser.get(client.sessionId);
      if (!userId) return;
      const p = this.state.players.get(userId);
      if (!p) return;
      // Idempotent : un re-clic « Fin de match » ne re-journalise pas (anti-doublon
      // télémétrie) mais relance ensureScoringStarted si le lobby n'a pas encore pu être créé.
      if (!p.confirmedFinish) {
        p.confirmedFinish = true;
        void logMatchEvent({
          type: "finish_confirmed",
          roomCode: this.state.roomCode,
          mode: this.state.mode,
          userId,
        });
      }
      void this.ensureScoringStarted();
    });

    // Saisie du score COMPLET du point de vue du joueur : { myScore, oppScore }.
    // Autorisé dès qu'on joue (entre alors en phase de saisie au besoin) — chaque
    // joueur saisit indépendamment de l'autre.
    this.onMessage("submitScore", (client, payload: { myScore: number; oppScore: number }) => {
      const userId = this.sessionToUser.get(client.sessionId);
      if (!userId) return;
      if (this.state.status !== "playing" && this.state.status !== "scoring") return;
      const p = this.state.players.get(userId);
      if (!p) return;
      // Re-soumission ignorée une fois validé (anti double-saisie / double-télémétrie).
      if (p.submitted) return;
      p.myScore = clampScore(payload?.myScore);
      p.oppScore = clampScore(payload?.oppScore);
      p.submitted = true;
      void logMatchEvent({
        type: "score_submitted",
        lobbyId: this.state.lobbyId || null,
        roomCode: this.state.roomCode,
        mode: this.state.mode,
        userId,
        detail: { myScore: p.myScore, oppScore: p.oppScore },
      });
      void this.ensureScoringStarted().then(() => {
        // Persistance AU FIL DE L'EAU : le score saisi survit à un crash/restart du bot
        // (l'état Colyseus en mémoire, lui, serait perdu).
        if (this.state.lobbyId > 0) {
          void recordLobbyUserScore(this.state.lobbyId, userId, p.myScore, p.oppScore).catch(err =>
            console.error("[ranked] recordLobbyUserScore failed", err),
          );
        }
        return this.evaluateScores();
      });
    });

    // Le joueur a uploadé sa preuve via l'API REST → on le reflète dans le state
    // (l'upload binaire ne passe pas par Colyseus, cf. main.ts /dispute).
    this.onMessage("proofUploaded", client => {
      const userId = this.sessionToUser.get(client.sessionId);
      if (!userId) return;
      const p = this.state.players.get(userId);
      if (!p) return;
      p.proofUploaded = true;
    });

    // « Abandonner » : ce joueur déclare forfait immédiatement → l'adversaire gagne
    // (1-0). En classé l'ELO est appliqué (défaite réelle), en non classé c'est sans
    // conséquence. Idempotent et bloqué une fois le match résolu.
    this.onMessage("surrender", client => {
      void this.handleSurrender(client);
    });
  }

  private async handleSurrender(client: Client): Promise<void> {
    const userId = this.sessionToUser.get(client.sessionId);
    if (!userId) return;
    if (this.finishedPersisted || this.state.status === "finished") return;
    const ha = this.homeAway();
    if (!ha) return;
    void logMatchEvent({
      type: "surrendered",
      lobbyId: this.state.lobbyId || null,
      roomCode: this.state.roomCode,
      mode: this.state.mode,
      userId,
    });
    // On garantit la phase de saisie (crée le lobby Ongoing en classé) puis on finalise
    // avec l'abandonneur déclaré forfait (score 0 pour lui, 1 pour l'adversaire).
    await this.ensureScoringStarted();
    const loserIsHome = ha.home.userId === userId;
    const s1 = loserIsHome ? 0 : 1;
    const s2 = loserIsHome ? 1 : 0;
    await this.finalizeMatch(ha.home, ha.away, s1, s2, userId);
  }

  override async onAuth(_client: Client, options: any, request: any): Promise<SessionUser> {
    const auth = await authFromColyseus(options, request);
    if (auth) return auth;
    throw new Error("Non authentifié");
  }

  override onJoin(client: Client, _options: any, auth: SessionUser) {
    if (!this.expectedUserIds.has(auth.id)) {
      throw new Error("Joueur non attendu dans ce match");
    }
    this.sessionToUser.set(client.sessionId, auth.id);
    void logMatchEvent({
      type: "player_joined",
      roomCode: this.state.roomCode,
      mode: this.state.mode,
      userId: auth.id,
    });
    // Le passage waiting → playing est piloté par le bouton « Début de match » (message
    // "start"), pas par la connexion : un joueur qui revient (refresh) ne re-déclenche rien.
  }

  override async onLeave(client: Client, _code?: number) {
    const userId = this.sessionToUser.get(client.sessionId);
    this.sessionToUser.delete(client.sessionId);
    if (!userId) return;
    void logMatchEvent({
      type: "player_left",
      lobbyId: this.state.lobbyId || null,
      roomCode: this.state.roomCode,
      mode: this.state.mode,
      userId,
    });
    // Pas de gestion reconnect au MVP — on laisse la room vivre,
    // le joueur peut revenir via joinById.
  }

  /** Snapshot ScoreInput pur d'un joueur (pour la logique de résolution testable). */
  private toScoreInput(p: PlayerState): ScoreInput {
    return { userId: p.userId, myScore: p.myScore, oppScore: p.oppScore, submitted: p.submitted };
  }

  /** Joueur à domicile (team 1) / extérieur (team 2), avec repli sur l'ordre d'insertion. */
  private homeAway(): { home: PlayerState; away: PlayerState } | null {
    const ps = Array.from(this.state.players.values());
    if (ps.length !== 2) return null;
    const home = ps.find(p => p.team === 1) ?? ps[0];
    const away = ps.find(p => p.team === 2) ?? ps[1];
    return { home, away };
  }

  /**
   * Entre en phase de saisie (1er « Fin de match » ou 1re saisie) : passe en 'scoring',
   * arme le timeout (une seule fois), et crée le lobby 'Ongoing' (une seule fois) pour que
   * les 2 joueurs puissent uploader une preuve.
   */
  private async ensureScoringStarted(): Promise<void> {
    if (this.state.status === "finished" || this.state.status === "disputed") return;

    if (this.state.status !== "scoring") {
      this.state.status = "scoring";
      this.armScoreTimeout();
    }

    // Non classé : match éphémère, aucune persistance DB (ni lobby, ni preuve, ni ELO).
    if (!this.state.ranked) return;

    if (this.state.lobbyId > 0) return;
    // Création concurrente déjà en cours → on attend la MÊME promesse (le lobbyId sera
    // posé avant que evaluateScores ne tourne pour le 2e joueur).
    if (this.lobbyPromise) return this.lobbyPromise;
    const ha = this.homeAway();
    if (!ha) return;
    this.lobbyPromise = (async () => {
      try {
        const eventId = await getOrCreatePerpetualRankedEventId();
        const { lobbyId } = await createOngoingLobby({
          eventId,
          mode: this.state.mode,
          p1: { userId: ha.home.userId, eloBefore: ha.home.elo },
          p2: { userId: ha.away.userId, eloBefore: ha.away.elo },
        });
        this.state.lobbyId = lobbyId;
        void logMatchEvent({
          type: "lobby_opened",
          lobbyId,
          roomCode: this.state.roomCode,
          mode: this.state.mode,
        });
      } catch (err) {
        console.error("[ranked] createOngoingLobby failed", err);
        this.lobbyPromise = null; // autorise une nouvelle tentative à la prochaine saisie
      }
    })();
    return this.lobbyPromise;
  }

  private armScoreTimeout() {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => {
      void this.handleScoreTimeout();
    }, TIMEOUT_SCORING_MS);
  }

  private async handleScoreTimeout() {
    if (this.state.status !== "scoring" || this.finishedPersisted) return;
    void logMatchEvent({
      type: "score_timeout",
      lobbyId: this.state.lobbyId || null,
      roomCode: this.state.roomCode,
      mode: this.state.mode,
    });
    await this.evaluateScores(true);
  }

  /**
   * Évalue les saisies via la logique pure `resolveScores`. `forced` = déclenché par le
   * timeout : un joueur qui n'a pas saisi est forfait au profit de l'autre.
   */
  private async evaluateScores(forced = false) {
    if (this.finishedPersisted || this.state.status === "disputed") return;

    const ha = this.homeAway();
    // 1v1 only au MVP.
    if (!ha) {
      this.state.status = "disputed";
      this.state.disputeReason = "Mode non supporté";
      return;
    }
    const { home, away } = ha;

    const outcome = resolveScores(this.toScoreInput(home), this.toScoreInput(away), forced);

    switch (outcome.kind) {
      case "wait":
        return;
      case "agree":
        void logMatchEvent({
          type: "scores_agreed",
          roomCode: this.state.roomCode,
          mode: this.state.mode,
          detail: { scoreTeam1: outcome.s1, scoreTeam2: outcome.s2 },
        });
        await this.finalizeMatch(home, away, outcome.s1, outcome.s2);
        return;
      case "forfeit":
        await this.finalizeMatch(home, away, outcome.s1, outcome.s2, outcome.forfeitUserId);
        return;
      case "dispute":
        void logMatchEvent({
          type: "scores_disagreed",
          roomCode: this.state.roomCode,
          mode: this.state.mode,
          detail: {
            ranked: this.state.ranked,
            home: {
              userId: home.userId,
              myScore: home.myScore,
              oppScore: home.oppScore,
              submitted: home.submitted,
            },
            away: {
              userId: away.userId,
              myScore: away.myScore,
              oppScore: away.oppScore,
              submitted: away.submitted,
            },
          },
        });
        // Non classé : pas d'arbitrage admin. Hors timeout → on réinitialise les saisies
        // pour une nouvelle tentative concordante ; au timeout → partie nulle sans résultat.
        if (!this.state.ranked) {
          if (forced) await this.finalizeVoid(home, away);
          else this.resetScoringForRetry();
          return;
        }
        await this.toDispute(home, away);
        return;
    }
  }

  /** Non classé : réinitialise les saisies des 2 joueurs pour une nouvelle tentative concordante. */
  private resetScoringForRetry(): void {
    for (const p of this.state.players.values()) {
      p.submitted = false;
      p.myScore = -1;
      p.oppScore = -1;
    }
    void logMatchEvent({
      type: "score_mismatch_retry",
      roomCode: this.state.roomCode,
      mode: this.state.mode,
    });
    this.broadcast("scoreMismatch", {});
  }

  /** Non classé au timeout sans accord : clôt la partie en « nulle » (aucun ELO, aucune persistance). */
  private async finalizeVoid(home: PlayerState, away: PlayerState): Promise<void> {
    if (this.finishedPersisted) return;
    this.finishedPersisted = true;
    this.state.status = "finished";
    void logMatchEvent({
      type: "void",
      roomCode: this.state.roomCode,
      mode: this.state.mode,
    });
    this.broadcastEnded(home, away, 0, 0, undefined, { p1: 0, p2: 0 }, { p1: 0, p2: 0 }, 0);
  }

  /** Persiste + applique l'ELO + diffuse le résultat (nul possible, forfait possible). */
  private async finalizeMatch(home: PlayerState, away: PlayerState, s1: number, s2: number, forfeitUserId?: string) {
    if (this.finishedPersisted) return;
    this.finishedPersisted = true;

    // Non classé : aucune persistance ni ELO. On clôt et on diffuse un résultat « à blanc ».
    if (!this.state.ranked) {
      this.state.status = "finished";
      void logMatchEvent({
        type: "finished",
        roomCode: this.state.roomCode,
        mode: this.state.mode,
        detail: {
          ranked: false,
          scoreTeam1: s1,
          scoreTeam2: s2,
          forfeitUserId: forfeitUserId ?? null,
        },
      });
      this.broadcastEnded(
        home,
        away,
        s1,
        s2,
        forfeitUserId,
        { p1: home.elo, p2: away.elo },
        { p1: 0, p2: 0 },
        this.state.lobbyId,
      );
      return;
    }

    try {
      const matchInput = {
        eventId: 0, // ignoré par finalizeOngoingLobby (lobby déjà créé)
        mode: this.state.mode,
        p1: { userId: home.userId, score: s1, eloBefore: home.elo },
        p2: { userId: away.userId, score: s2, eloBefore: away.elo },
        contested: false,
        adminValidated: false,
        forfeitUserId,
      };

      let lobbyId: number;
      let eloAfter: { p1: number; p2: number };
      let deltas: { p1: number; p2: number };

      if (this.state.lobbyId > 0) {
        // Cas normal : le lobby 'Ongoing' existe → on le finalise (UPDATE).
        const res = await finalizeOngoingLobby(this.state.lobbyId, matchInput, this.kFactor);
        lobbyId = res.lobbyId;
        eloAfter = res.eloAfter;
        deltas = res.eloDelta;
      } else {
        // Repli (lobby jamais créé, ex. saisie échouée) : création + application directe.
        const eventId = await getOrCreatePerpetualRankedEventId();
        const res = await persistAndApplyMatch({ ...matchInput, eventId }, this.kFactor);
        lobbyId = res.lobbyId;
        eloAfter = res.eloAfter;
        deltas = res.eloDelta;
        this.state.lobbyId = lobbyId;
      }

      this.state.status = "finished";

      void logMatchEvent({
        type: "finished",
        lobbyId,
        roomCode: this.state.roomCode,
        mode: this.state.mode,
        detail: {
          scoreTeam1: s1,
          scoreTeam2: s2,
          forfeitUserId: forfeitUserId ?? null,
          eloDelta: deltas,
        },
      });

      this.broadcastEnded(home, away, s1, s2, forfeitUserId, eloAfter, deltas, lobbyId);
    } catch (err) {
      console.error("[ranked] finalizeMatch failed", err);
      this.finishedPersisted = false; // permet une nouvelle tentative
      this.state.status = "disputed";
      this.state.disputeReason = "Erreur serveur, contactez un admin";
    }
  }

  /** Diffuse `matchEnded` à chacun des 2 joueurs, du point de vue de chacun (mutualisé classé/non classé). */
  private broadcastEnded(
    home: PlayerState,
    away: PlayerState,
    s1: number,
    s2: number,
    forfeitUserId: string | undefined,
    eloAfter: { p1: number; p2: number },
    deltas: { p1: number; p2: number },
    lobbyId: number,
  ): void {
    for (const [, client] of this.clients.entries()) {
      const myUserId = this.sessionToUser.get(client.sessionId);
      if (!myUserId) continue;
      const isHome = myUserId === home.userId;
      const me = isHome ? home : away;
      const opp = isHome ? away : home;
      const myScore = isHome ? s1 : s2;
      const oppScore = isHome ? s2 : s1;
      const myDelta = isHome ? deltas.p1 : deltas.p2;
      const myAfter = isHome ? eloAfter.p1 : eloAfter.p2;
      client.send("matchEnded", {
        lobbyId,
        roomCode: this.state.roomCode,
        mode: this.state.mode,
        ranked: this.state.ranked,
        opponent: {
          userId: opp.userId,
          displayName: opp.displayName,
          avatar: opp.avatar,
        },
        result: resultLabel(myScore, oppScore),
        myScore,
        opponentScore: oppScore,
        eloBefore: me.elo,
        eloAfter: myAfter,
        eloDelta: myDelta,
        newTier: null,
        endedAt: new Date().toISOString(),
      });
    }
  }

  /** Désaccord : passe le lobby en 'Contested' avec les 2 scorelines réclamées + demande la preuve. */
  private async toDispute(home: PlayerState, away: PlayerState) {
    this.state.status = "disputed";
    this.state.disputeReason = "Scores différents — envoyez une capture de preuve, un admin tranchera.";
    try {
      const disputeInput = {
        eventId: 0,
        mode: this.state.mode,
        p1: {
          userId: home.userId,
          score: home.submitted ? home.myScore : 0,
          claimedOpp: home.submitted ? home.oppScore : undefined,
          eloBefore: home.elo,
        },
        p2: {
          userId: away.userId,
          score: away.submitted ? away.myScore : 0,
          claimedOpp: away.submitted ? away.oppScore : undefined,
          eloBefore: away.elo,
        },
        contested: true,
      };
      if (this.state.lobbyId > 0) {
        await contestOngoingLobby(this.state.lobbyId, disputeInput);
      } else {
        const eventId = await getOrCreatePerpetualRankedEventId();
        const { lobbyId } = await persistDisputedLobby({ ...disputeInput, eventId });
        this.state.lobbyId = lobbyId;
      }
    } catch (err) {
      console.error("[ranked] toDispute persistence failed", err);
    }
  }

  override onDispose() {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
  }
}
