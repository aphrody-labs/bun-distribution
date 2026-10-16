#!/usr/bin/env bun
/**
 * infra.ts — versionnement de l'infrastructure servie : unités systemd, vhosts nginx,
 * réglages noyau et rotation des journaux.
 *
 * Pourquoi ce script existe
 * -------------------------
 * La production tournait sur seize unités systemd et une vingtaine de vhosts nginx, dont
 * six unités et douze vhosts seulement étaient dans le dépôt. Le reste — `rg-postgrest`,
 * `rg-realtime`, `rg-storage`, `nie-model-serve`, `rosegriffon.conf` (le site principal) —
 * n'existait que sur le disque du VPS. Une réinstallation aurait redémarré un serveur muet :
 * le code était versionné, la façon de le servir ne l'était pas.
 *
 * Copier les fichiers une fois n'aurait rien réglé : ils divergent dès la première
 * modification faite en direct sur la machine. Ce script fait donc de la dérive une chose
 * **mesurable** (`check`, qui sort en 1) et **réversible** (`pull`), au lieu d'une surprise.
 *
 * Ce qui n'est jamais versionné
 * -----------------------------
 * Les secrets. Toutes les unités les prennent par `EnvironmentFile=` (`/etc/rg-mcp.env`,
 * `/etc/rg-realtime.env`, `/etc/rg-storage.env`, `apps/cdn/.env`) : le fichier d'unité ne
 * contient que le chemin. `check --secrets` le revérifie à chaque passage, pour qu'un
 * `Environment=…=<jeton>` ajouté à la main ne se retrouve pas dans un commit.
 *
 * Usage
 * -----
 *   bun scripts/iecode/rg/infra.ts            # dérive dépôt ↔ machine (défaut : check)
 *   bun scripts/iecode/rg/infra.ts pull       # importe la machine dans le dépôt
 *   bun scripts/iecode/rg/infra.ts diff <nom> # diff unifié d'un seul objet
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Unités RG, vhosts RG, réglages hôte et units transverses : propriété du dépôt
// aphrody-infra (le dépôt rg ne garde que le code applicatif).
// Ils vivent désormais dans yolo : `$YOLO_ROOT/config/host` (défaut `~/yolo`).
const YOLO_ROOT = Bun.env.YOLO_ROOT ?? join(Bun.env.HOME ?? Bun.env.USERPROFILE ?? homedir(), "yolo");
const INFRA_HOTE = `${YOLO_ROOT}/config/host`;
const INFRA_SYSTEMD = `${INFRA_HOTE}/systemd/rg`;
const INFRA_NGINX = `${INFRA_HOTE}/nginx/rg`;
const HOTE_SYSTEMD = INFRA_SYSTEMD;
const INFRA_SYSCTL = `${INFRA_HOTE}/rg/sysctl`;
const INFRA_LOGROTATE = `${INFRA_HOTE}/rg/logrotate`;
const HOST_CLI = `${YOLO_ROOT}/packages/core/src/host/cli.ts`;
// Les services du jeu et les vhosts Aphrody ont migré dans le dépôt `niers`.
// Les recopier ici recréerait deux sources de vérité qui divergent. Le contrôle
// suit donc leur source canonique là où elle vit réellement.
const NIE_REPO_ROOT = (() => {
  if (Bun.env.NIE_REPO_ROOT) return resolve(Bun.env.NIE_REPO_ROOT);
  const workspaceCheckout = resolve(import.meta.dir, "../../../../nie");
  return existsSync(workspaceCheckout) ? workspaceCheckout : resolve(homedir(), "nie");
})();
const NIERS_SYSTEMD = `${NIE_REPO_ROOT}/deploy/systemd`;
const NIERS_NGINX = `${NIE_REPO_ROOT}/deploy/nginx`;
const NGINX_CONF_D = "/etc/nginx/conf.d";
const SYSCTL_D = "/etc/sysctl.d";
const LOGROTATE_D = "/etc/logrotate.d";

/** Fichiers d'un arbre, avec chemins relatifs POSIX (inclut les drop-ins systemd). */
async function fichiersRecursifs(racine: string, préfixe = ""): Promise<string[]> {
  const entrées = await readdir(racine, { withFileTypes: true }).catch(() => []);
  const fichiers: string[] = [];
  for (const entrée of entrées) {
    const relatif = préfixe === "" ? entrée.name : `${préfixe}/${entrée.name}`;
    if (entrée.isDirectory()) {
      fichiers.push(...(await fichiersRecursifs(join(racine, entrée.name), relatif)));
    } else if (entrée.isFile()) {
      fichiers.push(relatif);
    }
  }
  return fichiers;
}

