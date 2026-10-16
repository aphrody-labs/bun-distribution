// SPDX-License-Identifier: Apache-2.0
import type { Command } from "./types.ts";

/** Lazy registry: each module default-exports a Command. `interne` is not listed in the summaries. */
export const registry: Record<string, () => Promise<{ default: Command }>> = {
  flotte: () => import("./flotte.ts"),
  "access-pack": () => import("./access-pack.ts"),
  installer: () => import("./installer.ts"),
  verifier: () => import("./verifier.ts"),
  entrainement: () => import("./entrainement.ts"),
  acces: () => import("./acces.ts"),
  diagnostic: () => import("./diagnostic.ts"),
  guide: () => import("./guide.ts"),
  pc: () => import("./pc.ts"),
  "mise-a-jour": () => import("./mise-a-jour.ts"),
  interne: () => import("./interne.ts"),
};

export const summaries: Record<string, string> = {
  flotte: "Flotte native Windows/Python et depot GPU prive",
  "access-pack": "Préparer un fichier d’accès privé",
  installer: "Tout installer ou réparer sur ce PC",
  verifier:
    "Vérifier que tout est prêt (tunnel, SSH, MCP, A2A, GPU/CPU, disque)",
  entrainement:
    "Entraîner un modèle sur un serveur (état, démarrer, journal, arrêter)",
  acces: "Clés, fichier d'accès de l'équipe, tunnel privé",
  diagnostic: "Préparer le message d'aide à envoyer à l'équipe",
  guide: "Ouvrir le guide (1 page)",
  pc: "Mon PC et mes serveurs : état, mémoire, WSL, diagnostic, modèles",
  "mise-a-jour": "Mettre ce programme à jour",
};

/** English aliases of the French command names, for the team. */
export const aliases: Record<string, string> = {
  install: "installer",
  doctor: "verifier",
  train: "entrainement",
  access: "acces",
  diagnostic: "diagnostic",
  update: "mise-a-jour",
  "self-update": "mise-a-jour",
};
