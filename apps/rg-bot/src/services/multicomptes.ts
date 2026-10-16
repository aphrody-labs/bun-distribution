/**
 * Ce que la base sait des comptes, monté en empreintes pour `lib/multicomptes.ts`.
 *
 * ── LA FRONTIÈRE ───────────────────────────────────────────────────────────
 * Ici : le SQL, le cache, la mise en forme. Là-bas : le calibrage, les poids,
 * les seuils — sans base, sans passerelle, donc testable. Aucune décision de
 * rapprochement n'est prise dans ce fichier.
 *
 * ── QUATRE SOURCES, ET AUCUNE N'EST COMPLÈTE ───────────────────────────────
 *  1. `discord_members` (2 098 lignes) — le socle. Elle ne décrit QUE la guilde
 *     Rose Griffon : la table n'a même pas de colonne `guild_id`, c'est la
 *     synchronisation de `rg-cron` qui la remplit pour ce serveur-là. Un
 *     balayage lancé depuis un autre serveur n'aurait donc rien à examiner, et
 *     la commande le dit plutôt que de rendre une liste vide.
 *  2. `discord_messages` (16 960 lignes, 254 auteurs) — l'activité. Elle ne
 *     couvre que les salons SUIVIS et un membre sur huit ; c'est pourquoi
 *     l'analyse temporelle exige un minimum d'activité des deux côtés avant de
 *     conclure quoi que ce soit (cf. `ActiviteCroisee` et son garde-fou).
 *  3. `account` (Better Auth) — les rattachements DÉCLARÉS. Sept liaisons
 *     Discord seulement, mais ce sont les seules certitudes du module.
 *  4. `profiles` — les mêmes rattachements pour les profils du site qui n'ont
 *     pas d'entrée Better Auth. 1 816 portent un `discord_id`, mais la
 *     jointure exige AUSSI un courriel ou un `patreon_id`, et `email` y est
 *     presque toujours NULL : la branche rattache 14 membres, pas 1 816.
 *     Toutes sources confondues, 16 membres sur 2 079 portent une liaison,
 *     et un balayage complet n'en fait aujourd'hui ressortir aucune paire.
 *     C'est l'indice le plus lourd du module (70 points, sans plafond) et
 *     de loin le plus rare — ne pas le lire comme une couverture large.
 *
 * ── AUCUNE DONNÉE PERSONNELLE NE SORT D'ICI ────────────────────────────────
 * Les liaisons sont des empreintes opaques : `courriel:<md5>`, jamais l'adresse.
 * Le condensat est calculé PAR POSTGRES, donc l'adresse ne transite même pas
 * par le processus du bot. C'est la même règle que
 * `commands/administration/utilisateur.ts` — un salon Discord n'est pas un
 * espace privé, et `profiles` porte aussi les adresses postales des acheteurs
 * de la boutique (jamais lues ici : voir l'en-tête de `lib/multicomptes.ts`).
 */
import { sql } from "../lib/db";
import {
  balayer,
  clePaire,
  type ActiviteCroisee,
  type Balayage,
  type EmpreinteCompte,
  type Niveau,
  type Rapprochement,
} from "../lib/multicomptes";

// ─── Population ─────────────────────────────────────────────────────────────

interface LigneMembre {
  discord_id: string;
  username: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: Date | null;
  left_at: Date | null;
  roles: string[] | null;
  messages: number | string;
  liaisons: string[] | null;
}

/**
 * Un membre = une ligne, liaisons comprises.
 *
 * Les rattachements sont agrégés dans la requête plutôt que ramenés à part :
 * cinq allers-retours vers Postgres pour reconstituer un objet en mémoire, sur
 * une commande que le staff lance à la chaîne, c'est cinq fois la latence pour
 * rien. Le `union all` de la sous-requête est le prix d'un seul parcours.
 */
