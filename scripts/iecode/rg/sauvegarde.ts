#!/usr/bin/env bun
/**
 * sauvegarde.ts — sauvegarde vérifiée de l'état de la production : bases Postgres ET
 * fichiers déposés par les utilisateurs, sur place puis hors machine.
 *
 * Le fichier s'appelait `sauvegarde-postgres.ts` tant qu'il ne couvrait que les bases.
 * Il a été renommé le 14/8/2026 en même temps qu'on lui a ajouté /var/www/rg-storage :
 * un nom qui promet moins que ce qu'il fait laisse croire à un trou qui n'existe plus,
 * et un nom qui promet plus est bien pire.
 *
 * Pourquoi ce script existe
 * -------------------------
 * `backup-postgres.sh` existait, mais aucun timer ne l'appelait : il fallait s'en souvenir.
 * Résultat mesuré le 14 août 2026 — la base `rg` (174 Mio : comptes, commandes, adhésions,
 * articles du wiki) n'avait **aucune sauvegarde**, les derniers dumps du disque dataient du
 * 14 mai et ne concernaient que d'autres bases. Trois mois sans filet.
 *
 * Ce que celui-ci fait de plus
 * ----------------------------
 * 1. **Format custom** (`-Fc`) au lieu du SQL à plat : compressé, et `pg_restore` peut en
 *    extraire une seule table au lieu de tout rejouer.
 * 2. **Il vérifie**. Un dump jamais relu n'est pas une sauvegarde, c'est un fichier. Chaque
 *    archive est relue par `pg_restore --list`, et la plus récente est **réellement
 *    restaurée** dans une base jetable, dont on compte les tables et les lignes avant de
 *    la supprimer. Une sauvegarde qui échoue à la restauration est signalée comme un échec.
 * 3. **Elle sort de la machine.** Un dump posé à côté de la base ne protège que de l'erreur
 *    humaine, pas de la perte du disque. Les archives partent vers l'archive froide
 *    déclarée par `RG_ARCHIVE_HOTE` ; si l'hôte est injoignable, c'est un échec — une
 *    copie locale vaut mieux que rien, mais elle ne doit pas passer pour suffisante.
 *    Sans variable, l'envoi est simplement annoncé comme absent : depuis le 21/8/2026
 *    aucune machine tierce ne porte de données rg, et le second VPS n'en porte plus.
 * 4. **Rotation** locale et distante, pour ne pas remplir un disque déjà à 94 %.
 *
 * Usage
 * -----
 *   bun scripts/iecode/rg/sauvegarde.ts            # sauvegarde + vérification + envoi
 *   bun scripts/iecode/rg/sauvegarde.ts --local    # sans envoi distant
 *   bun scripts/iecode/rg/sauvegarde.ts --verifier # revérifie les archives existantes
 */

import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { $ } from "bun";

const DESTINATION = "/var/backups/postgres";
/**
 * Hôte de l'archive froide, **vide par défaut**.
 *
 * L'adresse était codée en dur sur le second VPS. Deux choses l'ont invalidée : le
 * chemin visé (`/srv/rg-archive`) n'a jamais existé là-bas — `/srv` appartient à
 * `root`, donc le `mkdir -p` de l'utilisateur `ubuntu` échouait et le script
 * concluait « injoignable » alors que SSH répondait très bien ; puis, le 21/8/2026,
 * toutes les données rg et niers ont été rapatriées ici et le second VPS ne porte
 * plus rien du projet. Un hôte codé en dur qui échoue tous les jours n'est pas une
 * sauvegarde hors machine, c'est une alarme qu'on apprend à ignorer.
 *
 * Renseigner `RG_ARCHIVE_HOTE` (et éventuellement `RG_ARCHIVE_RACINE`) réactive
 * l'envoi et lui rend sa sévérité : dès qu'une destination est déclarée, ne pas
 * l'atteindre redevient un échec.
 */
const HÔTE_FROID = Bun.env.RG_ARCHIVE_HOTE ?? "";
const RACINE_FROIDE = Bun.env.RG_ARCHIVE_RACINE ?? "/srv/rg-archive";
const DOSSIER_FROID = `${RACINE_FROIDE}/postgres`;
/**
 * Fichiers déposés par les utilisateurs, servis par `rg-storage.service`.
 *
 * La base ne contient QUE leurs métadonnées : `storage.objects` décrit 7 476 objets,
 * mais les octets vivent ici. Restaurer le dump seul rendrait une base qui référence
 * des fichiers disparus — une sauvegarde qui a l'air complète et ne l'est pas.
 */
