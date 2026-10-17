/**
 * Règles métier PURES des tournois (aucune dépendance DB / ORM / réseau).
 *
 * Extraites de TournamentsService / BracketService pour être testables unitairement
 * et verrouiller deux bugs corrigés :
 *  - l'autorisation organisateur (un prédicat truthy laissait passer n'importe qui),
 *  - la résolution d'une série DOUBLE_LEG à égalité (le lobby restait bloqué à jamais).
 */
import { LobbyState, MatchFormat, ParticipantStatus, TeamSide } from "../enums";

/**
 * Vrai si `userId` est organisateur du tournoi : propriétaire de l'organisation,
 * manager de l'organisation, ou TO directement rattaché au tournoi.
 */
export function userIsTournamentOrganizer(
  ownerId: string,
  orgManagerUserIds: readonly string[],
  tournamentManagerUserIds: readonly string[],
  userId: string,
): boolean {
  if (ownerId === userId) return true;
  if (orgManagerUserIds.includes(userId)) return true;

  return tournamentManagerUserIds.includes(userId);
}

/**
 * Fenêtre de publication d'un tournoi et plafond de tournois ouverts par organisation.
 *
 * Reprend la règle du cadrage : « un tournoi se doit d'être publié au moins 1 semaine
 * à l'avance et ne peut pas être publié plus de X semaines/mois à l'avance ; une
 * organisation ne peut pas avoir plus de X tournois ouverts en même temps ». Les `X`
 * n'ayant jamais été tranchés, ils sont paramétrables (variables d'environnement,
 * cf. `tournamentRulesConfig`) avec des valeurs par défaut explicites.
 */
export interface PublicationWindow {
  /** Délai minimum entre la publication et le début du tournoi. */
  minLeadDays: number;
  /** Horizon maximum : au-delà, la date de début est jugée trop lointaine. */
  maxLeadDays: number;
}

export const DEFAULT_PUBLICATION_WINDOW: PublicationWindow = {
  minLeadDays: 7,
  maxLeadDays: 180,
};

/** Nombre maximum de tournois ouverts (ni terminés ni annulés) par organisation. */
export const DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG = 5;

export type RuleViolation = { rule: string; message: string };

const MS_PER_DAY = 86_400_000;

/** Jours entiers (arrondis au plus proche) entre `now` et `startsAt`. */
export function leadTimeInDays(startsAt: Date, now: Date): number {
  return (startsAt.getTime() - now.getTime()) / MS_PER_DAY;
}

/**
 * Vérifie la fenêtre de publication. Renvoie `null` si la date est acceptable,
 * sinon la violation à remonter en 400.
 */
export function checkPublicationWindow(
  startsAt: Date,
  now: Date,
  publicationWindow: PublicationWindow = DEFAULT_PUBLICATION_WINDOW,
): RuleViolation | null {
  const lead = leadTimeInDays(startsAt, now);

  if (lead < publicationWindow.minLeadDays) {
    return {
      rule: "min_lead_time",
      message: `Un tournoi doit être publié au moins ${publicationWindow.minLeadDays} jours avant son début (actuellement ${Math.max(0, Math.floor(lead))} jour(s)).`,
    };
  }

  if (lead > publicationWindow.maxLeadDays) {
    return {
      rule: "max_lead_time",
      message: `Un tournoi ne peut pas être publié plus de ${publicationWindow.maxLeadDays} jours à l'avance (actuellement ${Math.ceil(lead)} jours).`,
    };
  }

  return null;
}

/**
 * Vérifie le plafond de tournois ouverts d'une organisation.
 * `openCount` est le nombre de tournois **hors** celui en cours de création.
 */
export function checkOpenTournamentsLimit(
  openCount: number,
  max: number = DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG,
): RuleViolation | null {
  if (openCount >= max) {
    return {
      rule: "max_open_tournaments",
      message: `Cette organisation a déjà ${openCount} tournois ouverts (maximum ${max}). Termine ou annule un tournoi avant d'en créer un autre.`,
    };
  }

  return null;
}

export interface WaitlistCandidate {
  id: number;
  status: ParticipantStatus;
  registeredAt: Date;
}