const REQUETE_MEMBRES = `
	with liaisons as (
		-- Rattachements déclarés par Better Auth : deux comptes Discord sur le
		-- même utilisateur du site, c'est la personne elle-même qui l'a établi.
		select a.account_id as discord_id, 'profil:' || a.user_id as liaison
		  from account a
		 where a.provider_id = 'discord'
		union all
		select a.account_id, 'courriel:' || md5(lower(u.email))
		  from account a
		  join "user" u on u.id = a.user_id
		 where a.provider_id = 'discord' and coalesce(u.email, '') <> ''
		union all
		select a.account_id, 'steam:' || u.steam_id
		  from account a
		  join "user" u on u.id = a.user_id
		 where a.provider_id = 'discord' and u.steam_id is not null
		union all
		-- Les profils du site qui portent un discord_id sans passer par Better
		-- Auth. 1 816 en portent un, mais seuls 16 ont aussi un courriel : la
		-- branche fait passer le rattachement de 5 à 16 membres liés, pas à 1 816.
		select p.discord_id, 'courriel:' || md5(lower(p.email))
		  from profiles p
		 where p.discord_id is not null and coalesce(p.email, '') <> ''
		union all
		select p.discord_id, 'patreon:' || p.patreon_id
		  from profiles p
		 where p.discord_id is not null and p.patreon_id is not null
	),
	activite as (
		select author_id, count(*)::int as messages
		  from discord_messages
		 where author_is_bot = false and deleted_at is null
		 group by author_id
	)
	select m.discord_id,
	       m.username,
	       m.display_name,
	       m.nickname,
	       m.avatar_url,
	       m.joined_at,
	       m.left_at,
	       m.roles,
	       coalesce(a.messages, 0) as messages,
	       coalesce(array_agg(distinct l.liaison) filter (where l.liaison is not null), '{}') as liaisons
	  from discord_members m
	  left join liaisons l on l.discord_id = m.discord_id
	  left join activite a on a.author_id = m.discord_id
	 where m.is_bot = false
	 group by m.discord_id, m.username, m.display_name, m.nickname, m.avatar_url,
	          m.joined_at, m.left_at, m.roles, a.messages
`;

function enEmpreinte(ligne: LigneMembre): EmpreinteCompte {
  return {
    arriveeLe: ligne.joined_at ? new Date(ligne.joined_at) : null,
    avatar: ligne.avatar_url,
    discordId: ligne.discord_id,
    liaisons: ligne.liaisons ?? [],
    messages: Number(ligne.messages) || 0,
    nomAffiche: ligne.display_name,
    partiLe: ligne.left_at ? new Date(ligne.left_at) : null,
    pseudo: ligne.username,
    roles: ligne.roles ?? [],
    surnom: ligne.nickname,
  };
}

// ─── Activité croisée ───────────────────────────────────────────────────────

interface LigneActivite {
  author_id: string;
  salons: string[];
  creneaux: Array<number | string>;
}

/**
 * Créneaux de dix minutes.
 *
 * Le quart d'heure serait trop grossier (deux personnes du même fuseau écrivent
 * dans le même quart d'heure sans se connaître), la minute trop fine (elle
 * ferait passer pour alternée l'activité de deux amis qui discutent). Dix
 * minutes est la granularité où « jamais dans le même créneau » commence à
 * vouloir dire quelque chose sur plusieurs centaines de créneaux.
 */
const CRENEAU_SECONDES = 600;

/**
 * Seuil d'activité en dessous duquel un compte n'entre pas dans l'analyse
 * temporelle. Il vaut celui de `lib/multicomptes.ts`, et pour la même raison :
 * sous ce volume, « aucun créneau commun » ne dit rien d'autre que « pas de
 * données ».
 */
const CRENEAUX_MINIMUM = 25;

export interface Activites {
  readonly salons: ReadonlyMap<string, ReadonlySet<string>>;
  readonly creneaux: ReadonlyMap<string, ReadonlySet<number>>;
}

/**
 * Charge l'activité de tous les auteurs suffisamment actifs.
 *
 * Tout est chargé d'un coup plutôt qu'à la demande par paire : l'archive tient
 * en 17 000 lignes, et une requête par couple candidat en ferait des centaines.
 * Le `having` écarte d'emblée les auteurs qui ne franchiront de toute façon pas
 * le seuil de l'analyse.
 */