const FICHIERS_UTILISATEURS = "/var/www/rg-storage";
const FICHIERS_FROID = `${RACINE_FROIDE}/rg-storage`;
/** Bases système : leur contenu est recréé par l'installation, seuls les rôles comptent. */
const BASES_IGNORÉES = new Set(["template0", "template1", "postgres"]);
const COPIES_GARDÉES = 7;
/**
 * Copies gardées pour les FICHIERS, moins nombreuses que pour les bases.
 *
 * Un dump compressé pèse 14 Mio, les fichiers utilisateurs 5,4 Gio — et l'archive
 * froide n'avait plus que 5,4 Gio de libre après la première copie (95 % d'occupation,
 * mesuré le 14/8/2026). `--link-dest` rend les copies suivantes quasi gratuites tant
 * que les fichiers ne changent pas, mais « quasi » n'est pas « toujours » : trois jours
 * de recul sur des fichiers qui bougent peu valent mieux que sept jours et un disque
 * plein, où c'est la sauvegarde du jour qui échoue.
 */
const COPIES_FICHIERS_GARDÉES = 3;

const drapeaux = new Set(process.argv.slice(2));
const horodatage = new Date().toISOString().replaceAll(/[:.]/gu, "-").slice(0, 16);

let échecs = 0;
const log = (message: string) => process.stdout.write(`${message}\n`);
const erreur = (message: string) => {
  échecs += 1;
  process.stdout.write(`\u001B[31m✗ ${message}\u001B[0m\n`);
};

/** `psql`/`pg_dump` tournent sous l'identité `postgres` : authentification par pair, zéro secret. */
const enTantQuePostgres = (commande: string[]) => ["sudo", "-n", "-u", "postgres", ...commande];

async function bases(): Promise<string[]> {
  const sortie = await $`${enTantQuePostgres([
    "psql",
    "-At",
    "-c",
    "select datname from pg_database where not datistemplate",
  ])}`.text();
  return sortie
    .split("\n")
    .map(ligne => ligne.trim())
    .filter(nom => nom.length > 0 && !BASES_IGNORÉES.has(nom));
}

const mio = (octets: number) => `${(octets / 1024 / 1024).toFixed(1)} Mio`;

/** Les rôles et leurs droits : sans eux, une base restaurée n'accepte plus personne. */
async function sauverRôles(): Promise<void> {
  const cible = `${DESTINATION}/roles-${horodatage}.sql`;
  const résultat = await $`${enTantQuePostgres(["pg_dumpall", "--globals-only"])} > ${cible}`.nothrow().quiet();
  if (résultat.exitCode !== 0) {
    erreur(`rôles : ${résultat.stderr.toString().slice(0, 300)}`);
    return;
  }
  log(`  ✓ rôles          ${mio((await stat(cible)).size)}`);
}

async function sauverBase(base: string): Promise<string | null> {
  const cible = `${DESTINATION}/${base}-${horodatage}.dump`;
  const résultat = await $`${enTantQuePostgres([
    "pg_dump",
    "--format=custom",
    "--compress=9",
    "--dbname",
    base,
    "--file",
    cible,
  ])}`
    .nothrow()
    .quiet();
  if (résultat.exitCode !== 0) {
    erreur(`${base} : ${résultat.stderr.toString().slice(0, 300)}`);
    return null;
  }
  log(`  ✓ ${base.padEnd(14)} ${mio((await stat(cible)).size)}`);
  return cible;
}

/** Lecture de l'index de l'archive : détecte une troncature ou une corruption. */
async function relire(archive: string): Promise<number> {
  const résultat = await $`pg_restore --list ${archive}`.nothrow().quiet();
  if (résultat.exitCode !== 0) {
    erreur(`archive illisible : ${archive}`);
    return 0;
  }
  return résultat.stdout
    .toString()
    .split("\n")
    .filter(ligne => ligne.includes("TABLE DATA")).length;
}

/**
 * La seule preuve qui vaille : rejouer l'archive dans une base neuve et compter ce qui en
 * ressort. Une archive qui se liste bien peut encore refuser de se restaurer.
 */