/**
 * Préfixes d'unités systemd du périmètre. Une unité qui commence par l'un d'eux est
 * attendue dans le dépôt ; c'est la découverte qui fait foi, pas une liste figée, sinon
 * une unité ajoutée un soir sur la machine resterait invisible pour toujours.
 */
const PRÉFIXES_UNITÉS = ["azalee-", "rg-", "website-", "nie-", "cdn-", "rag-", "iecode-"];

/** Fichiers de `conf.d` à ignorer : sauvegardes horodatées, que nginx ne charge pas. */
const IGNORÉS_NGINX = /\.(bak|old|orig|disabled)/u;

interface Objet {
  /** Nom du fichier, identique des deux côtés. */
  nom: string;
  /** Chemin dans le dépôt. */
  dépôt: string;
  /** Chemin sur la machine, ou null si l'objet n'existe que dans le dépôt. */
  machine: string | null;
  famille: "systemd" | "nginx" | "sysctl" | "logrotate";
}

type État = "identique" | "diverge" | "absent-dépôt" | "absent-machine";

const lire = async (chemin: string | null): Promise<string | null> => {
  if (!chemin) {
    return null;
  }
  const fichier = Bun.file(chemin);
  if (!(await fichier.exists())) {
    return null;
  }
  // Les unités du dépôt sont stockées sans leurs drop-ins partagés : on compare l'unité composée.
  if (chemin.startsWith(`${INFRA_SYSTEMD}/`) && /\.(service|timer)$/u.test(chemin)) {
    const composée = Bun.spawnSync(["bun", HOST_CLI, "compose-unit", chemin.split("/").at(-1) ?? ""], {
      env: { ...process.env, YOLO_ROOT },
    });
    if (composée.exitCode === 0) {
      return composée.stdout.toString();
    }
  }
  return await fichier.text();
};

/** Dépôt source d'une unité : niers, rg, sinon aphrody-infra (units transverses). */
const sourceUnité = (nom: string, dansNiers: string[], dansDépôt: string[]): string => {
  if (dansNiers.includes(nom)) {
    return `${NIERS_SYSTEMD}/${nom}`;
  }
  return dansDépôt.includes(nom) ? `${INFRA_SYSTEMD}/${nom}` : `${HOTE_SYSTEMD}/${nom}`;
};

/** Unités du périmètre connues de systemd, plus celles déjà présentes dans le dépôt. */
async function unités(): Promise<Objet[]> {
  const sortie = await $`systemctl list-unit-files --type=service,timer --no-pager --plain --no-legend`.text();
  // Un service planifié n'est rien sans son timer : les deux se versionnent ensemble.
  const suffixe = (nom: string) => nom.endsWith(".service") || nom.endsWith(".timer");
  const surMachine = sortie
    .split("\n")
    .map(ligne => ligne.trim().split(/\s+/u)[0] ?? "")
    .filter(suffixe)
    .filter(nom => PRÉFIXES_UNITÉS.some(préfixe => nom.startsWith(préfixe)));

  const dansDépôt = await readdir(INFRA_SYSTEMD).catch(() => [] as string[]);
  const dansNiers = await readdir(NIERS_SYSTEMD).catch(() => [] as string[]);
  const dansHôte = await readdir(HOTE_SYSTEMD).catch(() => [] as string[]);
  const noms = [
    ...new Set([
      ...surMachine,
      ...dansDépôt.filter(suffixe),
      ...dansNiers.filter(suffixe),
      ...dansHôte.filter(nom => suffixe(nom)),
    ]),
  ];

  return Promise.all(
    noms.toSorted().map(async nom => {
      const fragment = (await $`systemctl show ${nom} -p FragmentPath --value`.text().catch(() => "")).trim();
      // Les unités livrées par un paquet (/usr/lib/systemd) ne sont pas les nôtres.
      const nôtre = fragment.startsWith("/etc/systemd/system/");
      return {
        dépôt: sourceUnité(nom, dansNiers, dansDépôt),
        famille: "systemd" as const,
        machine: nôtre ? fragment : null,
        nom,
      };
    }),
  ).then(liste =>
    liste.filter(
      o => o.machine !== null || dansDépôt.includes(o.nom) || dansNiers.includes(o.nom) || dansHôte.includes(o.nom),
    ),
  );
}

/**
 * Les drop-ins sont des unités effectives : les omettre laisse une partie des
 * limites, variables et politiques de reprise hors du contrôle de dérive.
 */
