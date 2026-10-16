/**
 * Lecture de l'état de déploiement bleu/vert, À LA SOURCE.
 *
 * ── OÙ VIT LA VÉRITÉ ───────────────────────────────────────────────────────
 * `scripts/ops/deploy.ts` ne garde rien en mémoire : il écrit tout sur disque,
 * sous `~/rg-releases/<app>/`. Trois fichiers, tous lus ici :
 *
 *   `state.json`             — slot vivant (`live`), version servie (`release`),
 *                              version précédente, prévisualisation en cours,
 *                              et l'historique des 30 dernières actions
 *                              (`deploy` / `rollback` / `promote` / `reload`).
 *   `live.env`               — ce que nginx sert RÉELLEMENT : `LIVE_SLOT`,
 *                              `LIVE_UNIT`, `LIVE_PORT`, `LIVE_RELEASE`.
 *   `slot-<live>/RELEASE.json` — le `BUILD_ID` de Next, l'instant d'assemblage,
 *                              le commit et la branche de la version servie.
 *
 * ── POURQUOI PAS `deploy.ts status --json` ─────────────────────────────────
 * Cette sous-commande existe et fonctionne (mesuré le 13/8/2026), mais elle
 * lance `systemctl show` par slot et sonde les deux domaines publics depuis
 * l'extérieur : c'est un processus enfant et deux requêtes réseau, alors que la
 * question posée — « quelle version est servie ? » — a sa réponse dans trois
 * fichiers. Or `rg-bot.service` tourne sous `ProtectSystem=strict` /
 * `ProtectHome=read-only` : lire `~/rg-releases` lui est permis,
 * engendrer un processus dans ce bac à sable serait fragile pour rien.
 *
 * Ce que ces fichiers NE disent pas, on ne l'invente pas : la mémoire résidente
 * des unités et leur état `systemctl` ne sont pas lisibles ainsi, et l'embed
 * dit alors d'aller voir `bun run deploy status`. En revanche la santé réelle
 * du port servi est vérifiable, elle, par la sonde HTTP des services `wiki` et
 * `site` — c'est elle qui est affichée.
 */
import { homePath } from "@aphrody/paths";
import { analyserRelease, type VersionDeployee } from "./format";

/** Racine des versions figées. Surchargeable pour un poste de développement. */
export const RACINE_VERSIONS = (Bun.env.RG_RELEASES_ROOT ?? homePath("rg-releases")).replace(/\/+$/, "");

/**
 * L'unique application Next servie par nginx. Le wiki `/wiki` a vécu dans une
 * app `azalee` séparée, avec sa propre release ; depuis la fusion dans
 * `apps/website`, les deux domaines publics servent la MÊME release — inutile
 * de la lire deux fois sous deux clefs différentes.
 */
export const APPLICATIONS_DEPLOYEES = [
  { clef: "website", titre: "Site Rose Griffon", service: "site" as const },
] as const;

export type ClefApplication = (typeof APPLICATIONS_DEPLOYEES)[number]["clef"];

interface EtatDisque {
  live?: unknown;
  release?: unknown;
  previousRelease?: unknown;
  preview?: unknown;
  updatedAt?: unknown;
  history?: unknown;
}

export interface ActionDeploiement {
  readonly at: string;
  readonly action: string;
  readonly release: string;
  readonly ok: boolean;
}

export interface EtatApplication {
  readonly clef: ClefApplication;
  readonly titre: string;
  /** Slot servi par nginx : `a` (nominal) ou `b` (doublure). */
  readonly slot: string | null;
  /** Unité systemd du slot servi, telle qu'écrite par le déployeur. */
  readonly unite: string | null;
  /** Port en boucle locale du slot servi. */
  readonly port: number | null;
  /** Version servie, décomposée. */
  readonly version: VersionDeployee | null;
  /** Version précédente, disponible pour un retour arrière. */
  readonly versionPrecedente: VersionDeployee | null;
  /** `BUILD_ID` de Next, commit et branche — quand `RELEASE.json` est là. */
  readonly buildId: string | null;
  readonly commit: string | null;
  readonly branche: string | null;
  readonly assembleeLe: string | null;
  /** Une prévisualisation est-elle ouverte sur la doublure ? */
  readonly previsualisation: string | null;
  /** Dernière écriture de `state.json`. */
  readonly misAJourLe: string | null;
  /** Historique récent, du plus récent au plus ancien. */
  readonly historique: readonly ActionDeploiement[];
  /**
   * Divergence entre `state.json` et `live.env`. Non nul = le déployeur a été
   * interrompu entre les deux écritures, ou quelqu'un a bougé nginx à la main.
   */
  readonly incoherence: string | null;
  /** Ce qui n'a pas pu être lu, dit franchement plutôt que comblé. */
  readonly manquant: readonly string[];
}

