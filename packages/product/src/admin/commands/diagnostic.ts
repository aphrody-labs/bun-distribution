// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { crashLogPath } from "../../shared/crash.ts";
import type { Context } from "../lib/context.ts";
import { renderReport, runDoctor } from "../lib/doctor.ts";
import { redact } from "../lib/log.ts";
import { omarApp } from "../lib/update.ts";
import { copyToClipboard } from "../lib/steps.ts";
import type { Command } from "./types.ts";

async function tail(path: string, lines: number): Promise<string> {
  if (!existsSync(path)) return "(aucun)";
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).slice(-lines).join("\n").trim() || "(vide)";
}

/** The text Omar pastes to the team when something blocks: versions, the doctor result and the last log lines, no secret. */
export async function buildDiagnostic(ctx: Context): Promise<string> {
  const report = await runDoctor(ctx);
  const sections = [
    "Aphrody Omar : message d'aide pour l'équipe (aucun secret dans ce texte)",
    `date: ${ctx.sys.now().toISOString()}`,
    `kit: ${ctx.version}`,
    `système: ${ctx.sys.platform} ${process.arch}`,
    "",
    "== Vérification ==",
    ...renderReport(report),
    "",
    "== Dernières lignes du journal ==",
    await tail(ctx.paths.logFile, 80),
    "",
    "== Dernières erreurs du programme ==",
    await tail(crashLogPath(ctx.sys.env, omarApp(ctx.version)), 30),
    "",
  ];
  return redact(sections.join("\n"));
}

const command: Command = {
  name: "diagnostic",
  summary: "Préparer le message d'aide à envoyer à l'équipe",
  async run(_argv, ctx) {
    ctx.ui.say(
      "Préparation du message pour l'équipe (ça prend quelques secondes)...",
    );
    const text = await buildDiagnostic(ctx);
    const file = join(ctx.paths.desktopDir, "message-pour-l-equipe.txt");
    await mkdir(ctx.paths.desktopDir, { recursive: true });
    await writeFile(file, text);
    const copied = await copyToClipboard(ctx, text);
    ctx.ui.say(`C'est prêt : ${file}`);
    ctx.ui.say(
      copied
        ? "Le texte est aussi dans le presse-papiers : colle-le (Ctrl+V) dans ta conversation avec l'équipe."
        : "Envoie ce fichier à l'équipe.",
    );
    ctx.ui.say("Il ne contient ni mot de passe ni clé privée.");
    return 0;
  },
};

export default command;
