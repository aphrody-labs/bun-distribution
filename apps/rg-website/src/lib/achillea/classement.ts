import "server-only";

/**
 * Classement e-sport, lu EN BASE.
 *
 * POURQUOI PAS L'API
 * Le site interrogeait `https://ranked.rosegriffon.fr/api` pour afficher le
 * classement : un aller-retour HTTP vers un service voisin, avec son délai de
 * 8 secondes, son `try/catch` et son écran vide quand il ne répond pas — pour
 * des lignes qui vivent dans la MÊME base Postgres depuis la fusion. Les
 * compteurs de l'accueil restaient donc à zéro dès que l'API bronchait.
 *
 * `achillea.user_elo` et `achillea."user"` se joignent ici en une requête, dans
 * la même connexion que le reste de la page. L'API HTTP garde tout son sens
 * pour les écrans e-sport riches (files d'attente, matchs en cours) ; pour un
 * top 5 et trois compteurs, elle coûtait plus qu'elle ne rapportait.
 */

import { getPgPoolOrNull } from "@/lib/db/pg";

/** Mode de jeu classé. `2` = 1 contre 1, `4` = 2 contre 2. */
export type ModeClasse = 2 | 4;

export interface LigneClassement {
  rang: number;
  userId: string;
  nom: string;
  avatar: string | null;
  elo: number;
  victoires: number;
  defaites: number;
  parties: number;
  /** Palier Achilléa (Or, Platine, Diamant…), `null` hors barème. */
  palier: string | null;
}

export interface ChiffresEsport {
  joueurs: number;
  clans: number;
  partiesClassees: number;
}

export interface PreviewClan {
  id: number;
  name: string;
  shortenedName: string;
  clanAvatarUrl: string | null;
  clanBiography: string | null;
  membersCount: number;
  isRecruiting: boolean;
}

export interface PreviewTournament {
  id: number;
  name: string;
  starts_at: string | null;
  tournament_type: string | null;
  status: string;
  internal_state: string;
  participants_number: number | null;
  logo: string | null;
  affiche?: string | null;
  description?: string | null;
}

/**
 * Tête du classement.
 *
 * Seuls les joueurs ayant RÉELLEMENT joué apparaissent : une table d'ELO
 * contient une ligne par inscrit, dont 3 840 à zéro partie, et un classement
 * qui commence par des comptes à 0-0 ne classe rien.
 */
export async function lireClassement(mode: ModeClasse = 2, limite = 5): Promise<LigneClassement[]> {
  try {
    const pool = getPgPoolOrNull();
    if (!pool) return [];

    const { rows } = await pool.query<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      avatar: string | null;
      elo: number;
      wins: number;
      losses: number;
      games_played: number;
      palier: string | null;
    }>(
      `SELECT e.user_id, u.username, u.display_name, u.avatar,
			        e.elo, e.wins, e.losses, e.games_played,
			        r.key AS palier
			   FROM achillea.user_elo e
			   JOIN achillea."user" u ON u.id = e.user_id
			   LEFT JOIN achillea.rank r ON e.elo BETWEEN r.min_elo AND r.max_elo
			  WHERE e.mode = $1
			    AND e.games_played > 0
			  ORDER BY e.elo DESC, e.wins DESC
			  LIMIT $2`,
      [mode, limite],
    );

    return rows.map((ligne, index) => ({
      avatar: ligne.avatar,
      defaites: ligne.losses,
      elo: ligne.elo,
      nom: ligne.display_name || ligne.username || "Joueur",
      palier: ligne.palier,
      parties: ligne.games_played,
      rang: index + 1,
      userId: ligne.user_id,
      victoires: ligne.wins,
    }));
  } catch (error) {
    console.error("Erreur lireClassement:", error);
    return [];
  }
}

/** Les trois chiffres de l'e-sport affichés sur l'accueil. */
export async function lireChiffresEsport(): Promise<ChiffresEsport> {
  try {
    const pool = getPgPoolOrNull();
    if (!pool) return { clans: 0, joueurs: 0, partiesClassees: 0 };

    const { rows } = await pool.query<{
      joueurs: string;
      clans: string;
      parties_classees: string;
    }>(
      `SELECT (SELECT count(*) FROM achillea."user")                          AS joueurs,
			        (SELECT count(*) FROM achillea.clan
			          WHERE is_disbanded = false AND is_hidden = false)               AS clans,
			        (SELECT COALESCE(sum(games_played), 0) / 2 FROM achillea.user_elo) AS parties_classees`,
    );

    const ligne = rows[0];
    return {
      clans: Number(ligne?.clans ?? 0),
      joueurs: Number(ligne?.joueurs ?? 0),
      // Chaque partie compte pour ses deux camps : la somme des `games_played`
      // vaut donc deux fois le nombre de rencontres.
      partiesClassees: Number(ligne?.parties_classees ?? 0),
    };
  } catch (error) {
    console.error("Erreur lireChiffresEsport:", error);
    return { clans: 0, joueurs: 0, partiesClassees: 0 };
  }
}

/** Récupère les clans compétitifs les plus actifs directement depuis Postgres. */
export async function lireClansActifs(limite = 4): Promise<PreviewClan[]> {
  try {
    const pool = getPgPoolOrNull();
    if (!pool) return [];
    const { rows } = await pool.query<PreviewClan>(
      `SELECT id, name, "shortenedName", "clanAvatarUrl", "clanBiography", "membersCount", "isRecruiting"
			 FROM achillea.clan_list_view 
			 WHERE "isDisbanded" = false AND "isHidden" = false
			 ORDER BY "membersCount" DESC, id ASC 
			 LIMIT $1`,
      [limite],
    );
    return rows;
  } catch (error) {
    console.error("Erreur lireClansActifs:", error);
    return [];
  }
}

/** Récupère les tournois homologués en activité ou à venir depuis Postgres. */
export async function lireTournoisActifs(limite = 4): Promise<PreviewTournament[]> {
  try {
    const pool = getPgPoolOrNull();
    if (!pool) return [];
    const { rows } = await pool.query<PreviewTournament>(
      `SELECT id, name, description, starts_at, tournament_type, status, internal_state, participants_number, logo, affiche
			 FROM achillea.event 
			 WHERE status != 'Canceled' AND internal_state != 'Pending'
			 ORDER BY CASE internal_state
			   WHEN 'Ongoing' THEN 1
			   WHEN 'Preparing' THEN 2
			   WHEN 'Preregistering' THEN 3
			   WHEN 'Open' THEN 4
			   ELSE 5 END,
			   starts_at DESC 
			 LIMIT $1`,
      [limite],
    );
    return rows;
  } catch (error) {
    console.error("Erreur lireTournoisActifs:", error);
    return [];
  }
}