async function lireJson(chemin: string): Promise<unknown | null> {
  try {
    const fichier = Bun.file(chemin);
    if (!(await fichier.exists())) {
      return null;
    }
    return (await fichier.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Analyse un `live.env` (format `CLÉ=valeur`, commentaires en `#`).
 *
 * Écrit à la main plutôt que confié à un chargeur d'environnement : ce fichier
 * ne doit JAMAIS être injecté dans `Bun.env` du bot — il porte `LIVE_PORT`, qui
 * écraserait une variable homonyme.
 */
export function analyserLiveEnv(contenu: string): Record<string, string> {
  const valeurs: Record<string, string> = {};
  for (const ligne of contenu.split("\n")) {
    const propre = ligne.trim();
    if (propre.length === 0 || propre.startsWith("#")) {
      continue;
    }
    const coupure = propre.indexOf("=");
    if (coupure <= 0) {
      continue;
    }
    valeurs[propre.slice(0, coupure).trim()] = propre.slice(coupure + 1).trim();
  }
  return valeurs;
}

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.length > 0 ? valeur : null;
}

/** Lit l'état complet d'une application. Ne lève pas : ce qui manque est signalé. */
export async function lireEtatApplication(
  application: (typeof APPLICATIONS_DEPLOYEES)[number],
): Promise<EtatApplication> {
  const racine = `${RACINE_VERSIONS}/${application.clef}`;
  const manquant: string[] = [];

  const etat = ((await lireJson(`${racine}/state.json`)) ?? {}) as EtatDisque;
  if (Object.keys(etat).length === 0) {
    manquant.push("state.json");
  }

  let live: Record<string, string> = {};
  try {
    const fichier = Bun.file(`${racine}/live.env`);
    live = (await fichier.exists()) ? analyserLiveEnv(await fichier.text()) : {};
    if (Object.keys(live).length === 0) {
      manquant.push("live.env");
    }
  } catch {
    manquant.push("live.env");
  }

  const slot = live.LIVE_SLOT ?? texte(etat.live);
  const releaseEtat = texte(etat.release);
  const releaseServie = live.LIVE_RELEASE ?? releaseEtat;

  const marque = slot
    ? ((await lireJson(`${racine}/slot-${slot}/RELEASE.json`)) as Record<string, unknown> | null)
    : null;
  if (!marque) {
    manquant.push(slot ? `slot-${slot}/RELEASE.json` : "RELEASE.json");
  }

  // Les deux sources doivent dire la même chose. Quand elles divergent, le
  // silence serait pire que le désaccord : nginx sert `live.env`, mais le
  // déployeur raisonne sur `state.json`.
  let incoherence: string | null = null;
  if (releaseEtat && live.LIVE_RELEASE && releaseEtat !== live.LIVE_RELEASE) {
    incoherence = `\`state.json\` annonce \`${releaseEtat}\`, \`live.env\` sert \`${live.LIVE_RELEASE}\``;
  } else if (texte(etat.live) && live.LIVE_SLOT && texte(etat.live) !== live.LIVE_SLOT) {
    incoherence = `\`state.json\` annonce le slot \`${String(etat.live)}\`, \`live.env\` sert le slot \`${live.LIVE_SLOT}\``;
  }

  const historique = Array.isArray(etat.history)
    ? etat.history
        .filter((entree): entree is Record<string, unknown> => !!entree && typeof entree === "object")
        .map((entree): ActionDeploiement => ({
          at: texte(entree.at) ?? "",
          action: texte(entree.action) ?? "?",
          release: texte(entree.release) ?? "",
          ok: entree.ok === true,
        }))
        .toReversed()
    : [];

  const previsualisation =
    etat.preview && typeof etat.preview === "object" ? texte((etat.preview as Record<string, unknown>).release) : null;

  const port = Number.parseInt(live.LIVE_PORT ?? "", 10);

  return {
    clef: application.clef,
    titre: application.titre,
    slot,
    unite: live.LIVE_UNIT ?? null,
    port: Number.isFinite(port) ? port : null,
    version: analyserRelease(releaseServie),
    versionPrecedente: analyserRelease(texte(etat.previousRelease)),
    buildId: marque ? texte(marque.buildId) : null,
    commit: marque ? texte(marque.commit) : null,
    branche: marque ? texte(marque.branch) : null,
    assembleeLe: marque ? texte(marque.assembledAt) : null,
    previsualisation,
    misAJourLe: texte(etat.updatedAt),
    historique,
    incoherence,
    manquant,
  };
}

/** Lit les deux applications en parallèle. */
export async function lireEtatDeploiement(): Promise<EtatApplication[]> {
  return await Promise.all(APPLICATIONS_DEPLOYEES.map(lireEtatApplication));
}
