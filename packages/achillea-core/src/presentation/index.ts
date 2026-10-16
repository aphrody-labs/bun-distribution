/**
 * Tonalités d'affichage — couche de présentation *neutre*.
 *
 * Le métier décide « ceci est grave », pas « ceci est rouge ». Chaque cible
 * (PrimeNG côté Angular, shadcn/Tailwind côté Next.js, un HUD de jeu Rust)
 * traduit ensuite un `Tone` en son propre vocabulaire via les tables
 * d'adaptation fournies plus bas.
 *
 * Les valeurs de `Tone` sont volontairement celles de `severity` PrimeNG :
 * l'app Angular existante les consomme sans conversion, et rien n'y est
 * spécifique à PrimeNG — ce sont des mots anglais neutres.
 */

import {
  CastAvailabilityStatus,
  CastEventStatus,
  LicenseStatus,
  OrganizationState,
  ParticipantStatus,
  PlayerNoteSeverity,
  SanctionType,
  TournamentState,
  WalletTransactionDirection,
} from "@rosegriffon/achillea-types";

export type Tone = "success" | "warn" | "info" | "danger" | "secondary" | "contrast";

/** Variante `shadcn/ui` `<Badge>` la plus proche d'un `Tone`. */
export const TONE_TO_SHADCN_BADGE: Record<Tone, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default",
  warn: "outline",
  info: "secondary",
  danger: "destructive",
  secondary: "secondary",
  contrast: "outline",
};

/**
 * Classes Tailwind de repli, exprimées en tokens sémantiques du design system
 * Rose Griffon (`packages/ui`). Un projet tiers peut fournir sa propre table.
 */
export const TONE_TO_TAILWIND: Record<Tone, string> = {
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  danger: "bg-red-500/15 text-red-600 dark:text-red-400",
  secondary: "bg-muted text-muted-foreground",
  contrast: "bg-foreground text-background",
};

// ── Modération ──────────────────────────────────────────────────────────────

export function sanctionTypeTone(type: SanctionType): Tone {
  switch (type) {
    case SanctionType.Ban:
      return "danger";
    case SanctionType.Mute:
    case SanctionType.Kick:
      return "warn";
    case SanctionType.Warn:
      return "info";
    default:
      return "secondary";
  }
}

export function playerNoteSeverityTone(severity: PlayerNoteSeverity): Tone {
  switch (severity) {
    case PlayerNoteSeverity.SERIOUS:
      return "danger";
    case PlayerNoteSeverity.WARNING:
      return "warn";
    default:
      return "info";
  }
}

// ── Casts ───────────────────────────────────────────────────────────────────

export function castEventStatusTone(status: CastEventStatus): Tone {
  switch (status) {
    case CastEventStatus.Live:
      return "danger";
    case CastEventStatus.OpenSignup:
      return "info";
    case CastEventStatus.Attributed:
      return "warn";
    case CastEventStatus.Done:
      return "success";
    default:
      return "secondary";
  }
}

export function castAvailabilityStatusTone(status: CastAvailabilityStatus): Tone {
  switch (status) {
    case CastAvailabilityStatus.Available:
      return "success";
    case CastAvailabilityStatus.Maybe:
      return "warn";
    case CastAvailabilityStatus.Unavailable:
      return "danger";
    default:
      return "secondary";
  }
}

// ── Tournois ────────────────────────────────────────────────────────────────

export function tournamentStateTone(state: TournamentState): Tone {
  switch (state) {
    case TournamentState.ONGOING:
      return "success";
    case TournamentState.PREREGISTERING:
    case TournamentState.PREPARING:
      return "info";
    case TournamentState.PENDING:
      return "warn";
    case TournamentState.CANCELED:
      return "danger";
    default:
      return "secondary";
  }
}

export function participantStatusTone(status: ParticipantStatus): Tone {
  switch (status) {
    case ParticipantStatus.ACTIVE:
      return "success";
    case ParticipantStatus.WAITLISTED:
      return "warn";
    case ParticipantStatus.DISQUALIFIED:
      return "danger";
    default:
      return "secondary";
  }
}

// ── Licences, organisations, portefeuille ───────────────────────────────────

export function licenseStatusTone(status: LicenseStatus): Tone {
  switch (status) {
    case LicenseStatus.Active:
      return "success";
    case LicenseStatus.Revoked:
      return "danger";
    default:
      return "secondary";
  }
}

export function organizationStateTone(state: OrganizationState): Tone {
  switch (state) {
    case OrganizationState.Approved:
      return "success";
    case OrganizationState.Rejected:
      return "danger";
    default:
      return "warn";
  }
}

export function walletDirectionTone(direction: WalletTransactionDirection): Tone {
  return direction === WalletTransactionDirection.In ? "success" : "danger";
}