export async function chargerActivites(): Promise<Activites> {
  const lignes = await sql<LigneActivite[]>`
		select author_id,
		       array_agg(distinct channel_id) as salons,
		       array_agg(distinct floor(extract(epoch from created_at) / ${CRENEAU_SECONDES})::bigint) as creneaux
		  from discord_messages
		 where author_is_bot = false and deleted_at is null
		 group by author_id
		having count(distinct floor(extract(epoch from created_at) / ${CRENEAU_SECONDES})) >= ${CRENEAUX_MINIMUM}
	`;
  const salons = new Map<string, ReadonlySet<string>>();
  const creneaux = new Map<string, ReadonlySet<number>>();
  for (const ligne of lignes) {
    salons.set(ligne.author_id, new Set(ligne.salons ?? []));
    creneaux.set(ligne.author_id, new Set((ligne.creneaux ?? []).map(Number)));
  }
  return { creneaux, salons };
}

/** Croise l'activité de deux comptes. `null` si l'un des deux n'en a pas assez. */
export function croiserActivite(activites: Activites, a: string, b: string): ActiviteCroisee | null {
  const creneauxA = activites.creneaux.get(a);
  const creneauxB = activites.creneaux.get(b);
  if (!creneauxA || !creneauxB) {
    return null;
  }
  // On parcourt le plus PETIT ensemble : c'est la seule chose qui compte quand
  // un membre très actif porte plusieurs milliers de créneaux.
  const [petit, grand] = creneauxA.size <= creneauxB.size ? [creneauxA, creneauxB] : [creneauxB, creneauxA];
  let communs = 0;
  for (const creneau of petit) {
    if (grand.has(creneau)) {
      communs++;
    }
  }
  const salonsA = activites.salons.get(a) ?? new Set<string>();
  const salonsB = activites.salons.get(b) ?? new Set<string>();
  let salonsCommuns = 0;
  for (const salon of salonsA) {
    if (salonsB.has(salon)) {
      salonsCommuns++;
    }
  }
  return { creneauxA: creneauxA.size, creneauxB: creneauxB.size, creneauxCommuns: communs, salonsCommuns };
}

// ─── Verdicts du staff ──────────────────────────────────────────────────────

export const VERDICTS = ["confirme", "ecarte"] as const;

export type Verdict = (typeof VERDICTS)[number];

export const LIBELLES_VERDICT: Readonly<Record<Verdict, string>> = Object.freeze({
  confirme: "Double compte confirmé",
  ecarte: "Écarté — ce ne sont pas les mêmes",
});

export interface LigneVerdict {
  readonly compteA: string;
  readonly compteB: string;
  readonly verdict: Verdict;
  readonly motif: string | null;
  readonly parQui: string | null;
  readonly le: Date;
}

/** Les verdicts déjà posés, indexés par paire (`clePaire`). */
export async function verdictsDe(guildId: string): Promise<Map<string, LigneVerdict>> {
  const lignes = await sql<
    Array<{
      compte_a: string;
      compte_b: string;
      verdict: Verdict;
      motif: string | null;
      par_qui: string | null;
      maj_le: Date;
    }>
  >`
		select compte_a, compte_b, verdict, motif, par_qui, maj_le
		  from bot_multicomptes_verdicts
		 where guild_id = ${guildId}
	`;
  return new Map(
    lignes.map(ligne => [
      clePaire(ligne.compte_a, ligne.compte_b),
      {
        compteA: ligne.compte_a,
        compteB: ligne.compte_b,
        le: new Date(ligne.maj_le),
        motif: ligne.motif,
        parQui: ligne.par_qui,
        verdict: ligne.verdict,
      },
    ]),
  );
}

/**
 * Tranche une paire.
 *
 * L'ordre du couple est normalisé AVANT l'écriture (contrainte `compte_a <
 * compte_b` en base) : sans ça, la même paire s'enregistrerait deux fois selon
 * qui a été mentionné en premier, et le balayage continuerait de remonter une
 * paire déjà écartée.
 */
