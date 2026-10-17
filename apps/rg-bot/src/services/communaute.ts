/**
 * Accès base de la vie de communauté — niveaux, jetons Kizuna, collection.
 *
 * ── LA RÈGLE DE CE FICHIER ─────────────────────────────────────────────────
 * Tout ce qui DÉCIDE est ailleurs, dans des modules purs et testés
 * (`lib/experience.ts`, `lib/kizuna.ts`, `lib/collection.ts`,
 * `lib/reglages-communaute.ts`). Ici, on ne fait qu'écrire et lire. C'est ce
 * qui permet de couvrir les règles du jeu par `bun test` sans base ni bot.
 *
 * ── LE SOLDE ET SON JOURNAL NE SE SÉPARENT JAMAIS ──────────────────────────
 * Chaque mouvement de jetons écrit DEUX lignes : le nouveau solde dans
 * `bot_profils`, le mouvement signé dans `bot_journal_kizuna`. Les deux
 * partent dans la MÊME transaction, sans exception. Un solde qui bouge sans
 * ligne de journal est indéfendable le jour où quelqu'un conteste : la seule
 * réponse possible serait « la base dit 40 ».
 *
 * L'invariant qui en découle se vérifie en une requête, et c'est voulu :
 *
 *   select p.discord_id, p.jetons, coalesce(sum(j.delta), 0)
 *     from bot_profils p
 *     left join bot_journal_kizuna j using (guild_id, discord_id)
 *    group by p.discord_id, p.jetons
 *   having p.jetons <> coalesce(sum(j.delta), 0);
 *
 * (zéro ligne = tout va bien.)
 */
import { sql, inagleSql } from "../lib/db";
import { cached, invalidate } from "../lib/cache";
import { DON, etatQuotidien, jourCivil, verifierDepense, type Motif } from "../lib/kizuna";
import {
  garantieAuTirage,
  prixDePlaque,
  remboursementDoublon,
  TARIFS,
  type Categorie,
} from "../lib/collection";
import { GAIN_DEFAUT, niveauPour, niveauxFranchis, jetonsDeMontee } from "../lib/experience";
import { lireReglages, type ReglagesCommunaute } from "../lib/reglages-communaute";

// ─── Réglages ───────────────────────────────────────────────────────────────

const TTL_REGLAGES_MS = 60_000;

function cleReglages(guildId: string): string {
  return `communaute:reglages:${guildId}`;
}

/**
 * Réglages d'une guilde, avec un cache court.
 *
 * Une minute : assez pour ne pas relire la base à chaque message d'un serveur
 * actif, assez peu pour qu'un réglage changé par le staff prenne effet avant
 * qu'il n'ait fini de se demander si ça a marché.
 */
export async function reglagesDe(guildId: string): Promise<ReglagesCommunaute> {
  return await cached(cleReglages(guildId), TTL_REGLAGES_MS, async () => {
    const lignes = await sql<Array<{ valeurs: unknown }>>`
			SELECT valeurs FROM bot_reglages_guilde WHERE guild_id = ${guildId} LIMIT 1
		`;
    return lireReglages(lignes[0]?.valeurs);
  });
}

/** Écrit les réglages et invalide le cache — dans cet ordre. */
export async function enregistrerReglages(guildId: string, reglages: ReglagesCommunaute): Promise<void> {
  // ⚠ NE PAS `JSON.stringify(reglages)` ici : Bun.SQL encode déjà en JSON
  // toute valeur liée à un paramètre casté `::jsonb`. Stringifier avant coup
  // double l'encodage — la colonne reçoit une CHAÎNE contenant du JSON, pas
  // un objet, et `jsonb_typeof()` répond `string` au lieu de `object`. La
  // lecture suivante (`lireReglages`, zod) échoue alors sur « expected
  // object, received string » et retombe sur les défauts, EFFAÇANT en
  // pratique tout réglage déjà posé au prochain `fusionnerReglages`. Vérifié
  // en direct le 14/8/2026 : `${reglages}::jsonb` produit un objet,
  // `${JSON.stringify(reglages)}::jsonb` une chaîne, à chaque fois.
  await sql`
		INSERT INTO bot_reglages_guilde (guild_id, valeurs, maj_le)
		VALUES (${guildId}, ${reglages}::jsonb, NOW())
		ON CONFLICT (guild_id) DO UPDATE
			SET valeurs = EXCLUDED.valeurs, maj_le = NOW()
	`;
  invalidate(cleReglages(guildId));
}

// ─── Profil ─────────────────────────────────────────────────────────────────

export interface ProfilCommunaute {
  guildId: string;
  discordId: string;
  xp: number;
  niveau: number;
  jetons: number;
  jetonsGagnes: number;
  messagesComptes: number;
  dernierQuotidienLe: string | null;
  serieQuotidienne: number;
  plaque: string | null;
  titre: string | null;
  persoFavori: string | null;
}

interface LigneProfil {
  guild_id: string;
  discord_id: string;
  xp: string | number;
  niveau: number;
  jetons: number;
  jetons_gagnes: string | number;
  messages_comptes: string | number;
  dernier_quotidien_le: string | Date | null;
  serie_quotidienne: number;
  plaque: string | null;
  titre: string | null;
  perso_favori: string | null;
}