async function restaurationDeContrôle(archive: string, base: string): Promise<void> {
  const témoin = `verif_restauration_${Date.now().toString(36)}`;
  try {
    await $`${enTantQuePostgres(["createdb", témoin])}`.quiet();
    // Les rôles de production n'existent pas dans la base jetable : sans --no-owner ni
    // --no-privileges, leur absence ferait échouer la restauration pour une mauvaise raison.
    const restauration = await $`${enTantQuePostgres([
      "pg_restore",
      "--dbname",
      témoin,
      "--no-owner",
      "--no-privileges",
      "--jobs",
      "4",
      archive,
    ])}`
      .nothrow()
      .quiet();

    const tables = (
      await $`${enTantQuePostgres([
        "psql",
        "-At",
        "-d",
        témoin,
        "-c",
        "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')",
      ])}`.text()
    ).trim();

    const lignes = (
      await $`${enTantQuePostgres([
        "psql",
        "-At",
        "-d",
        témoin,
        "-c",
        "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables",
      ])}`.text()
    ).trim();

    if (Number(tables) === 0) {
      erreur(`${base} : restauration de contrôle vide — la sauvegarde ne vaut rien`);
    } else {
      const réserve = restauration.exitCode === 0 ? "" : " (avec avertissements)";
      log(`  ✓ restauration   ${base} → ${tables} tables, ${lignes} lignes${réserve}`);
    }
  } catch (error) {
    erreur(`${base} : restauration de contrôle impossible — ${String(error).slice(0, 200)}`);
  } finally {
    await $`${enTantQuePostgres(["dropdb", "--if-exists", témoin])}`.nothrow().quiet();
  }
}

/** Ne garde que les `COPIES_GARDÉES` dernières archives de chaque base. */
async function rotation(): Promise<void> {
  const fichiers = await readdir(DESTINATION).catch(() => [] as string[]);
  const parBase = new Map<string, string[]>();
  for (const nom of fichiers) {
    const base = nom.replace(/-\d{4}-\d{2}-\d{2}T.*$/u, "");
    parBase.set(base, [...(parBase.get(base) ?? []), nom]);
  }
  for (const [base, liste] of parBase) {
    const àSupprimer = liste.toSorted().toReversed().slice(COPIES_GARDÉES);
    for (const nom of àSupprimer) {
      await unlink(`${DESTINATION}/${nom}`).catch(() => {});
    }
    if (àSupprimer.length > 0) {
      log(`  · rotation ${base} : ${àSupprimer.length} archive(s) retirée(s)`);
    }
  }
}

/**
 * Copie incrémentale des fichiers utilisateurs vers l'archive froide.
 *
 * `--link-dest` pointe sur la copie précédente : tout fichier inchangé devient un lien
 * dur au lieu d'un doublon, si bien qu'une deuxième sauvegarde de 5,4 Gio n'occupe que
 * ce qui a réellement bougé. Chaque copie reste pourtant complète et navigable — on
 * restaure un jour donné sans rejouer une chaîne d'incréments.
 *
 * Elle part APRÈS le dump : une base plus récente que les fichiers qu'elle décrit
 * référencerait des objets pas encore copiés, alors que l'inverse est sans danger.
 */
async function sauverFichiersUtilisateurs(): Promise<void> {
  if (!HÔTE_FROID) {
    log("  · pas d'archive froide déclarée — les fichiers utilisateurs restent sur ce disque");
    return;
  }
  // `Bun.file(...).exists()` répond FAUX sur un répertoire : la première version de
  // cette fonction annonçait donc « rien à copier » alors que les 5,4 Gio étaient là,
  // et sortait en succès. Un faux vert sur une sauvegarde est pire que pas de
  // sauvegarde du tout — on croit être couvert. D'où `stat` et un test de répertoire.
  const source = await stat(FICHIERS_UTILISATEURS).catch(() => null);
  if (!source?.isDirectory()) {
    erreur(`${FICHIERS_UTILISATEURS} introuvable ou n'est pas un répertoire — rien n'est copié`);
    return;
  }
  const cible = `${FICHIERS_FROID}/${horodatage}`;
  const préparation = await $`ssh -o BatchMode=yes -o ConnectTimeout=8 ${HÔTE_FROID} mkdir -p ${FICHIERS_FROID}`
    .nothrow()
    .quiet();
  if (préparation.exitCode !== 0) {
    erreur(`archive froide injoignable — les fichiers utilisateurs ne sont copiés NULLE PART`);
    return;
  }

  const envoi =
    await $`rsync -a --delete --timeout=600 --link-dest=${FICHIERS_FROID}/courant ${FICHIERS_UTILISATEURS}/ ${HÔTE_FROID}:${cible}/`
      .nothrow()
      .quiet();
  if (envoi.exitCode !== 0) {
    erreur(`copie des fichiers utilisateurs en échec : ${envoi.stderr.toString().slice(0, 300)}`);
    return;
  }

  // `courant` désigne la copie de référence du prochain --link-dest. Sans lui, chaque
  // sauvegarde repartirait de zéro et l'archive grossirait de 5,4 Gio par jour.
  await $`ssh -o BatchMode=yes ${HÔTE_FROID} ${`rm -f ${FICHIERS_FROID}/courant && ln -s ${horodatage} ${FICHIERS_FROID}/courant`}`
    .nothrow()
    .quiet();

  // Rotation distante : les copies au-delà des sept dernières partent, `courant` exclu.
  await $`ssh -o BatchMode=yes ${HÔTE_FROID} ${`cd ${FICHIERS_FROID} && ls -1d 20* 2>/dev/null | sort | head -n -${COPIES_FICHIERS_GARDÉES} | xargs -r rm -rf`}`
    .nothrow()
    .quiet();

  const mesure = (
    await $`ssh -o BatchMode=yes ${HÔTE_FROID} ${`du -sh ${FICHIERS_FROID} && du -sh ${cible}`}`.nothrow().quiet()
  ).stdout
    .toString()
    .trim()
    .replaceAll("\n", " · ");
  log(`  ✓ fichiers       ${mesure || cible}`);
}