async function dropinsSystemd(): Promise<Objet[]> {
  const fichiers = await fichiersRecursifs(HOTE_SYSTEMD);
  return fichiers
    .filter(relatif => /\.(?:service|timer)\.d\/[^/]+\.conf$/u.test(relatif))
    .toSorted()
    .map(relatif => ({
      dépôt: `${HOTE_SYSTEMD}/${relatif}`,
      famille: "systemd" as const,
      machine: `/etc/systemd/system/${relatif}`,
      nom: relatif,
    }));
}

/** Vhosts et fragments nginx effectivement chargés (`conf.d/*.conf` et les `.inc` inclus). */
async function vhosts(): Promise<Objet[]> {
  const surMachine = (await readdir(NGINX_CONF_D).catch(() => [] as string[])).filter(
    nom => (nom.endsWith(".conf") || nom.endsWith(".inc")) && !IGNORÉS_NGINX.test(nom),
  );
  const dansDépôt = (await readdir(INFRA_NGINX).catch(() => [] as string[])).filter(
    nom => nom.endsWith(".conf") || nom.endsWith(".inc") || nom.endsWith(".http"),
  );
  const dansNiers = (await readdir(NIERS_NGINX).catch(() => [] as string[])).filter(
    nom => nom.endsWith(".conf") || nom.endsWith(".inc") || nom.endsWith(".http"),
  );
  const noms = [...new Set([...surMachine, ...dansDépôt, ...dansNiers])].toSorted();

  return noms.map(nom => ({
    dépôt: dansNiers.includes(nom) ? `${NIERS_NGINX}/${nom}` : `${INFRA_NGINX}/${nom}`,
    famille: "nginx" as const,
    machine: surMachine.includes(nom) ? `${NGINX_CONF_D}/${nom}` : null,
    nom,
  }));
}

/**
 * Réglages noyau posés par ce dépôt. Seuls les fichiers déjà versionnés sont suivis : le
 * reste de `/etc/sysctl.d` appartient à l'image du fournisseur ou à d'autres projets du VPS,
 * et l'importer reviendrait à s'en déclarer propriétaire.
 */
async function réglagesNoyau(): Promise<Objet[]> {
  const dansDépôt = (await readdir(INFRA_SYSCTL).catch(() => [] as string[])).filter(nom => nom.endsWith(".conf"));
  return dansDépôt.toSorted().map(nom => ({
    dépôt: `${INFRA_SYSCTL}/${nom}`,
    famille: "sysctl" as const,
    machine: `${SYSCTL_D}/${nom}`,
    nom,
  }));
}

/**
 * Politiques de rotation des journaux posées par ce dépôt. Même règle que pour les
 * réglages noyau : seuls les fichiers déjà versionnés sont suivis, le reste de
 * `/etc/logrotate.d` appartient aux paquets du système.
 */
async function rotationJournaux(): Promise<Objet[]> {
  const dansDépôt = await readdir(INFRA_LOGROTATE).catch(() => [] as string[]);
  return dansDépôt.toSorted().map(nom => ({
    dépôt: `${INFRA_LOGROTATE}/${nom}`,
    famille: "logrotate" as const,
    machine: `${LOGROTATE_D}/${nom}`,
    nom,
  }));
}

async function état(objet: Objet): Promise<État> {
  const [côtéDépôt, côtéMachine] = await Promise.all([lire(objet.dépôt), lire(objet.machine)]);
  if (côtéDépôt === null && côtéMachine === null) {
    return "identique";
  }
  if (côtéDépôt === null) {
    return "absent-dépôt";
  }
  if (côtéMachine === null) {
    return "absent-machine";
  }
  return côtéDépôt === côtéMachine ? "identique" : "diverge";
}

/**
 * Un secret inscrit en dur dans une unité. `Environment=CLE=valeur` est légitime pour un
 * port ou un chemin ; il ne l'est pas pour un jeton, et c'est le nom de la clé qui tranche.
 */
const MOTIF_SECRET =
  /^\s*Environment=[^=\n]*(SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|KEY|DSN|CREDENTIAL)[^=\n]*=(.+)$/gimu;