/**
 * `bigint` arrive de Postgres en CHAÎNE (le type dépasse `Number.MAX_SAFE_INTEGER`).
 * Nos valeurs, elles, tiennent largement — 2 878 742 XP au plafond — mais un
 * `"1234" + 20` silencieux donnerait `"123420"`, et personne ne le verrait avant
 * qu'un classement ne soit absurde.
 */
function nombre(valeur: string | number | null | undefined): number {
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) ? valeur : 0;
  }
  if (typeof valeur === "string" && valeur.trim() !== "") {
    const converti = Number(valeur);
    return Number.isFinite(converti) ? converti : 0;
  }
  return 0;
}

function versProfil(ligne: LigneProfil): ProfilCommunaute {
  return {
    discordId: ligne.discord_id,
    dernierQuotidienLe:
      ligne.dernier_quotidien_le instanceof Date
        ? jourCivil(ligne.dernier_quotidien_le)
        : typeof ligne.dernier_quotidien_le === "string"
          ? ligne.dernier_quotidien_le.slice(0, 10)
          : null,
    guildId: ligne.guild_id,
    messagesComptes: nombre(ligne.messages_comptes),
    niveau: ligne.niveau,
    persoFavori: ligne.perso_favori,
    plaque: ligne.plaque,
    jetons: ligne.jetons,
    jetonsGagnes: nombre(ligne.jetons_gagnes),
    serieQuotidienne: ligne.serie_quotidienne,
    titre: ligne.titre,
    xp: nombre(ligne.xp),
  };
}

/** Profil vierge — celui d'un membre qui n'a encore rien fait. Jamais écrit. */
function profilVierge(guildId: string, discordId: string): ProfilCommunaute {
  return {
    dernierQuotidienLe: null,
    discordId,
    guildId,
    messagesComptes: 0,
    niveau: 1,
    persoFavori: null,
    plaque: null,
    jetons: 0,
    jetonsGagnes: 0,
    serieQuotidienne: 0,
    titre: null,
    xp: 0,
  };
}

const COLONNES_PROFIL = sql`
	guild_id, discord_id, xp, niveau, jetons, jetons_gagnes, messages_comptes,
	dernier_quotidien_le, serie_quotidienne, plaque, titre, perso_favori
`;

/**
 * Le profil d'un membre.
 *
 * Ne CRÉE rien : afficher la carte de quelqu'un ne doit pas lui fabriquer une
 * ligne. Une table de deux mille lignes vides fausserait tous les classements
 * (« 1 850ᵉ sur 2 075 » pour qui n'a jamais parlé) et gonflerait la base sans
 * rien apprendre.
 */
export async function profilDe(guildId: string, discordId: string): Promise<ProfilCommunaute> {
  const lignes = await sql<LigneProfil[]>`
		SELECT ${COLONNES_PROFIL} FROM bot_profils
		WHERE guild_id = ${guildId} AND discord_id = ${discordId}
		LIMIT 1
	`;
  const ligne = lignes[0];
  return ligne ? versProfil(ligne) : profilVierge(guildId, discordId);
}

/** Le rang du membre au classement d'XP, `null` s'il n'a pas de ligne. */
export async function rangClassement(
  guildId: string,
  discordId: string,
  critere: "xp" | "jetons_gagnes" = "xp",
): Promise<{ rang: number; total: number } | null> {
  // Deux requêtes plutôt qu'une fenêtre sur toute la table : le rang d'un seul
  // membre se compte, il ne se numérote pas.
  const [total] = await sql<Array<{ total: string }>>`
		SELECT count(*)::text AS total FROM bot_profils WHERE guild_id = ${guildId}
	`;
  const lignes =
    critere === "xp"
      ? await sql<Array<{ devant: string; valeur: string }>>`
				SELECT (SELECT count(*) FROM bot_profils d
				         WHERE d.guild_id = ${guildId} AND d.xp > p.xp)::text AS devant,
				       p.xp::text AS valeur
				  FROM bot_profils p
				 WHERE p.guild_id = ${guildId} AND p.discord_id = ${discordId}
			`
      : await sql<Array<{ devant: string; valeur: string }>>`
				SELECT (SELECT count(*) FROM bot_profils d
				         WHERE d.guild_id = ${guildId} AND d.jetons_gagnes > p.jetons_gagnes)::text AS devant,
				       p.jetons_gagnes::text AS valeur
				  FROM bot_profils p
				 WHERE p.guild_id = ${guildId} AND p.discord_id = ${discordId}
			`;
  const ligne = lignes[0];
  if (!ligne) {
    return null;
  }
  return { rang: nombre(ligne.devant) + 1, total: nombre(total?.total) };
}

export interface LigneClassement {
  discordId: string;
  xp: number;
  niveau: number;
  jetonsGagnes: number;
  messagesComptes: number;
}