async function envoyerHorsMachine(): Promise<void> {
  if (!HÔTE_FROID) {
    log("  · pas d'archive froide déclarée (RG_ARCHIVE_HOTE) — sauvegardes locales seules");
    return;
  }
  const joignable = await $`ssh -o BatchMode=yes -o ConnectTimeout=8 ${HÔTE_FROID} mkdir -p ${DOSSIER_FROID}`
    .nothrow()
    .quiet();
  if (joignable.exitCode !== 0) {
    erreur(`archive froide injoignable (${HÔTE_FROID}) — les sauvegardes ne sont QUE sur ce disque`);
    return;
  }
  const envoi = await $`rsync -a --delete-after --timeout=120 ${DESTINATION}/ ${HÔTE_FROID}:${DOSSIER_FROID}/`
    .nothrow()
    .quiet();
  if (envoi.exitCode !== 0) {
    erreur(`envoi vers l'archive froide en échec : ${envoi.stderr.toString().slice(0, 300)}`);
    return;
  }
  const distant = (await $`ssh -o BatchMode=yes ${HÔTE_FROID} du -sh ${DOSSIER_FROID}`.nothrow().quiet()).stdout
    .toString()
    .trim();
  log(`  ✓ hors machine   ${distant || DOSSIER_FROID}`);
}

// ─────────────────────────────────────────────────────────────────────────────

await mkdir(DESTINATION, { recursive: true }).catch(async () => {
  await $`sudo -n mkdir -p ${DESTINATION}`.nothrow().quiet();
  await $`sudo -n chown ${process.env.USER ?? "ubuntu"} ${DESTINATION}`.nothrow().quiet();
});

const liste = await bases();
log(`sauvegarde postgres — ${horodatage} — bases : ${liste.join(", ")}`);

if (drapeaux.has("--verifier")) {
  const archives = (await readdir(DESTINATION)).filter(nom => nom.endsWith(".dump")).toSorted();
  // Une archive par base, la plus récente. Prendre les N derniers noms triés alphabétiquement
  // vérifierait deux fois la même base et jamais celle qui porte la production.
  for (const base of liste) {
    const dernière = archives.filter(nom => nom.startsWith(`${base}-`)).at(-1);
    if (!dernière) {
      erreur(`${base} : aucune archive sur le disque`);
      continue;
    }
    const tables = await relire(`${DESTINATION}/${dernière}`);
    log(`  · ${dernière} : ${tables} tables avec données`);
  }
} else {
  await sauverRôles();
  const produites: Array<[string, string]> = [];
  for (const base of liste) {
    const archive = await sauverBase(base);
    if (archive) {
      produites.push([base, archive]);
    }
  }

  log("vérification");
  for (const [base, archive] of produites) {
    const tables = await relire(archive);
    if (tables === 0) {
      erreur(`${base} : archive sans aucune donnée de table`);
    }
  }
  // La restauration réelle est coûteuse : on l'exige sur la base qui porte la production.
  const principale = produites.find(([base]) => base === "rg") ?? produites[0];
  if (principale) {
    await restaurationDeContrôle(principale[1], principale[0]);
  }

  await rotation();
  if (!drapeaux.has("--local")) {
    await envoyerHorsMachine();
    log("fichiers utilisateurs");
    await sauverFichiersUtilisateurs();
  }
}

log(échecs === 0 ? "\n\u001B[32m✓ sauvegarde vérifiée\u001B[0m" : `\n\u001B[31m${échecs} échec(s)\u001B[0m`);
process.exit(échecs === 0 ? 0 : 1);
