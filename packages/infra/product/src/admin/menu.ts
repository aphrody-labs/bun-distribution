// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
/** The menu shown on double click: numbers, plain French, one screen. */
import type { Context } from "./lib/context.ts";
import { registry } from "./commands/index.ts";
import { pickJob, stopFlow, wizard } from "./commands/entrainement.ts";
import { PC_ACTIONS, runPcAction, serverStatus } from "./commands/pc.ts";
import { resolveActive } from "./menu-host.ts";

export interface MenuItem {
  key: string;
  title: string;
  run(ctx: Context): Promise<unknown>;
}

async function runCommand(ctx: Context, name: string, argv: string[] = []): Promise<number> {
  const loader = registry[name];
  if (!loader) return 2;
  const { default: command } = await loader();
  return command.run(argv, ctx);
}

export const MAIN_MENU: MenuItem[] = [
  { key: "1", title: "Tout installer ou réparer", run: (ctx) => runCommand(ctx, "installer") },
  { key: "2", title: "Vérifier que tout est prêt", run: (ctx) => runCommand(ctx, "verifier") },
  { key: "3", title: "Entraîner un modèle", run: (ctx) => trainingMenu(ctx) },
  {
    key: "4",
    title: "Envoyer mes clés à l'équipe (première fois)",
    run: (ctx) => runCommand(ctx, "acces", ["cles"]),
  },
  {
    key: "5",
    title: "Préparer le message d'aide pour l'équipe",
    run: (ctx) => runCommand(ctx, "diagnostic"),
  },
  { key: "6", title: "Ouvrir le guide", run: (ctx) => runCommand(ctx, "guide") },
  {
    key: "7",
    title: "Mon PC et mes serveurs (état, mémoire, WSL, diagnostic)",
    run: (ctx) => pcMenu(ctx),
  },
  { key: "8", title: "Mettre ce programme à jour", run: (ctx) => runCommand(ctx, "mise-a-jour") },
];

export const TRAIN_MENU: MenuItem[] = [
  {
    key: "1",
    title: "Voir l'état des entraînements",
    run: (ctx) => runCommand(ctx, "entrainement", ["etat"]),
  },
  {
    key: "2",
    title: "Lancer un entraînement (simulation puis confirmation)",
    run: (ctx) => wizard(ctx),
  },
  {
    key: "3",
    title: "Lire le journal du dernier entraînement",
    run: (ctx) => runCommand(ctx, "entrainement", ["journal"]),
  },
  {
    key: "4",
    title: "Arrêter un entraînement en cours",
    async run(ctx) {
      const host = await resolveActive(ctx);
      if (!host) return 1;
      const id = await pickJob(ctx, host, "en-cours");
      return id ? stopFlow(ctx, host, id, { force: false, oui: false }) : 0;
    },
  },
];

export const PC_MENU: MenuItem[] = [
  ...PC_ACTIONS.map((action, index) => ({
    key: String(index + 1),
    title: action.titre,
    run: (ctx: Context) => runPcAction(ctx, action.key),
  })),
  {
    key: String(PC_ACTIONS.length + 1),
    title: "Santé des serveurs (vps, dbfr)",
    run: (ctx: Context) => serverStatus(ctx),
  },
];

export function renderMenu(title: string, items: MenuItem[], quitLabel: string): string[] {
  return [
    "",
    "==============================================",
    `  ${title}`,
    "==============================================",
    ...items.map((item) => `  ${item.key}. ${item.title}`),
    `  0. ${quitLabel}`,
  ];
}

/** One screen: show the items, read a number, run it, wait for Enter. Returns when the person chooses 0 or the window closes. */
async function loop(
  ctx: Context,
  title: string,
  items: MenuItem[],
  quitLabel: string,
): Promise<void> {
  for (;;) {
    for (const line of renderMenu(title, items, quitLabel)) ctx.ui.say(line);
    const answer = ctx.ui.ask("\nTon choix (un numéro)");
    if (answer === null) return;
    const choice = answer.trim();
    if (choice === "0" || /^(q|quit|exit|quitter)$/i.test(choice)) return;
    const item = items.find((entry) => entry.key === choice);
    if (!item) {
      ctx.ui.say("Je n'ai pas compris : tape un des numéros de la liste.");
      continue;
    }
    ctx.ui.say();
    try {
      await item.run(ctx);
    } catch (error) {
      ctx.log(`erreur dans « ${item.title} » : ${(error as Error).message}`);
      ctx.ui.say(`Un problème est survenu : ${(error as Error).message}`);
      ctx.ui.say("Choisis « Préparer le message d'aide pour l'équipe » si ça se reproduit.");
    }
    ctx.ui.pause("\nAppuie sur Entrée pour revenir au menu...");
  }
}

export async function trainingMenu(ctx: Context): Promise<void> {
  await loop(ctx, "Entraîner un modèle", TRAIN_MENU, "Retour");
}

export async function pcMenu(ctx: Context): Promise<void> {
  await loop(ctx, "Mon PC et mes serveurs", PC_MENU, "Retour");
}

export async function mainMenu(ctx: Context): Promise<void> {
  await loop(ctx, `Aphrody - kit administrateur (version ${ctx.version})`, MAIN_MENU, "Quitter");
}
