#!/usr/bin/env bun
/**
 * Fusion des bases `achillea` et `rg` — une seule base pour tout le réseau.
 *
 * CE QUI CHANGE PAR RAPPORT AU MIROIR FDW
 * `scripts/ops/achillea-fdw.ts` exposait la base `achillea` dans `rg` via
 * `postgres_fdw` : 75 tables ÉTRANGÈRES, lisibles mais jamais écrivables, et
 * une seconde base à sauvegarder, à migrer et à surveiller. Les jointures
 * `public.profiles ⋈ achillea."user"` marchaient, mais chaque lecture traversait
 * une connexion distante, aucune contrainte ne pouvait franchir la frontière, et
 * l'identité restait coupée en deux — deux bases, deux sessions, deux comptes
 * pour la même personne.
 *
 * Après cette fusion, `achillea` est un SCHÉMA de la base `rg`, avec de vraies
 * tables. Le bot Achilléa, son API PostgREST et son stockage écrivent dedans ;
 * le site lit les deux mondes dans la même transaction.
 *
 * CE QUE LE SCRIPT NE FAIT PAS
 * Il ne SUPPRIME PAS la base `achillea`. Elle reste en l'état, intacte, comme
 * repli : tant qu'elle existe, revenir en arrière consiste à remettre l'ancienne
 * `DATABASE_URL` dans `/etc/rose-griffon/achillea.env` et à relancer le service.
 * La retirer est une décision séparée, à prendre une fois la fusion éprouvée.
 *
 * COMMENT LE SCHÉMA EST TRANSPOSÉ
 * `pg_dump -n public` produit un script entièrement qualifié `public.<objet>`.
 * On le réécrit en `achillea.<objet>`, à une exception près : `gin_trgm_ops`
 * appartient à l'extension `pg_trgm`, installée dans `public` des DEUX côtés —
 * le renommer casserait les six index trigram des clans.
 *
 * POURQUOI `search_path` PLUTÔT QUE `schema:` DANS MIKRO-ORM
 * Les 56 migrations d'Achilléa écrivent des noms de table NON qualifiés
 * (`create table "user" …`). Fixer `schema: "achillea"` dans la configuration de
 * l'ORM réécrirait aussi les migrations déjà appliquées et le journal
 * `mikro_orm_migrations`. On pose donc le chemin de recherche sur le RÔLE, côté
 * Postgres : l'application ne change pas d'une ligne, et le même code écrit
 * désormais dans `rg.achillea`.
 *
 *   bun scripts/ops/achillea-merge.ts --verify        # état actuel, aucune écriture
 *   bun scripts/ops/achillea-merge.ts --copy          # copie le schéma et les données
 *   bun scripts/ops/achillea-merge.ts --copy-storage  # rejoue la seule copie du stockage
 *   bun scripts/ops/achillea-merge.ts --cutover       # bascule les services sur `rg`
 */

import { $ } from "bun";

const SOURCE = "achillea";
const CIBLE = "rg";
const SCHEMA = "achillea";

/** Rôles applicatifs d'Achilléa, avec le chemin de recherche à leur poser. */
const ROLES = [
  { nom: "achillea_backend", ecriture: true },
  { nom: "achillea_api", ecriture: true },
  { nom: "achillea_storage", ecriture: true },
  { nom: "achillea_realtime", ecriture: false },
] as const;

/** Fichiers d'environnement à repointer sur la base `rg`.
 * Note: achillea-postgrest, storage et realtime sont retirés depuis le 23/09/2026.
 * Seul achillea.env (achillea-bot.service) reste le runtime actif.
 */
const ENV_A_BASCULER = [
  { chemin: "/etc/rose-griffon/achillea.env", cle: "DATABASE_URL" },
  { chemin: "/etc/rose-griffon/achillea-postgrest.env", cle: "PGRST_DB_URI" },
  { chemin: "/etc/rose-griffon/achillea-storage.env", cle: "DATABASE_URL" },
  { chemin: "/etc/rose-griffon/achillea-realtime.env", cle: "DATABASE_URL" },
] as const;