/** Une page de classement, du plus haut au plus bas. */
export async function classement(
  guildId: string,
  options: { critere?: "xp" | "jetons_gagnes"; limite?: number; decalage?: number } = {},
): Promise<LigneClassement[]> {
  const limite = Math.min(100, Math.max(1, Math.floor(options.limite ?? 10)));
  const decalage = Math.max(0, Math.floor(options.decalage ?? 0));
  const lignes =
    options.critere === "jetons_gagnes"
      ? await sql<LigneProfil[]>`
				SELECT ${COLONNES_PROFIL} FROM bot_profils
				 WHERE guild_id = ${guildId} AND jetons_gagnes > 0
				 ORDER BY jetons_gagnes DESC, discord_id ASC
				 LIMIT ${limite} OFFSET ${decalage}
			`
      : await sql<LigneProfil[]>`
				SELECT ${COLONNES_PROFIL} FROM bot_profils
				 WHERE guild_id = ${guildId} AND xp > 0
				 ORDER BY xp DESC, discord_id ASC
				 LIMIT ${limite} OFFSET ${decalage}
			`;
  return lignes.map(ligne => {
    const profil = versProfil(ligne);
    return {
      discordId: profil.discordId,
      messagesComptes: profil.messagesComptes,
      niveau: profil.niveau,
      jetonsGagnes: profil.jetonsGagnes,
      xp: profil.xp,
    };
  });
}

/** Nombre de membres classés (au moins un point d'XP). */
export async function nombreClasses(guildId: string): Promise<number> {
  const [ligne] = await sql<Array<{ total: string }>>`
		SELECT count(*)::text AS total FROM bot_profils WHERE guild_id = ${guildId} AND xp > 0
	`;
  return nombre(ligne?.total);
}

// ─── Expérience ─────────────────────────────────────────────────────────────

export interface GainExperience {
  xpAvant: number;
  xpApres: number;
  niveauAvant: number;
  niveauApres: number;
  /** Niveaux franchis, dans l'ordre. Vide quand le membre n'a pas monté. */
  franchis: number[];
  /** Jetons Kizuna offerts par les montées, `0` s'il n'y en a pas eu. */
  jetonsOfferts: number;
}

/**
 * Ajoute de l'XP et rend ce qui a changé.
 *
 * L'addition est faite PAR POSTGRES (`xp = bot_profils.xp + …`) et non en
 * TypeScript : deux messages traités en parallèle liraient sinon la même valeur
 * et l'un des deux gains disparaîtrait. `xpAvant` se déduit du résultat
 * (`xpApres - gain`), ce qui reste juste même en concurrence — c'est
 * l'incrément qui est atomique, pas la lecture.
 *
 * La montée de niveau crédite des jetons Kizuna dans la MÊME transaction, avec
 * sa ligne de journal : une montée qui ne créditerait pas serait invisible, et
 * un crédit sans journal serait indéfendable.
 */
export async function ajouterExperience(
  guildId: string,
  discordId: string,
  gain: number,
  options: { jetonsParNiveau?: number } = {},
): Promise<GainExperience> {
  const montant = Math.max(0, Math.floor(gain));
  return await sql.begin(async tx => {
    const [ligne] = await tx<Array<{ xp: string; niveau: number }>>`
			INSERT INTO bot_profils (guild_id, discord_id, xp, niveau, messages_comptes, dernier_gain_le)
			VALUES (${guildId}, ${discordId}, ${montant}, 1, 1, NOW())
			ON CONFLICT (guild_id, discord_id) DO UPDATE
				SET xp               = bot_profils.xp + ${montant},
				    messages_comptes = bot_profils.messages_comptes + 1,
				    dernier_gain_le  = NOW(),
				    maj_le           = NOW()
			RETURNING xp::text AS xp, niveau
		`;
    const xpApres = nombre(ligne?.xp);
    const xpAvant = Math.max(0, xpApres - montant);
    const niveauAvant = niveauPour(xpAvant);
    const niveauApres = niveauPour(xpApres);
    const franchis = niveauxFranchis(xpAvant, xpApres);

    let jetonsOfferts = 0;
    if (franchis.length > 0) {
      jetonsOfferts = franchis.reduce(
        (total, niveau) => total + jetonsDeMontee(niveau, options.jetonsParNiveau ?? GAIN_DEFAUT.jetonsParNiveau),
        0,
      );
      await tx`
				UPDATE bot_profils
				   SET niveau        = ${niveauApres},
				       jetons        = jetons + ${jetonsOfferts},
				       jetons_gagnes = jetons_gagnes + ${jetonsOfferts},
				       maj_le        = NOW()
				 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
			`;
      if (jetonsOfferts > 0) {
        await tx`
					INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, reference)
					VALUES (${guildId}, ${discordId}, ${jetonsOfferts}, 'montee-niveau', ${String(niveauApres)})
				`;
      }
    } else if (ligne && ligne.niveau !== niveauApres) {
      // Le cache de niveau a divergé (import, correction manuelle) : on le
      // remet d'aplomb sans rien créditer — les jetons d'une montée ne se
      // donnent qu'une fois.
      await tx`
				UPDATE bot_profils SET niveau = ${niveauApres}, maj_le = NOW()
				 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
			`;
    }

    return { franchis, niveauApres, niveauAvant, jetonsOfferts, xpApres, xpAvant };
  });
}

