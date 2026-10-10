// SPDX-License-Identifier: Apache-2.0
/**
 * creator-kit inside the Aphrody desktop (route `creator` of app-ui). Each action is a form over one existing
 * command of `src/commands`; the run is the same code path as the terminal (`creator-kit <command> ...`).
 */
import { existsSync, readFileSync } from "node:fs";

import { registry } from "./commands/index.ts";
import { UsageError } from "../shared/args.ts";
import { crashLogPath } from "../shared/crash.ts";
import {
  argvFor,
  captureConsole,
  KIT_PROTOCOL,
  runDesktop,
  type KitAction,
  type KitBridge,
  type KitCatalog,
  type KitChannel,
  type KitField,
  type KitGroup,
  type KitInput,
} from "../shared/desktop.ts";
import { VERSION } from "../shared/update.ts";

interface CreatorAction extends KitAction {
  /** Command line before the form values; empty for the actions handled here. */
  argv: string[];
}

const tournament: KitField = {
  name: "tournament",
  label: "Tournoi (id ou URL, vide : le dernier créé)",
  kind: "text",
  flag: "--tournament",
};
const dryRun: KitField = {
  name: "dryRun",
  label: "Simulation (rien n'est envoyé ni écrit)",
  kind: "boolean",
  flag: "--dry-run",
};

export const CREATOR_GROUPS: KitGroup[] = [
  { id: "tournoi", title: "Tournois Challonge", icon: "emoji_events" },
  { id: "images", title: "Images", icon: "image" },
  { id: "nettoyage", title: "Nettoyage du PC", icon: "cleaning_services" },
  { id: "video", title: "Vidéo", icon: "subtitles" },
  { id: "kit", title: "Le kit", icon: "system_update" },
];