async function psql(base: string, sql: string): Promise<string> {
  const sortie = await $`sudo -u postgres psql -d ${base} -v ON_ERROR_STOP=1 -Atc ${sql}`.text();
  return sortie.trim();
}

async function nombre(base: string, sql: string): Promise<number> {
  return Number(await psql(base, sql));
}

/** Inventaire comparé des deux côtés — c'est lui qui dit si la copie a réussi. */
async function inventaire(): Promise<void> {
  const nombreTablesSource = await nombre(
    SOURCE,
    "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
  );
  const nombreTablesCible = await nombre(
    CIBLE,
    `select count(*) from information_schema.tables where table_schema='${SCHEMA}' and table_type='BASE TABLE'`,
  );
  const etrangeres = await nombre(
    CIBLE,
    `select count(*) from information_schema.foreign_tables where foreign_table_schema='${SCHEMA}'`,
  );

  console.info(`base ${SOURCE} : ${nombreTablesSource} tables`);
  console.info(`base ${CIBLE}, schéma ${SCHEMA} : ${nombreTablesCible} tables réelles, ${etrangeres} étrangères`);

  if (nombreTablesCible === 0) {
    return;
  }

  // Une comparaison limitée aux tables centrales peut masquer une copie
  // partielle des guildes, du ranked ou des portefeuilles. Cette vérification
  // est exhaustive et en lecture seule : elle est sûre avant chaque bascule.
  const tablesSource = (
    await psql(
      SOURCE,
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
    )
  )
    .split("\n")
    .filter(Boolean);
  const tablesCible = new Set(
    (
      await psql(
        CIBLE,
        `select table_name from information_schema.tables where table_schema='${SCHEMA}' and table_type='BASE TABLE'`,
      )
    )
      .split("\n")
      .filter(Boolean),
  );
  const manquantes: string[] = [];
  const enrichies: string[] = [];
  for (const table of tablesSource) {
    if (!tablesCible.has(table)) {
      manquantes.push(`${table} absente de la cible`);
      continue;
    }
    const [a, b] = await Promise.all([
      nombre(SOURCE, `select count(*) from public."${table}"`),
      nombre(CIBLE, `select count(*) from ${SCHEMA}."${table}"`),
    ]);
    if (a > b) manquantes.push(`${table}: source ${a}, cible ${b}`);
    if (b > a) enrichies.push(`${table}: source ${a}, cible ${b}`);
  }
  for (const table of tablesCible) {
    if (!tablesSource.includes(table)) enrichies.push(`${table} présente seulement dans la cible`);
  }
  if (manquantes.length > 0) {
    throw new Error(`copie Achilléa incomplète :\n${manquantes.map(ecart => `  - ${ecart}`).join("\n")}`);
  }
  console.info(`  ${tablesSource.length} tables comparées : aucune donnée legacy manquante ✓`);
  if (enrichies.length > 0) {
    console.info(`  cible enrichie depuis la copie : ${enrichies.join(" ; ")}`);
  }

  const communs = await nombre(
    CIBLE,
    `select count(*) from public.profiles p join ${SCHEMA}."user" a on a.id = p.discord_id`,
  );
  console.info(`  comptes appariés par identifiant Discord : ${communs}`);
}

/**
 * Copie le schéma `public` de la base source dans le schéma `achillea` de `rg`.
 *
 * Le schéma cible est recréé À CHAQUE FOIS : il ne contenait que des tables
 * étrangères sans données propres, et une copie partielle serait pire qu'une
 * absence de copie.
 */