// ─── Délai anti-spam ────────────────────────────────────────────────────────

/**
 * Le message rapporte-t-il ?
 *
 * Le délai est tenu par le CACHE (Redis, avec repli mémoire) et non par une
 * lecture de `dernier_gain_le` : sur un serveur actif, une lecture Postgres par
 * message coûterait plus cher que l'écriture qu'elle évite. Le tour de passe-
 * passe est que `cached` ne rend la valeur calculée QUE lorsqu'elle vient
 * d'être posée — comparer l'horodatage rendu à celui qu'on a proposé dit donc
 * si l'on est le premier de la fenêtre.
 *
 * Si Redis est indisponible, le repli mémoire du module de cache prend le
 * relais : le délai reste tenu à l'échelle du processus, ce qui est exactement
 * la garantie utile ici (un seul processus par bot).
 */
export async function consommerDelai(guildId: string, discordId: string, delaiSecondes: number): Promise<boolean> {
  const delai = Math.max(0, Math.floor(delaiSecondes));
  if (delai === 0) {
    return true;
  }
  const maintenant = Date.now();
  const pose = await cached(`communaute:xp:${guildId}:${discordId}`, delai * 1_000, async () => maintenant);
  return pose === maintenant;
}

// ─── Jetons Kizuna ────────────────────────────────────────────────────────

/**
 * Crédite ou débite, journal compris. Le seul chemin d'écriture des jetons.
 *
 * `delta` signé. Un débit qui passerait sous zéro est refusé par la contrainte
 * `jetons >= 0` de la table : c'est une garde de dernier recours, les appelants
 * vérifient avant (`kizuna.verifierDepense`).
 */
export async function mouvementKizuna(
  guildId: string,
  discordId: string,
  delta: number,
  motif: Motif,
  options: { reference?: string | null; contrepartie?: string | null } = {},
): Promise<number> {
  const montant = Math.trunc(delta);
  if (montant === 0) {
    const profil = await profilDe(guildId, discordId);
    return profil.jetons;
  }
  return await sql.begin(async tx => {
    const [ligne] = await tx<Array<{ jetons: number }>>`
			INSERT INTO bot_profils (guild_id, discord_id, jetons, jetons_gagnes)
			VALUES (${guildId}, ${discordId}, ${Math.max(0, montant)}, ${Math.max(0, montant)})
			ON CONFLICT (guild_id, discord_id) DO UPDATE
				SET jetons        = bot_profils.jetons + ${montant},
				    jetons_gagnes = bot_profils.jetons_gagnes + ${Math.max(0, montant)},
				    maj_le        = NOW()
			RETURNING jetons
		`;
    await tx`
			INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, reference, contrepartie)
			VALUES (${guildId}, ${discordId}, ${montant}, ${motif},
			        ${options.reference ?? null}, ${options.contrepartie ?? null})
		`;
    return ligne?.jetons ?? 0;
  });
}

export interface ResultatQuotidien {
  reclame: boolean;
  gain: number;
  serie: number;
  serieRompue: boolean;
  solde: number;
  prochain: Date;
}

/**
 * Passage quotidien.
 *
 * La décision (réclamable ? quelle série ? quel gain ?) vient du module pur
 * `kizuna.etatQuotidien`. Ici on ne fait qu'appliquer — et on RELIT la ligne
 * dans la transaction, pour que deux clics simultanés ne créditent pas deux
 * fois : le `WHERE dernier_quotidien_le IS DISTINCT FROM <aujourd'hui>` rend
 * l'écriture idempotente sur la journée.
 */
export async function reclamerQuotidien(
  guildId: string,
  discordId: string,
  maintenant: Date = new Date(),
): Promise<ResultatQuotidien> {
  const profil = await profilDe(guildId, discordId);
  const etat = etatQuotidien(profil.dernierQuotidienLe, profil.serieQuotidienne, maintenant);
  if (!etat.reclamable) {
    return {
      gain: 0,
      prochain: etat.prochain,
      reclame: false,
      serie: etat.serie,
      serieRompue: false,
      solde: profil.jetons,
    };
  }

  const aujourdhui = jourCivil(maintenant);
  return await sql.begin(async tx => {
    const [ligne] = await tx<Array<{ jetons: number }>>`
			INSERT INTO bot_profils (guild_id, discord_id, jetons, jetons_gagnes,
			                         dernier_quotidien_le, serie_quotidienne)
			VALUES (${guildId}, ${discordId}, ${etat.gain}, ${etat.gain},
			        ${aujourdhui}::date, ${etat.serie})
			ON CONFLICT (guild_id, discord_id) DO UPDATE
				SET jetons               = bot_profils.jetons + ${etat.gain},
				    jetons_gagnes        = bot_profils.jetons_gagnes + ${etat.gain},
				    dernier_quotidien_le = ${aujourdhui}::date,
				    serie_quotidienne    = ${etat.serie},
				    maj_le               = NOW()
			WHERE bot_profils.dernier_quotidien_le IS DISTINCT FROM ${aujourdhui}::date
			RETURNING jetons
		`;
    if (!ligne) {
      // Quelqu'un a réclamé entre la lecture et l'écriture : ce n'est pas une
      // erreur, c'est le double-clic. On rend l'état, sans créditer.
      const apres = await tx<Array<{ jetons: number }>>`
				SELECT jetons FROM bot_profils
				 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
			`;
      return {
        gain: 0,
        prochain: etat.prochain,
        reclame: false,
        serie: etat.serie,
        serieRompue: false,
        solde: apres[0]?.jetons ?? profil.jetons,
      };
    }
    await tx`
			INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, reference)
			VALUES (${guildId}, ${discordId}, ${etat.gain}, 'quotidien', ${`serie:${etat.serie}`})
		`;
    return {
      gain: etat.gain,
      prochain: etat.prochain,
      reclame: true,
      serie: etat.serie,
      serieRompue: etat.serieRompue,
      solde: ligne.jetons,
    };
  });
}