export async function poserVerdict(entree: {
  guildId: string;
  a: string;
  b: string;
  verdict: Verdict;
  motif?: string | null;
  parQui: string;
}): Promise<void> {
  const [compteA, compteB] = entree.a < entree.b ? [entree.a, entree.b] : [entree.b, entree.a];
  await sql`
		insert into bot_multicomptes_verdicts (guild_id, compte_a, compte_b, verdict, motif, par_qui)
		values (${entree.guildId}, ${compteA}, ${compteB}, ${entree.verdict}, ${entree.motif ?? null}, ${entree.parQui})
		on conflict (guild_id, compte_a, compte_b) do update
		   set verdict = excluded.verdict,
		       motif   = excluded.motif,
		       par_qui = excluded.par_qui,
		       maj_le  = now()
	`;
}

/**
 * Retire un verdict — la paire redevient examinable.
 *
 * Rend la ligne SUPPRIMÉE, et pas un simple booléen : c'est la seule occasion
 * de la journaliser. Une fois le `delete` passé, plus personne ne peut dire ce
 * que le staff avait décidé ni pourquoi — or annuler la décision d'un collègue
 * est exactement ce qui doit laisser une trace.
 */
export async function retirerVerdict(guildId: string, a: string, b: string): Promise<LigneVerdict | null> {
  const [compteA, compteB] = a < b ? [a, b] : [b, a];
  const lignes = await sql<
    Array<{
      compte_a: string;
      compte_b: string;
      verdict: Verdict;
      motif: string | null;
      par_qui: string | null;
      maj_le: Date;
    }>
  >`
		delete from bot_multicomptes_verdicts
		 where guild_id = ${guildId} and compte_a = ${compteA} and compte_b = ${compteB}
		returning compte_a, compte_b, verdict, motif, par_qui, maj_le
	`;
  const ligne = lignes[0];
  if (!ligne) {
    return null;
  }
  return {
    compteA: ligne.compte_a,
    compteB: ligne.compte_b,
    le: new Date(ligne.maj_le),
    motif: ligne.motif,
    parQui: ligne.par_qui,
    verdict: ligne.verdict,
  };
}

// ─── Le balayage, avec son cache ────────────────────────────────────────────

export interface Population {
  readonly empreintes: readonly EmpreinteCompte[];
  readonly activites: Activites;
  readonly verdicts: ReadonlyMap<string, LigneVerdict>;
  readonly chargeeLe: Date;
}

/**
 * Durée de validité du cliché.
 *
 * Le cliché coûte trois requêtes et une poignée de mégaoctets ; le staff
 * enchaîne `membre`, `balayage`, `verdict` dans la même minute. Cinq minutes,
 * c'est assez pour que la deuxième commande soit immédiate, et assez court pour
 * qu'une arrivée récente apparaisse sans qu'on ait à redémarrer quoi que ce soit.
 */
const VALIDITE_MS = 5 * 60_000;

/**
 * Cache LOCAL au processus, et non le cache Redis partagé de `lib/cache.ts`.
 *
 * Deux raisons, toutes deux vérifiées avant d'écrire cette ligne : le cliché
 * pèse quelques mégaoctets une fois sérialisé (2 098 membres, leurs rôles, leurs
 * créneaux d'activité) — ce n'est pas ce qu'on met dans un Redis partagé avec
 * les compteurs d'XP ; et il porte des `Date` et des `Set`, que `JSON.parse`
 * rendrait en chaînes et en objets vides, silencieusement. Un cache qui rend un
 * `Set` vide ferait dire au module « aucune activité commune » sur toutes les
 * paires, c'est-à-dire un faux indice à chaque redémarrage.
 */
let cliche: { valeur: Population; expire: number } | null = null;

export function oublierPopulation(): void {
  cliche = null;
}

export async function chargerPopulation(guildId: string, options: { fraiche?: boolean } = {}): Promise<Population> {
  if (!options.fraiche && cliche && cliche.expire > Date.now()) {
    return cliche.valeur;
  }
  const [lignes, activites, verdicts] = await Promise.all([
    sql.unsafe(REQUETE_MEMBRES) as unknown as Promise<LigneMembre[]>,
    chargerActivites(),
    verdictsDe(guildId),
  ]);
  const valeur: Population = {
    activites,
    chargeeLe: new Date(),
    empreintes: lignes.map(enEmpreinte),
    verdicts,
  };
  cliche = { expire: Date.now() + VALIDITE_MS, valeur };
  return valeur;
}