async function copier(): Promise<void> {
  const dump = `/tmp/achillea-merge-${Date.now()}.sql`;

  console.info("→ extraction du schéma public de la base source");
  // Les ACL SONT reprises (pas de `--no-acl`) : Achilléa suit le modèle
  // Supabase, où `anon` et `authenticated` ont des droits larges sur les tables
  // et où la barrière réelle est la RLS — 67 politiques, copiées avec le
  // schéma. Les retirer donnerait une base fermée à son propre front.
  await $`sudo -u postgres pg_dump -d ${SOURCE} -n public --no-owner -f ${dump}`;

  console.info("→ transposition public → achillea");
  const brut = await Bun.file(dump).text();
  const transpose = brut
    // `CREATE SCHEMA public;` est remplacé par notre propre création.
    .replace(/^CREATE SCHEMA public;$/m, "")
    .replaceAll("public.", `${SCHEMA}.`)
    // `gin_trgm_ops` vient de l'extension pg_trgm, installée dans `public`
    // des deux côtés : la transposer casserait les index trigram.
    .replaceAll(`${SCHEMA}.gin_trgm_ops`, "public.gin_trgm_ops")
    .replaceAll("SET search_path TO 'public'", `SET search_path TO '${SCHEMA}'`);

  const transposeChemin = `${dump}.achillea`;
  await Bun.write(transposeChemin, transpose);
  await $`sudo chmod 644 ${transposeChemin}`;

  console.info("→ remplacement du schéma achillea dans la base rg");
  await psql(CIBLE, `drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA};`);
  await $`sudo -u postgres psql -d ${CIBLE} -v ON_ERROR_STOP=1 -q -f ${transposeChemin}`;

  await copierStockage();

  console.info("→ droits et chemin de recherche des rôles");
  const grants = [
    `grant usage on schema ${SCHEMA} to ${ROLES.map(r => r.nom).join(", ")}, rg, service_role, anon, authenticated;`,
    ...ROLES.map(r =>
      r.ecriture
        ? `grant all privileges on all tables in schema ${SCHEMA} to ${r.nom};
				   grant all privileges on all sequences in schema ${SCHEMA} to ${r.nom};
				   grant execute on all functions in schema ${SCHEMA} to ${r.nom};`
        : `grant select on all tables in schema ${SCHEMA} to ${r.nom};`,
    ),
    `grant select on all tables in schema ${SCHEMA} to rg, service_role;`,
    // `anon` et `authenticated` reçoivent l'USAGE du schéma parce que le front
    // Angular d'Achilléa lit ses six vues publiques par PostgREST. Les droits
    // de TABLE, eux, viennent du dump : ce sont exactement ceux d'avant la
    // fusion, et la RLS reste la barrière — jamais le GRANT.
    // Le stockage d'Achilléa écrit dans le schéma `storage` COMMUN de `rg` :
    // ses buckets y ont été copiés, mais son rôle n'y avait aucun droit —
    // il ne connaissait que la base `achillea`, où il était propriétaire.
    `grant usage on schema storage to achillea_storage;`,
    `grant select, insert, update, delete on all tables in schema storage to achillea_storage;`,
    `grant usage, select on all sequences in schema storage to achillea_storage;`,
    `grant execute on all functions in schema storage to achillea_storage;`,
    `grant usage on schema storage to achillea_realtime;`,
    `grant select on all tables in schema storage to achillea_realtime;`,
    ...ROLES.map(r => `alter role ${r.nom} in database ${CIBLE} set search_path = ${SCHEMA}, public;`),
  ].join("\n");
  await psql(CIBLE, grants);

  await $`sudo rm -f ${dump} ${transposeChemin}`.nothrow();
  console.info("✓ copie terminée");
}

/**
 * Copie les buckets et les objets d'Achilléa dans le schéma `storage` commun.
 *
 * Colonne par colonne, et non par `pg_dump --data-only` : les deux piles
 * Supabase n'ont pas la même version du schéma de stockage (`versioning_status`,
 * `is_delete_marker`, `is_versioned` n'existent que côté Achilléa). Un dump
 * brut échoue sur la première colonne absente.
 *
 * Les buckets `images` et `ranked-proofs` ne collisionnent avec aucun bucket de
 * `rg`. Les FICHIERS ne bougent pas : ils restent sous
 * `/var/www/achillea-storage`, servis par `achillea-storage.service`.
 */