/**
 * Position de chaque joueur en liste d'attente (1 = prochain promu), par ordre
 * d'inscription.
 *
 * Calculée à la lecture plutôt que stockée : une position en colonne devrait être
 * recompactée à chaque promotion ou désistement, et une seule mise à jour ratée
 * laisserait un trou (deux joueurs « 3e », personne « 2e »). Ici l'ordre d'arrivée est
 * la seule source de vérité, et il ne bouge jamais.
 */
export function computeWaitlistPositions(participants: readonly WaitlistCandidate[]): Map<number, number> {
  const positions = new Map<number, number>();

  participants
    .filter(p => p.status === ParticipantStatus.WAITLISTED)
    .slice()
    .sort((a, b) => {
      const delta = a.registeredAt.getTime() - b.registeredAt.getTime();
      // Deux inscriptions à la même milliseconde (import, script) : l'id départage,
      // sinon l'ordre dépendrait de celui, non garanti, renvoyé par la base.
      return delta !== 0 ? delta : a.id - b.id;
    })
    .forEach((p, index) => positions.set(p.id, index + 1));

  return positions;
}

export type SeriesMatch = {
  isValidated: boolean;
  scoreTeam1: number;
  scoreTeam2: number;
};

export type SeriesOutcome =
  | { status: "pending" }
  | { status: "tie" }
  | { status: "decided"; winner: TeamSide; scoreT1: number; scoreT2: number };

/**
 * Résout l'issue d'une série (lobby) en fonction du format.
 *
 *  - DOUBLE_LEG : cumul des buts des deux manches (les deux doivent être validées).
 *    Égalité au cumul → `tie` (pas de départage automatique, arbitrage manuel).
 *  - BO impair : premier à `ceil(n/2)` manches gagnées (les manches non validées
 *    sont ignorées tant que le seuil n'est pas atteint → `pending`).
 */
export function computeSeriesOutcome(matchFormat: MatchFormat, matches: readonly SeriesMatch[]): SeriesOutcome {
  if (matchFormat === MatchFormat.DOUBLE_LEG) {
    if (matches.some(m => !m.isValidated)) return { status: "pending" };

    let scoreT1 = 0;
    let scoreT2 = 0;
    for (const m of matches) {
      scoreT1 += m.scoreTeam1;
      scoreT2 += m.scoreTeam2;
    }

    if (scoreT1 > scoreT2) return { status: "decided", winner: TeamSide.TEAM_1, scoreT1, scoreT2 };
    if (scoreT2 > scoreT1) return { status: "decided", winner: TeamSide.TEAM_2, scoreT1, scoreT2 };

    return { status: "tie" };
  }

  const winsNeeded = Math.ceil(matches.length / 2);

  let scoreT1 = 0;
  let scoreT2 = 0;
  for (const m of matches) {
    if (!m.isValidated) continue;
    if (m.scoreTeam1 > m.scoreTeam2) scoreT1++;
    if (m.scoreTeam2 > m.scoreTeam1) scoreT2++;
  }

  if (scoreT1 >= winsNeeded) return { status: "decided", winner: TeamSide.TEAM_1, scoreT1, scoreT2 };
  if (scoreT2 >= winsNeeded) return { status: "decided", winner: TeamSide.TEAM_2, scoreT1, scoreT2 };

  return { status: "pending" };
}

/**
 * Détermine le côté gagnant d'un lobby tournoi à partir des scores / forfaits.
 * Utilisé par EloService (going-forward) et le script de backfill.
 */
export function resolveTournamentSideOutcome(
  team1: Array<{ score: number; forfeit: boolean }>,
  team2: Array<{ score: number; forfeit: boolean }>,
  lobbyState: LobbyState,
): { winner: TeamSide | null } | null {
  const t1Forfeit = team1.some(u => u.forfeit);
  const t2Forfeit = team2.some(u => u.forfeit);

  if (t1Forfeit && !t2Forfeit) return { winner: TeamSide.TEAM_2 };
  if (t2Forfeit && !t1Forfeit) return { winner: TeamSide.TEAM_1 };
  if (t1Forfeit && t2Forfeit) return null;

  const s1 = team1[0]?.score ?? 0;
  const s2 = team2[0]?.score ?? 0;

  if (s1 > s2) return { winner: TeamSide.TEAM_1 };
  if (s2 > s1) return { winner: TeamSide.TEAM_2 };

  // Forfait sans scores déjà géré ; si Finished avec scores égaux → nul
  if (lobbyState === LobbyState.FINISHED && s1 === s2) return { winner: null };

  return null;
}