export interface OptionsRapprochement {
  readonly niveauMinimum?: Niveau;
  /** Ne garder que les comptes arrivés depuis moins de N jours. */
  readonly depuisJours?: number | null;
  /** Recharger la population au lieu de servir le cliché. */
  readonly fraiche?: boolean;
  /** Inclure les paires déjà tranchées par le staff. */
  readonly avecTranchees?: boolean;
}

export interface ResultatBalayage extends Balayage {
  readonly empreintes: ReadonlyMap<string, EmpreinteCompte>;
  readonly verdicts: ReadonlyMap<string, LigneVerdict>;
  readonly chargeeLe: Date;
}

/**
 * Balaye le serveur.
 *
 * Les paires DÉJÀ TRANCHÉES sont écartées d'entrée, sauf demande contraire :
 * sans ça, le staff reverrait à chaque balayage les mêmes faux positifs
 * qu'il a examinés la semaine précédente — et un outil qui redemande sans cesse
 * la même chose finit par n'être plus lu.
 */
export async function balayerServeur(guildId: string, options: OptionsRapprochement = {}): Promise<ResultatBalayage> {
  const population = await chargerPopulation(guildId, { fraiche: options.fraiche });

  const limite =
    typeof options.depuisJours === "number" && options.depuisJours > 0
      ? Date.now() - options.depuisJours * 86_400_000
      : null;
  // Le filtre garde une paire dès qu'UN des deux comptes est récent : un double
  // compte se rapproche par définition d'un compte ancien, et ne garder que les
  // arrivées récentes des deux côtés ne trouverait jamais rien.
  const recents =
    limite === null
      ? null
      : new Set(
          population.empreintes
            .filter(compte => (compte.arriveeLe?.getTime() ?? 0) >= limite)
            .map(compte => compte.discordId),
        );

  const ecartees = new Set<string>();
  if (!options.avecTranchees) {
    for (const [paire, verdict] of population.verdicts) {
      if (verdict.verdict === "ecarte") {
        ecartees.add(paire);
      }
    }
  }

  const balayage = balayer(population.empreintes, {
    activite: (a, b) => croiserActivite(population.activites, a, b),
    ecartees,
    niveauMinimum: options.niveauMinimum,
  });

  const rapprochements =
    recents === null
      ? balayage.rapprochements
      : balayage.rapprochements.filter(paire => recents.has(paire.compteA) || recents.has(paire.compteB));

  return {
    ...balayage,
    chargeeLe: population.chargeeLe,
    empreintes: new Map(population.empreintes.map(compte => [compte.discordId, compte])),
    rapprochements,
    verdicts: population.verdicts,
  };
}

/** Les rapprochements qui concernent UN compte, du plus fort au plus faible. */
export async function rapprochementsDe(
  guildId: string,
  discordId: string,
  options: OptionsRapprochement = {},
): Promise<{
  readonly compte: EmpreinteCompte | null;
  readonly rapprochements: readonly Rapprochement[];
  readonly empreintes: ReadonlyMap<string, EmpreinteCompte>;
  readonly verdicts: ReadonlyMap<string, LigneVerdict>;
  readonly chargeeLe: Date;
}> {
  // Le compte visé peut avoir été tranché : on demande TOUT, et on marque
  // ensuite. Masquer un verdict sur une fiche individuelle reviendrait à cacher
  // au staff la décision qu'il a lui-même prise.
  const resultat = await balayerServeur(guildId, { ...options, avecTranchees: true });
  return {
    chargeeLe: resultat.chargeeLe,
    compte: resultat.empreintes.get(discordId) ?? null,
    empreintes: resultat.empreintes,
    rapprochements: resultat.rapprochements.filter(paire => paire.compteA === discordId || paire.compteB === discordId),
    verdicts: resultat.verdicts,
  };
}