export const CREATOR_ACTIONS: CreatorAction[] = [
  {
    id: "challonge-list",
    group: "tournoi",
    title: "Mes tournois",
    argv: ["challonge", "list"],
    fields: [
      {
        name: "state",
        label: "État",
        kind: "select",
        flag: "--state",
        options: [
          { value: "pending", label: "À venir" },
          { value: "in_progress", label: "En cours" },
          { value: "ended", label: "Terminés" },
        ],
      },
    ],
  },
  {
    id: "challonge-create",
    group: "tournoi",
    title: "Créer un tournoi",
    description: "Crée le tournoi, ajoute les participants et peut le lancer.",
    argv: ["challonge", "create"],
    fields: [
      { name: "name", label: "Nom du tournoi", kind: "text", flag: "--name", required: true },
      { name: "game", label: "Jeu", kind: "text", flag: "--game" },
      {
        name: "type",
        label: "Format",
        kind: "select",
        flag: "--type",
        options: [
          { value: "single_elimination", label: "Élimination simple" },
          { value: "double_elimination", label: "Double élimination" },
          { value: "round_robin", label: "Poules (round robin)" },
          { value: "swiss", label: "Suisse" },
        ],
      },
      {
        name: "participants",
        label: "Participants (fichier ou « a,b,c »)",
        kind: "text",
        flag: "--participants",
      },
      {
        name: "shuffle",
        label: "Tirage au sort des têtes de série",
        kind: "boolean",
        flag: "--shuffle",
      },
      { name: "start", label: "Lancer tout de suite", kind: "boolean", flag: "--start" },
      dryRun,
    ],
  },
  {
    id: "challonge-show",
    group: "tournoi",
    title: "État et lien du bracket",
    argv: ["challonge", "show"],
    fields: [tournament],
  },
  {
    id: "challonge-matches",
    group: "tournoi",
    title: "Matchs",
    argv: ["challonge", "matches"],
    fields: [
      tournament,
      {
        name: "state",
        label: "État",
        kind: "select",
        flag: "--state",
        options: [
          { value: "open", label: "À jouer" },
          { value: "pending", label: "En attente" },
          { value: "complete", label: "Terminés" },
        ],
      },
    ],
  },
  {
    id: "challonge-report",
    group: "tournoi",
    title: "Saisir un score",
    argv: ["challonge", "report"],
    fields: [
      { name: "match", label: "Match (numéro ou id)", kind: "text", required: true },
      { name: "score", label: "Score (ex. 2-1)", kind: "text", required: true },
      { name: "winner", label: "Vainqueur (1, 2, nom ou id)", kind: "text", flag: "--winner" },
      tournament,
    ],
  },
  {
    id: "challonge-start",
    group: "tournoi",
    title: "Lancer le tournoi",
    argv: ["challonge", "start"],
    fields: [
      tournament,
      { name: "shuffle", label: "Tirage au sort juste avant", kind: "boolean", flag: "--shuffle" },
    ],
    confirm: { message: "Lancer le tournoi ? Les inscriptions seront fermées." },
  },
  {
    id: "challonge-finalize",
    group: "tournoi",
    title: "Clôturer le tournoi",
    argv: ["challonge", "finalize"],
    fields: [tournament],
    confirm: { message: "Clôturer le tournoi ? Le classement sera figé." },
  },
  {
    id: "challonge-bot",
    group: "tournoi",
    title: "Bot Discord",
    description: "Commandes /tournoi sur Discord tant que cette action tourne.",
    argv: ["challonge", "bot"],
    longRunning: true,
  },
  {
    id: "wiki-images",
    group: "images",
    title: "Images d'un wiki",
    description:
      "Télécharge les images d'une page, d'une galerie ou d'une catégorie (MediaWiki, Fandom).",
    argv: ["wiki-images"],
    fields: [
      { name: "url", label: "Adresse de la page du wiki", kind: "url", required: true },
      {
        name: "category",
        label: "Catégories (séparées par des virgules)",
        kind: "text",
        flag: "--category",
        repeat: true,
      },
      { name: "prefix", label: "Préfixe des fichiers", kind: "text", flag: "--prefix" },
      { name: "out", label: "Dossier de destination", kind: "path", flag: "--out" },
      dryRun,
    ],
  },
  {
    id: "img-compress",
    group: "images",
    title: "Compresser des images",
    description: "En local ; les originaux ne sont pas modifiés sauf « remplacer ».",
    argv: ["img-compress"],
    fields: [
      {
        name: "paths",
        label: "Fichiers ou dossiers (séparés par des virgules)",
        kind: "path",
        required: true,
        repeat: true,
      },
      {
        name: "format",
        label: "Format",
        kind: "select",
        flag: "--format",
        options: [
          { value: "keep", label: "Garder" },
          { value: "webp", label: "WebP" },
          { value: "jpeg", label: "JPEG" },
          { value: "png", label: "PNG" },
        ],
      },
      { name: "quality", label: "Qualité (1-100)", kind: "number", flag: "--quality" },
      { name: "out", label: "Dossier de sortie", kind: "path", flag: "--out" },
      { name: "recursive", label: "Sous-dossiers compris", kind: "boolean", flag: "--recursive" },
      {
        name: "inPlace",
        label: "Remplacer l'original s'il est plus gros",
        kind: "boolean",
        flag: "--in-place",
      },
      dryRun,
    ],
  },
  {
    id: "adobe-status",
    group: "nettoyage",
    title: "Mémoire prise par Adobe",
    argv: ["adobe-clean", "status"],
  },
  {
    id: "adobe-simulate",
    group: "nettoyage",
    title: "Simuler le nettoyage Adobe",
    argv: ["adobe-clean", "all"],
  },
  {
    id: "adobe-apply",
    group: "nettoyage",
    title: "Nettoyer Adobe",
    description: "Ferme l'arrière-plan Creative Cloud et vide les caches régénérables.",
    argv: ["adobe-clean", "all", "--apply"],
    confirm: {
      message:
        "Fermer l'arrière-plan Creative Cloud et vider les caches Adobe ? Tes projets ne sont pas touchés ; la première ouverture sera plus lente.",
    },
  },
  {
    id: "disk-scan",
    group: "nettoyage",
    title: "Analyser le stockage",
    argv: ["disk-clean", "scan"],
    fields: [
      { name: "root", label: "Dossier analysé (vide : ton dossier)", kind: "path", flag: "--root" },
    ],
  },
  {
    id: "disk-simulate",
    group: "nettoyage",
    title: "Simuler le nettoyage des caches",
    argv: ["disk-clean", "clean"],
    fields: [
      {
        name: "only",
        label: "Seulement ces caches (ex. chrome,temp)",
        kind: "text",
        flag: "--only",
      },
    ],
  },
  {
    id: "disk-apply",
    group: "nettoyage",
    title: "Nettoyer les caches",
    argv: ["disk-clean", "clean", "--apply"],
    fields: [
      {
        name: "only",
        label: "Seulement ces caches (ex. chrome,temp)",
        kind: "text",
        flag: "--only",
      },
    ],
    confirm: { message: "Vider les caches régénérables ? Tes documents ne sont pas touchés." },
  },
  {
    id: "disk-dupes",
    group: "nettoyage",
    title: "Chercher les doublons",
    description: "Rapport seul, rien n'est supprimé.",
    argv: ["disk-clean", "dupes"],
    fields: [
      { name: "root", label: "Dossier analysé", kind: "path", flag: "--root" },
      { name: "minSize", label: "Taille minimale (Mo)", kind: "number", flag: "--min-size" },
    ],
  },
  {
    id: "video-translate",
    group: "video",
    title: "Sous-titres anglais",
    description: "Transcrit et traduit une vidéo, un audio ou un lien.",
    argv: ["video-translate"],
    longRunning: true,
    fields: [
      { name: "input", label: "Vidéo, audio ou lien", kind: "path" },
      {
        name: "subsFrom",
        label: "Ou sous-titres à traduire (srt, vtt, ass)",
        kind: "path",
        flag: "--subs-from",
      },
      { name: "from", label: "Langue d'origine (vide : auto)", kind: "text", flag: "--from" },
      {
        name: "format",
        label: "Format",
        kind: "select",
        flag: "--format",
        options: [
          { value: "srt", label: "SRT" },
          { value: "vtt", label: "VTT" },
          { value: "ass", label: "ASS" },
        ],
      },
      { name: "context", label: "Contexte (jeu, événement)", kind: "text", flag: "--context" },
      { name: "out", label: "Fichier de sortie", kind: "path", flag: "--out" },
    ],
  },
  {
    id: "update-check",
    group: "kit",
    title: "Chercher une mise à jour",
    argv: ["self-update", "--check"],
  },
  {
    id: "update",
    group: "kit",
    title: "Mettre à jour",
    argv: ["self-update"],
    confirm: { message: "Télécharger et installer la dernière version vérifiée du kit ?" },
  },
  {
    id: "crash-report",
    group: "kit",
    title: "Rapport de plantage",
    description: "Le dernier journal d'erreur, à envoyer si quelque chose a planté.",
    argv: [],
  },
];