/** Total déjà donné aujourd'hui — la matière du plafond journalier. */
export async function dejaDonneAujourdhui(
  guildId: string,
  discordId: string,
  maintenant: Date = new Date(),
): Promise<number> {
  const [ligne] = await sql<Array<{ total: string }>>`
		SELECT COALESCE(-SUM(delta), 0)::text AS total
		  FROM bot_journal_kizuna
		 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
		   AND motif = 'don-envoye'
		   AND cree_le >= ${jourCivil(maintenant)}::date
	`;
  return nombre(ligne?.total);
}

/**
 * Transfère des jetons d'un membre à un autre.
 *
 * Les quatre écritures (deux soldes, deux lignes de journal) sont dans UNE
 * transaction : un don à moitié fait créerait des jetons ou en détruirait, et
 * l'invariant « somme du journal = solde » ne tiendrait plus.
 */
export async function transfererKizuna(
  guildId: string,
  expediteurId: string,
  destinataireId: string,
  montant: number,
): Promise<{ soldeExpediteur: number; soldeDestinataire: number }> {
  const valeur = Math.max(DON.minimum, Math.trunc(montant));
  return await sql.begin(async tx => {
    const [depart] = await tx<Array<{ jetons: number }>>`
			UPDATE bot_profils
			   SET jetons = jetons - ${valeur}, maj_le = NOW()
			 WHERE guild_id = ${guildId} AND discord_id = ${expediteurId} AND jetons >= ${valeur}
			RETURNING jetons
		`;
    if (!depart) {
      throw new Error("Solde insuffisant au moment du transfert.");
    }
    const [arrivee] = await tx<Array<{ jetons: number }>>`
			INSERT INTO bot_profils (guild_id, discord_id, jetons, jetons_gagnes)
			VALUES (${guildId}, ${destinataireId}, ${valeur}, ${valeur})
			ON CONFLICT (guild_id, discord_id) DO UPDATE
				SET jetons        = bot_profils.jetons + ${valeur},
				    jetons_gagnes = bot_profils.jetons_gagnes + ${valeur},
				    maj_le        = NOW()
			RETURNING jetons
		`;
    await tx`
			INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, contrepartie)
			VALUES (${guildId}, ${expediteurId}, ${-valeur}, 'don-envoye', ${destinataireId}),
			       (${guildId}, ${destinataireId}, ${valeur}, 'don-recu', ${expediteurId})
		`;
    return { soldeDestinataire: arrivee?.jetons ?? valeur, soldeExpediteur: depart.jetons };
  });
}

export interface LigneJournal {
  delta: number;
  motif: string;
  reference: string | null;
  contrepartie: string | null;
  creeLe: Date;
}

/** Les derniers mouvements d'un membre, du plus récent au plus ancien. */
export async function journalDe(guildId: string, discordId: string, limite = 10): Promise<LigneJournal[]> {
  const lignes = await sql<
    Array<{
      delta: number;
      motif: string;
      reference: string | null;
      contrepartie: string | null;
      cree_le: Date;
    }>
  >`
		SELECT delta, motif, reference, contrepartie, cree_le
		  FROM bot_journal_kizuna
		 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
		 ORDER BY cree_le DESC, id DESC
		 LIMIT ${Math.min(50, Math.max(1, Math.floor(limite)))}
	`;
  return lignes.map(ligne => ({
    contrepartie: ligne.contrepartie,
    creeLe: ligne.cree_le,
    delta: ligne.delta,
    motif: ligne.motif,
    reference: ligne.reference,
  }));
}

// ─── Collection ─────────────────────────────────────────────────────────────

export interface FichePersonnage {
  id: string;
  nom: string;
  code: string | null;
  rarete: string;
  element: string | null;
  position: string | null;
  slug: string | null;
}

const TTL_TOTAL_PERSOS_MS = 6 * 60 * 60_000;

/** Nombre de joueurs recensés — le dénominateur de la complétion. */
export async function totalPersonnages(): Promise<number> {
  return await cached("communaute:persos:total", TTL_TOTAL_PERSOS_MS, async () => {
    const [ligne] = await inagleSql<Array<{ total: string }>>`
			SELECT count(*)::text AS total FROM inagle_characters WHERE name_fr IS NOT NULL AND name_fr <> ''
		`;
    return nombre(ligne?.total);
  });
}