async function copierStockage(): Promise<void> {
  console.info("→ copie du stockage (buckets et objets)");

  // Colonnes présentes DES DEUX CÔTÉS et insérables côté cible. Les deux piles
  // Supabase n'ont pas la même version du schéma de stockage
  // (`versioning_status`, `is_delete_marker`, `is_versioned` n'existent que côté
  // Achilléa), et `path_tokens` est une colonne GÉNÉRÉE côté `rg` : l'écrire est
  // refusé par Postgres, même avec la bonne valeur.
  const colonnes = async (table: string): Promise<string[]> => {
    const lire = (base: string, filtre: string) =>
      psql(
        base,
        `select coalesce(string_agg(column_name, ',' order by ordinal_position), '')
				 from information_schema.columns
				 where table_schema='storage' and table_name='${table}' ${filtre}`,
      );
    const [source, cible] = await Promise.all([
      lire(SOURCE, ""),
      lire(CIBLE, "and is_generated <> 'ALWAYS' and is_identity <> 'YES'"),
    ]);
    const insérables = new Set(cible.split(","));
    return source.split(",").filter(colonne => insérables.has(colonne));
  };

  for (const table of ["buckets", "objects"]) {
    const communes = (await colonnes(table)).map(colonne => `"${colonne}"`).join(", ");
    const csv = `/tmp/achillea-storage-${table}.csv`;
    const script = `/tmp/achillea-storage-${table}.psql`;

    // `\copy` est une méta-commande de psql : elle doit occuper sa propre
    // ligne d'un fichier de script, et ne peut pas cohabiter avec du SQL dans
    // un `-c`. D'où le passage par un CSV intermédiaire.
    await Bun.write(
      script,
      [
        `create temporary table entrant (like storage.${table} including defaults) on commit drop;`,
        `\\copy entrant (${communes}) from '${csv}' csv`,
        // Rejouable : une seconde exécution ne doit pas écraser un objet
        // déjà servi en production.
        `insert into storage.${table} (${communes}) select ${communes} from entrant on conflict do nothing;`,
      ].join("\n"),
    );
    await $`sudo chmod 644 ${script}`;

    await $`sudo -u postgres psql -d ${SOURCE} -v ON_ERROR_STOP=1 -q -c ${`\\copy (select ${communes} from storage.${table}) to '${csv}' csv`}`;
    const resultat =
      await $`sudo -u postgres psql -d ${CIBLE} -v ON_ERROR_STOP=1 -q --single-transaction -f ${script}`.nothrow();
    if (resultat.exitCode !== 0) {
      console.warn(`… storage.${table} : copie incomplète (${resultat.stderr.toString().trim()})`);
    }
    await $`sudo rm -f ${csv} ${script}`.nothrow();
  }
}

/**
 * Réconcilie les deux divergences qui peuvent évoluer entre une copie et une
 * bascule, sans jamais recréer le schéma cible ni écraser un relevé plus récent.
 *
 * `guild_member_meta` reçoit les membres absents et n'écrase une ligne que si
 * son `scanned_at` est plus récent. `stat` est un journal append-only : les ids
 * déjà présents sont conservés, les lignes absentes sont importées.
 */