const publicAction = ({ argv: _argv, ...action }: CreatorAction): KitAction => action;

export function creatorCatalog(): KitCatalog {
  return {
    protocol: KIT_PROTOCOL,
    kit: "creator",
    title: "Creator Kit",
    version: VERSION,
    platform: process.platform,
    groups: CREATOR_GROUPS,
    actions: CREATOR_ACTIONS.map(publicAction),
  };
}

/** The end of the crash log (or a sentence saying there is none). */
export function crashReport(env: Record<string, string | undefined> = process.env): string[] {
  const path = crashLogPath(env);
  if (!existsSync(path)) return ["Aucun plantage enregistré."];
  const text = readFileSync(path, "utf8");
  return [`Journal : ${path}`, "", ...text.slice(-6000).trimEnd().split("\n")];
}

/** Command line of one desktop action (exported for tests). */
export function creatorArgv(actionId: string, input: KitInput): string[] {
  const action = CREATOR_ACTIONS.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`Action inconnue : ${actionId}`);
  return argvFor(action.argv, action.fields, input);
}

export const creatorBridge: KitBridge = {
  catalog: creatorCatalog,
  async run(action: KitAction, input: KitInput, channel: KitChannel): Promise<number> {
    if (action.id === "crash-report") {
      for (const text of crashReport()) channel.emit({ type: "say", text });
      return 0;
    }
    const [name, ...rest] = creatorArgv(action.id, input);
    const load = name ? registry[name] : undefined;
    if (!load) throw new Error(`Commande inconnue : ${name ?? ""}`);
    const { default: command } = await load();
    return captureConsole(channel, async () => {
      try {
        return await command.run(rest);
      } catch (error) {
        if (
          error instanceof UsageError ||
          (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
        ) {
          console.error((error as Error).message);
          return 2;
        }
        throw error;
      }
    });
  },
};

export const desktopMain = (argv: string[], channel?: KitChannel): Promise<number> =>
  runDesktop(argv, creatorBridge, channel);