/**
 * Tire un joueur au sort.
 *
 * `ORDER BY random() LIMIT 1` sur 6 148 lignes : Postgres fait un balayage
 * complet, ce qui coûte quelques millisecondes et reste très en dessous du
 * budget d'une interaction. Charger les 6 148 lignes côté bot pour en garder
 * une serait à la fois plus lent et plus fragile.
 *
 * ⚠ `inagle_characters.rarity` est une colonne `text` : comparer à un entier
 * lève `operator does not exist: text = integer`. Les comparaisons ci-dessous
 * passent donc par des chaînes.
 */
export async function tirerPersonnage(options: { garantie?: boolean } = {}): Promise<FichePersonnage | null> {
  const lignes = options.garantie
    ? await inagleSql<Array<Record<string, string | null>>>`
			SELECT id, name_fr, internal_code, rarity, element, position, slug
			  FROM inagle_characters
			 WHERE name_fr IS NOT NULL AND name_fr <> '' AND rarity <> '0'
			 ORDER BY random() LIMIT 1
		`
    : await inagleSql<Array<Record<string, string | null>>>`
			SELECT id, name_fr, internal_code, rarity, element, position, slug
			  FROM inagle_characters
			 WHERE name_fr IS NOT NULL AND name_fr <> ''
			 ORDER BY random() LIMIT 1
		`;
  const ligne = lignes[0];
  if (!ligne) {
    return null;
  }
  return {
    code: ligne.internal_code ?? null,
    element: ligne.element ?? null,
    id: ligne.id ?? "",
    nom: ligne.name_fr ?? "Joueur inconnu",
    position: ligne.position ?? null,
    rarete: ligne.rarity ?? "0",
    slug: ligne.slug ?? null,
  };
}

/** Les fiches de plusieurs joueurs, dans l'ordre demandé. */
export async function fichesPersonnages(ids: readonly string[]): Promise<FichePersonnage[]> {
  if (ids.length === 0) {
    return [];
  }
  const lignes = await inagleSql<Array<Record<string, string | null>>>`
		SELECT id, name_fr, internal_code, rarity, element, position, slug
		  FROM inagle_characters
		 WHERE id = ANY(${[...ids]}::text[])
	`;
  const index = new Map(lignes.map(ligne => [ligne.id ?? "", ligne]));
  return ids
    .map(id => index.get(id))
    .filter((ligne): ligne is Record<string, string | null> => ligne !== undefined)
    .map(ligne => ({
      code: ligne.internal_code ?? null,
      element: ligne.element ?? null,
      id: ligne.id ?? "",
      nom: ligne.name_fr ?? "Joueur inconnu",
      position: ligne.position ?? null,
      rarete: ligne.rarity ?? "0",
      slug: ligne.slug ?? null,
    }));
}

/** Nombre de tirages déjà payés — la mémoire de la garantie. */
export async function nombreTirages(guildId: string, discordId: string): Promise<number> {
  const [ligne] = await sql<Array<{ total: string }>>`
		SELECT count(*)::text AS total
		  FROM bot_journal_kizuna
		 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
		   AND motif = 'achat' AND reference LIKE 'tirage:%'
	`;
  return nombre(ligne?.total);
}

export interface ResultatTirage {
  personnage: FichePersonnage;
  doublon: boolean;
  /** Points rendus par un doublon, `0` sinon. */
  rembourse: number;
  garanti: boolean;
}

/**
 * Un tirage complet : débit, tirage, inscription à l'inventaire, remboursement
 * éventuel — le tout en une transaction.
 *
 * Le débit part d'abord. Tirer puis débiter laisserait, sur une panne entre les
 * deux, un joueur ajouté gratuitement — et l'erreur ne se verrait jamais.
 */
export async function tirage(
  guildId: string,
  discordId: string,
  options: { garantie?: boolean; prix?: number } = {},
): Promise<ResultatTirage | null> {
  const prix = Math.max(0, Math.floor(options.prix ?? TARIFS.tirage));
  const personnage = await tirerPersonnage({ garantie: options.garantie });
  if (!personnage) {
    return null;
  }

  return await sql.begin(async tx => {
    const [debit] = await tx<Array<{ jetons: number }>>`
			UPDATE bot_profils SET jetons = jetons - ${prix}, maj_le = NOW()
			 WHERE guild_id = ${guildId} AND discord_id = ${discordId} AND jetons >= ${prix}
			RETURNING jetons
		`;
    if (!debit) {
      throw new Error("Solde insuffisant au moment du tirage.");
    }
    await tx`
			INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, reference)
			VALUES (${guildId}, ${discordId}, ${-prix}, 'achat', ${`tirage:${personnage.id}`})
		`;

    const [ajout] = await tx<Array<{ objet_id: string }>>`
			INSERT INTO bot_inventaire (guild_id, discord_id, categorie, objet_id, prix_paye)
			VALUES (${guildId}, ${discordId}, 'perso', ${personnage.id}, ${prix})
			ON CONFLICT (guild_id, discord_id, categorie, objet_id) DO NOTHING
			RETURNING objet_id
		`;
    const doublon = ajout === undefined;
    let rembourse = 0;
    if (doublon) {
      rembourse = remboursementDoublon(personnage.rarete);
      await tx`
				UPDATE bot_profils
				   SET jetons = jetons + ${rembourse}, jetons_gagnes = jetons_gagnes + ${rembourse}, maj_le = NOW()
				 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
			`;
      await tx`
				INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, reference)
				VALUES (${guildId}, ${discordId}, ${rembourse}, 'remboursement', ${`doublon:${personnage.id}`})
			`;
    }
    return { doublon, garanti: options.garantie === true, personnage, rembourse: rembourse };
  });
}

