/**
 * Formes de tournoi réellement transportées + résultats des mutations.
 *
 * Les types `Wire*` existent parce que l'ORM sérialise souvent une relation
 * comme un identifiant nu plutôt que comme l'entité peuplée. Ils dérivent du
 * DTO par `Omit` : une évolution de `Tournament` se propage ici et casse le
 * type-check, au lieu de passer inaperçue.
 */

import type { ScoreReportPolicy, TournamentState } from "../enums/eventEnums";

import type { ApiEnvelope, EntityRef, SuccessResponse } from "./api";
import type { OrganizationDTO } from "./organization";
import type { ParticipantDTO, Tournament, TournamentSeries } from "./tournament";
import type { UserDTO } from "./user";

/** `TournamentSeries` sans sa récursion de tournois peuplés. */
export interface WireTournamentSeries extends Omit<TournamentSeries, "organization" | "tournaments"> {
  organization: EntityRef<OrganizationDTO>;
  tournaments?: Array<EntityRef<WireTournament>>;
}

/** `Tournament` tel qu'il circule (relations éventuellement réduites à un id). */
export interface WireTournament extends Omit<Tournament, "series" | "organization" | "managers" | "participants"> {
  series?: EntityRef<WireTournamentSeries> | null;
  organization: EntityRef<OrganizationDTO>;
  /**
   * Relations OPTIONNELLES sur la liste.
   *
   * `GET /tournaments` ne les peuple pas — seul `GET /tournaments/:id` le
   * fait. Les exiger faisait rejeter les 9 tournois de la liste et affichait
   * « Aucun tournoi trouvé » sur une API qui en servait neuf.
   */
  managers?: Array<EntityRef<UserDTO>>;
  participants?: Array<EntityRef<WireParticipant>>;
}

/** `ParticipantDTO` tel qu'il circule (le tournoi n'est souvent qu'un id). */
export interface WireParticipant extends Omit<ParticipantDTO, "tournament"> {
  tournament: EntityRef<WireTournament>;
}

/**
 * Réponse de `GET /tournaments/:id` — un triplet, pas un objet : c'est la
 * forme réellement servie. Le décrire tel quel évite qu'un client invente une
 * normalisation que le suivant ne ferait pas.
 *
 * `[tournoi, inscrits, données brutes de brackets-manager]`.
 */
export type TournamentDetail = [WireTournament, WireParticipant[], unknown];

export interface OpenRegistrationsResult {
  success: boolean;
  id: number;
  internalState: TournamentState;
}

export interface ScorePolicyResult {
  success: boolean;
  scoreReportPolicy: ScoreReportPolicy;
  error?: string;
}

export interface DisqualifyResult extends SuccessResponse {
  forfeitedLobbies?: number;
  promoted?: string | null;
}

export interface ParticipantMutationResult extends SuccessResponse {
  participant?: WireParticipant;
}

export interface CloseTournamentResult extends SuccessResponse {
  openLobbies?: number;
}

export interface CancelTournamentResult extends SuccessResponse {
  notified?: number;
}

export interface RestoreTournamentResult extends SuccessResponse {
  internalState?: TournamentState;
}

export interface PlacementPrizesResult extends SuccessResponse {
  applied?: boolean;
  reason?: string;
  deltas?: Record<string, number>;
  tournamentSize?: number;
}

export interface SeedingResult {
  participantId: number;
  seed: number | null;
  previousSeed: number | null;
  swappedWith: string | null;
  bracketUpdated: boolean;
}

export interface SeedBatchResult {
  mode: string;
  bracketUpdated: boolean;
  assignments?: unknown[];
  cleared?: number;
}

/** Enveloppe générique des mutations de tournoi. */
export type TournamentEnvelope<T> = ApiEnvelope<T>;