async function reconcilierDonneesVivantes(): Promise<void> {
  const stamp = Date.now();
  const copierCsv = async (table: string, colonnes: string[], requete: string) => {
    const csv = `/tmp/achillea-reconcile-${table}-${stamp}.csv`;
    const script = `/tmp/achillea-reconcile-${table}-${stamp}.sql`;
    const liste = colonnes.map(colonne => `"${colonne}"`).join(", ");
    await $`sudo -u postgres psql -d ${SOURCE} -v ON_ERROR_STOP=1 -q -c ${`\\copy (${requete}) to '${csv}' csv`}`;
    await Bun.write(
      script,
      [
        "begin;",
        `create temporary table entrant (like ${SCHEMA}."${table}" including defaults) on commit drop;`,
        `\\copy entrant (${liste}) from '${csv}' csv`,
        `insert into ${SCHEMA}."${table}" (${liste}) select ${liste} from entrant ${
          table === "guild_member_meta"
            ? `on conflict (guild_id, user_id) do update set
							nick = excluded.nick,
							joined_at = excluded.joined_at,
							premium_since = excluded.premium_since,
							roles = excluded.roles,
							pending = excluded.pending,
							scanned_at = excluded.scanned_at
						  where excluded.scanned_at > ${SCHEMA}."${table}".scanned_at`
            : "on conflict (id) do nothing"
        };`,
        "commit;",
      ].join("\n"),
    );
    await $`sudo chmod 644 ${csv} ${script}`;
    const resultat = await $`sudo -u postgres psql -d ${CIBLE} -v ON_ERROR_STOP=1 -q -f ${script}`.nothrow();
    await $`sudo rm -f ${csv} ${script}`.nothrow();
    if (resultat.exitCode !== 0) {
      throw new Error(`réconciliation ${table} échouée : ${resultat.stderr.toString().trim()}`);
    }
  };

  await copierCsv(
    "guild_member_meta",
    ["guild_id", "user_id", "nick", "joined_at", "premium_since", "roles", "pending", "scanned_at"],
    "select guild_id, user_id, nick, joined_at, premium_since, roles, pending, scanned_at from public.guild_member_meta",
  );
  await copierCsv(
    "stat",
    ["id", "type", "value", "additional_data", "created_at"],
    "select id, type, value, additional_data, created_at from public.stat",
  );
  console.info("✓ métadonnées de guildes et statistiques legacy réconciliées sans écrasement");
}

/** Repointe les fichiers d'environnement et redémarre les services. */
async function basculer(): Promise<void> {
  for (const { chemin, cle } of ENV_A_BASCULER) {
    const existe = await $`sudo test -f ${chemin}`.nothrow().quiet();
    if (existe.exitCode !== 0) {
      console.warn(`… ${chemin} absent, ignoré`);
      continue;
    }
    // Seul le nom de la base change : l'utilisateur, le mot de passe et
    // l'hôte restent ceux d'Achilléa. On ne lit ni n'affiche jamais la valeur.
    await $`sudo sed -i ${`s#\\(^${cle}=postgresql://[^/]*\\)/${SOURCE}\\b#\\1/${CIBLE}#`} ${chemin}`;
    console.info(`✓ ${chemin} : ${cle} pointe sur ${CIBLE}`);
  }

  // PostgREST expose désormais le schéma `achillea` de la base `rg`, et non
  // plus le `public` de la base `achillea`. La valeur est déclarée DEUX FOIS —
  // dans l'unité systemd et dans son fichier d'environnement, lequel l'emporte
  // — donc les deux doivent être corrigées : n'en changer qu'une laisse
  // PostgREST servir le `public` de `rg`, c'est-à-dire les 307 tables du site.
  await $`sudo sed -i ${`s/^Environment=PGRST_DB_SCHEMAS=.*/Environment=PGRST_DB_SCHEMAS=${SCHEMA}/`} /etc/systemd/system/achillea-postgrest.service`.nothrow();
  await $`sudo sed -i ${`s/^PGRST_DB_SCHEMAS=.*/PGRST_DB_SCHEMAS=${SCHEMA}/`} /etc/rose-griffon/achillea-postgrest.env`.nothrow();
  await $`sudo systemctl daemon-reload`;

  console.info("→ redémarrage du service Achilléa actif (achillea-bot)");
  await $`sudo systemctl restart achillea-bot.service`;
  console.info("✓ bascule terminée — vérifier `journalctl -u achillea-bot.service -n 50`");
}

const arguments_ = Bun.argv.slice(2);

if (arguments_.includes("--copy")) {
  await copier();
}
if (arguments_.includes("--copy-storage")) {
  await copierStockage();
}
if (arguments_.includes("--reconcile")) {
  await reconcilierDonneesVivantes();
}
if (arguments_.includes("--cutover")) {
  await basculer();
}
await inventaire();