/** Le prochain tirage du membre est-il garanti ? */
export async function prochainTirageGaranti(guildId: string, discordId: string): Promise<boolean> {
  return garantieAuTirage(await nombreTirages(guildId, discordId));
}

export interface EntreeInventaire {
  categorie: string;
  objetId: string;
  prixPaye: number;
  obtenuLe: Date;
}

export async function inventaireDe(
  guildId: string,
  discordId: string,
  categorie?: Categorie,
): Promise<EntreeInventaire[]> {
  const lignes = categorie
    ? await sql<Array<{ categorie: string; objet_id: string; prix_paye: number; obtenu_le: Date }>>`
			SELECT categorie, objet_id, prix_paye, obtenu_le FROM bot_inventaire
			 WHERE guild_id = ${guildId} AND discord_id = ${discordId} AND categorie = ${categorie}
			 ORDER BY obtenu_le DESC
		`
    : await sql<Array<{ categorie: string; objet_id: string; prix_paye: number; obtenu_le: Date }>>`
			SELECT categorie, objet_id, prix_paye, obtenu_le FROM bot_inventaire
			 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
			 ORDER BY obtenu_le DESC
		`;
  return lignes.map(ligne => ({
    categorie: ligne.categorie,
    objetId: ligne.objet_id,
    obtenuLe: ligne.obtenu_le,
    prixPaye: ligne.prix_paye,
  }));
}

/** La collection d'un membre, jointe aux fiches de jeu. */
export async function personnagesPossedes(
  guildId: string,
  discordId: string,
): Promise<Array<FichePersonnage & { obtenuLe: Date }>> {
  const inventory = await sql<Array<{ objet_id: string; obtenu_le: Date }>>`
		SELECT objet_id, obtenu_le FROM bot_inventaire
		 WHERE guild_id = ${guildId} AND discord_id = ${discordId} AND categorie = 'perso'
		 ORDER BY obtenu_le DESC
	`;
  const characters = new Map(
    (await fichesPersonnages(inventory.map(row => row.objet_id))).map(character => [character.id, character]),
  );
  return inventory.flatMap(row => {
    const character = characters.get(row.objet_id);
    return character ? [{ ...character, obtenuLe: row.obtenu_le }] : [];
  });
}

export interface FichePlaque {
  id: string;
  rang: number;
  cheminImage: string | null;
  nomTexteId: string | null;
  prix: number;
}

const TTL_PLAQUES_MS = 6 * 60 * 60_000;

/** Le catalogue des plaques, tel qu'il vient des données de jeu. */
export async function plaques(): Promise<FichePlaque[]> {
  return await cached("communaute:plaques", TTL_PLAQUES_MS, async () => {
    const lignes = await inagleSql<
      Array<{
        id: string;
        sort_no: number | null;
        image_path: string | null;
        name_text_id: string | null;
      }>
    >`
			SELECT id, sort_no, image_path, name_text_id FROM inagle_nameplates ORDER BY sort_no ASC
		`;
    return lignes.map(ligne => ({
      cheminImage: ligne.image_path,
      id: ligne.id,
      nomTexteId: ligne.name_text_id,
      prix: prixDePlaque(ligne.sort_no),
      rang: ligne.sort_no ?? 0,
    }));
  });
}

/**
 * Achète un objet du catalogue.
 *
 * Rend `null` quand le membre le possède déjà : ce n'est pas une erreur, c'est
 * un clic sur un bouton qu'il aurait fallu griser. L'appelante le dit sans
 * dramatiser, et rien n'est débité.
 */
export async function acheter(
  guildId: string,
  discordId: string,
  categorie: Categorie,
  objetId: string,
  prix: number,
): Promise<{ solde: number } | null> {
  const cout = Math.max(0, Math.floor(prix));
  return await sql.begin(async tx => {
    const [existe] = await tx<Array<{ objet_id: string }>>`
			SELECT objet_id FROM bot_inventaire
			 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
			   AND categorie = ${categorie} AND objet_id = ${objetId}
		`;
    if (existe) {
      return null;
    }
    const [debit] = await tx<Array<{ jetons: number }>>`
			UPDATE bot_profils SET jetons = jetons - ${cout}, maj_le = NOW()
			 WHERE guild_id = ${guildId} AND discord_id = ${discordId} AND jetons >= ${cout}
			RETURNING jetons
		`;
    if (!debit) {
      throw new Error("Solde insuffisant au moment de l'achat.");
    }
    await tx`
			INSERT INTO bot_inventaire (guild_id, discord_id, categorie, objet_id, prix_paye)
			VALUES (${guildId}, ${discordId}, ${categorie}, ${objetId}, ${cout})
		`;
    await tx`
			INSERT INTO bot_journal_kizuna (guild_id, discord_id, delta, motif, reference)
			VALUES (${guildId}, ${discordId}, ${-cout}, 'achat', ${`${categorie}:${objetId}`})
		`;
    return { solde: debit.jetons };
  });
}