function secrets(contenu: string): string[] {
  const trouvés: string[] = [];
  for (const [, clé, valeur] of contenu.matchAll(MOTIF_SECRET)) {
    const brut = (valeur ?? "").trim().replaceAll(/^["']|["']$/gu, "");
    // Un chemin de fichier ou une valeur courte n'est pas un secret.
    if (brut.startsWith("/") || brut.length < 12) {
      continue;
    }
    trouvés.push(`${clé}… = ${brut.slice(0, 6)}…`);
  }
  return trouvés;
}

const COULEUR = {
  "absent-dépôt": "[31m",
  "absent-machine": "[36m",
  diverge: "[33m",
  identique: "[32m",
} as const;
const FIN = "[0m";

const LÉGENDE: Record<État, string> = {
  "absent-dépôt": "ABSENT DU DÉPÔT",
  "absent-machine": "absent de la machine",
  diverge: "DIVERGE",
  identique: "identique",
};

async function commandeCheck(options: { secrets: boolean }): Promise<number> {
  const objets = [
    ...(await unités()),
    ...(await dropinsSystemd()),
    ...(await vhosts()),
    ...(await réglagesNoyau()),
    ...(await rotationJournaux()),
  ];
  const états = await Promise.all(objets.map(async o => ({ objet: o, état: await état(o) })));

  let dérive = 0;
  for (const famille of ["systemd", "nginx", "sysctl", "logrotate"] as const) {
    const lot = états.filter(e => e.objet.famille === famille);
    process.stdout.write(`\n${famille} (${lot.length})\n`);
    for (const { objet, état: st } of lot) {
      // « absent de la machine » n'est pas une dérive : ce sont les gabarits que le dépôt
      // Garde sans les servir (bascule HTTP-only d'azalée, doublure b hors rotation).
      if (st === "diverge" || st === "absent-dépôt") {
        dérive += 1;
      }
      process.stdout.write(`  ${COULEUR[st]}${LÉGENDE[st].padEnd(20)}${FIN} ${objet.nom}\n`);
    }
  }

  if (options.secrets) {
    process.stdout.write("\nsecrets en dur\n");
    let compte = 0;
    for (const objet of objets.filter(o => o.famille === "systemd")) {
      const contenu = (await lire(objet.machine)) ?? (await lire(objet.dépôt));
      for (const trouvé of secrets(contenu ?? "")) {
        compte += 1;
        process.stdout.write(`  [31m${objet.nom}[0m : ${trouvé}\n`);
      }
    }
    if (compte === 0) {
      process.stdout.write("  aucun — tous les secrets passent par EnvironmentFile\n");
    } else {
      dérive += compte;
    }
  }

  process.stdout.write(
    dérive === 0
      ? "\n[32m✓ dépôt et machine alignés[0m\n"
      : `\n[33m${dérive} écart(s)[0m — « bun scripts/iecode/rg/infra.ts pull » pour importer la machine\n`,
  );
  return dérive === 0 ? 0 : 1;
}

async function commandePull(): Promise<number> {
  const objets = [
    ...(await unités()),
    ...(await dropinsSystemd()),
    ...(await vhosts()),
    ...(await réglagesNoyau()),
    ...(await rotationJournaux()),
  ];
  let importés = 0;
  for (const objet of objets) {
    const st = await état(objet);
    if (st === "identique" || st === "absent-machine") {
      continue;
    }
    const contenu = await lire(objet.machine);
    if (contenu === null) {
      continue;
    }
    await Bun.write(objet.dépôt, contenu);
    importés += 1;
    process.stdout.write(`  importé  ${objet.famille}/${objet.nom}\n`);
  }
  process.stdout.write(importés === 0 ? "rien à importer\n" : `\n${importés} fichier(s) importé(s) dans infra/\n`);
  return 0;
}

async function commandeDiff(nom: string): Promise<number> {
  const objets = [
    ...(await unités()),
    ...(await dropinsSystemd()),
    ...(await vhosts()),
    ...(await réglagesNoyau()),
    ...(await rotationJournaux()),
  ];
  const objet = objets.find(o => o.nom === nom || o.nom === `${nom}.service`);
  if (!objet) {
    process.stderr.write(`objet inconnu : ${nom}\n`);
    return 2;
  }
  if (!objet.machine) {
    process.stderr.write(`${objet.nom} n'existe pas sur la machine\n`);
    return 2;
  }
  await $`diff -u ${objet.dépôt} ${objet.machine}`.nothrow();
  return 0;
}

const [commande = "check", argument] = process.argv.slice(2);
const code = await (async () => {
  switch (commande) {
    case "check": {
      return commandeCheck({ secrets: true });
    }
    case "pull": {
      return commandePull();
    }
    case "diff": {
      return argument ? commandeDiff(argument) : 2;
    }
    default: {
      process.stderr.write("usage : bun scripts/iecode/rg/infra.ts [check|pull|diff <nom>]\n");
      return 2;
    }
  }
})();
process.exit(code);
