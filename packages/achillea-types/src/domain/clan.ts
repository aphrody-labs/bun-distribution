import type { ClanMemberDistinction, ClanMemberRole } from "../enums/clanMemberRole";
import type { ClanState } from "../enums/clanState";

import type { Country } from "./common";
import type { Rank, UserDTO } from "./user";

export interface ClanDTO {
  id: number;
  /**
   * Identifiants Discord des fondateurs.
   *
   * L'API en renvoie un TABLEAU. Le contrat disait `string`, donc la
   * validation rejetait chaque clan : les 42 clans existaient, l'API les
   * servait, et la page affichait « 0 clan trouvé ».
   */
  founders: string[];
  name: string;
  shortenedName: string;
  normalizedShortName: string;
  clanAvatarUrl: string;
  clanBiography: string;
  /** Absent de la charge utile de `GET /clans` : optionnel. */
  fame?: number;
  xUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  isRecruiting: boolean;
  isInactive: boolean;
  isHidden: boolean;
  isDisbanded: boolean;
  autoAcceptMembers: boolean;
  state: ClanState;
  createdAt: Date;
  languages: string[];
  origin: string;
  experience: { currentLevel: number; totalXp: number };
  membersCount: number;
  president: UserDTO;
}

export interface ClanMemberDTO {
  /** Rôle du membre dans le clan (Trial, Member, SubCaptain, Captain). */
  clanRole: ClanMemberRole;
  /** Distinctions brutes telles que stockées (`['Staff', 'Player']`). */
  distinctions: string[];
  clanFameContributed: number;
  createdAt: Date;
  updatedAt: Date;
  user: UserDTO;
}

export interface ClanApplicationDTO {
  id: number;
  user: UserDTO;
  clan: ClanDTO;
  distinctions: ClanMemberDistinction[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ClanInviteDTO {
  id: number;
  user: UserDTO;
  clan: ClanDTO;
  inviter: ClanMemberDTO;
  threadId?: string;
  distinctions: ClanMemberDistinction[];
  createdAt: Date;
  updatedAt: Date;
  lastNotifiedAt: Date;
}

/** Création d'un clan (POST /clans/create, API Achilléa historique). */
export interface NewClanPayload {
  founders: Array<{ id: string }>;
  logo: string;
  name: string;
  normalizedName: string;
  shortName: string;
  normalizedShortName: string;
  description: string;
  twitter?: string;
  instagram?: string;
  tiktok?: string;
  origin?: Country;
  languages?: Country[];
}

/** Mise à jour partielle d'un clan (PUT /clans/:id). */
export interface UpdateClanPayload {
  name?: string;
  shortenedName?: string;
  clanBiography?: string;
  clanAvatarUrl?: string;
  xUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  isRecruiting?: boolean;
  autoAcceptMembers?: boolean;
  languages?: string[];
  origin?: string;
}

/**
 * Forme historique dénormalisée (snake_case) encore servie par quelques vues.
 * Conservée pour compatibilité ; toute nouvelle route doit renvoyer `ClanDTO`.
 */
export interface Clan {
  id: number;
  logo: string;
  name: string;
  shortName: string;
  description: string;
  captain: string;
  founders: string[];
  x_url?: string;
  instagram_url?: string;
  tiktok_url?: string;
  fame: number;
  xp: number;
  rank?: Rank;
  created_at: Date;
  isPro: boolean;
  isRecruiting: boolean;
  autoRecruit: boolean;
  langue?: string;
}