/** Le membre possède-t-il cet objet ? */
export async function possede(
  guildId: string,
  discordId: string,
  categorie: Categorie,
  objetId: string,
): Promise<boolean> {
  const [ligne] = await sql<Array<{ objet_id: string }>>`
		SELECT objet_id FROM bot_inventaire
		 WHERE guild_id = ${guildId} AND discord_id = ${discordId}
		   AND categorie = ${categorie} AND objet_id = ${objetId}
		 LIMIT 1
	`;
  return ligne !== undefined;
}

/**
 * Équipe un cosmétique.
 *
 * La colonne est choisie par un `switch` et jamais interpolée : une colonne
 * venue d'une option de commande serait une injection SQL, quand bien même
 * l'option est aujourd'hui contrainte par un `SlashChoice`.
 */
export async function equiper(
  guildId: string,
  discordId: string,
  champ: "plaque" | "titre" | "perso_favori",
  valeur: string | null,
): Promise<void> {
  switch (champ) {
    case "plaque": {
      await sql`
				INSERT INTO bot_profils (guild_id, discord_id, plaque)
				VALUES (${guildId}, ${discordId}, ${valeur})
				ON CONFLICT (guild_id, discord_id) DO UPDATE SET plaque = ${valeur}, maj_le = NOW()
			`;
      return;
    }
    case "titre": {
      await sql`
				INSERT INTO bot_profils (guild_id, discord_id, titre)
				VALUES (${guildId}, ${discordId}, ${valeur})
				ON CONFLICT (guild_id, discord_id) DO UPDATE SET titre = ${valeur}, maj_le = NOW()
			`;
      return;
    }
    case "perso_favori": {
      await sql`
				INSERT INTO bot_profils (guild_id, discord_id, perso_favori)
				VALUES (${guildId}, ${discordId}, ${valeur})
				ON CONFLICT (guild_id, discord_id) DO UPDATE SET perso_favori = ${valeur}, maj_le = NOW()
			`;
      return;
    }
  }
}

// ─── Récompenses de niveau ──────────────────────────────────────────────────

export interface RecompenseNiveau {
  niveau: number;
  roleId: string;
  cumulable: boolean;
}

const TTL_RECOMPENSES_MS = 5 * 60_000;

export async function recompensesDe(guildId: string): Promise<RecompenseNiveau[]> {
  return await cached(`communaute:recompenses:${guildId}`, TTL_RECOMPENSES_MS, async () => {
    const lignes = await sql<Array<{ niveau: number; role_id: string; cumulable: boolean }>>`
			SELECT niveau, role_id, cumulable FROM bot_recompenses_niveau
			 WHERE guild_id = ${guildId} ORDER BY niveau ASC
		`;
    return lignes.map(ligne => ({
      cumulable: ligne.cumulable,
      niveau: ligne.niveau,
      roleId: ligne.role_id,
    }));
  });
}

/**
 * Rôles à poser et à retirer pour un niveau atteint.
 *
 * ── POURQUOI CETTE FONCTION EST PURE ALORS QU'ELLE VIT ICI ─────────────────
 * Elle ne touche ni la base ni Discord : elle traduit une liste de récompenses
 * en deux listes d'identifiants. Elle reste dans ce fichier parce qu'elle n'a
 * de sens qu'avec les lignes que `recompensesDe` en sort, et elle est testable
 * telle quelle.
 *
 * `cumulable: false` retire les rôles des paliers INFÉRIEURS : c'est le
 * comportement attendu d'une échelle de grades (on est « Vétéran », on n'est
 * plus « Débutant »). `cumulable: true` empile, pour les rôles d'accès.
 */
export function rolesPourNiveau(
  recompenses: readonly RecompenseNiveau[],
  niveau: number,
): { aPoser: string[]; aRetirer: string[] } {
  const acquises = recompenses.filter(recompense => recompense.niveau <= niveau);
  if (acquises.length === 0) {
    return { aPoser: [], aRetirer: [] };
  }
  const derniere = acquises[acquises.length - 1] as RecompenseNiveau;
  if (derniere.cumulable) {
    return { aPoser: acquises.map(recompense => recompense.roleId), aRetirer: [] };
  }
  return {
    aPoser: [derniere.roleId],
    aRetirer: acquises.slice(0, -1).map(recompense => recompense.roleId),
  };
}

/** Vérification de solde, exposée pour que les commandes ne dupliquent pas la règle. */
export async function peutPayer(
  guildId: string,
  discordId: string,
  prix: number,
): Promise<ReturnType<typeof verifierDepense>> {
  const profil = await profilDe(guildId, discordId);
  return verifierDepense(profil.jetons, prix);
}
