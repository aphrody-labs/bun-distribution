// SPDX-License-Identifier: Apache-2.0
/**
 * omar-kit inside the Aphrody desktop (route `admin` of app-ui). The panels are the console menus (`MAIN_MENU`,
 * `TRAIN_MENU`, `PC_MENU`) and each run is the same flow as the menu entry: questions become M3 dialogs (typed « OUI »
 * included), lines become the panel log. Output of tools the console hands the terminal to is captured instead.
 */
import { existsSync } from "node:fs";

import {
  ask,
  askKind,
  captureConsole,
  KIT_PROTOCOL,
  runDesktop,
  type KitAction,
  type KitBridge,
  type KitCatalog,
  type KitChannel,
  type KitGroup,
} from "../shared/desktop.ts";
import { PC_ACTIONS } from "./commands/pc.ts";
import { defaultContext, VERSION, type Context } from "./lib/context.ts";
import type { System } from "./lib/system.ts";
import { parseYesNo, type Ui } from "./lib/ui.ts";
import { MAIN_MENU, PC_MENU, TRAIN_MENU, type MenuItem } from "./menu.ts";

export const OMAR_GROUPS: KitGroup[] = [
  { id: "principal", title: "Installation et accès", icon: "admin_panel_settings" },
  { id: "entrainement", title: "Entraîner un modèle", icon: "model_training" },
  { id: "pc", title: "Mon PC et mes serveurs", icon: "computer" },
];

/** Main menu entries that open a sub-menu: in the desktop they are groups of their own. */
const SUBMENUS = new Set(["Entraîner un modèle", "Mon PC et mes serveurs"]);

interface OmarAction extends KitAction {
  item: MenuItem;
}

const actionsOf = (group: string, items: MenuItem[]): OmarAction[] =>
  items.map((item, index) => ({
    id: `${group}.${item.key}`,
    group,
    title: item.title,
    item,
    // PC_MENU lists PC_ACTIONS first, in order, then the server health entry.
    ...(group === "pc" && PC_ACTIONS[index]?.windowsOnly ? { windowsOnly: true } : {}),
  }));

function actions(): OmarAction[] {
  const main = MAIN_MENU.filter(
    (item) => ![...SUBMENUS].some((title) => item.title.startsWith(title)),
  );
  return [
    ...actionsOf("principal", main),
    ...actionsOf("entrainement", TRAIN_MENU),
    ...actionsOf("pc", PC_MENU),
  ];
}

export function omarCatalog(ctx: Pick<Context, "paths" | "sys"> = defaultContext()): KitCatalog {
  return {
    protocol: KIT_PROTOCOL,
    kit: "omar",
    title: "Aphrody - kit administrateur",
    version: VERSION,
    platform: ctx.sys.platform,
    groups: OMAR_GROUPS,
    actions: actions().map(({ item: _item, ...action }) => action),
    admin: existsSync(ctx.paths.profileFile),
  };
}

/** The console Ui, answered by the desktop's dialogs. */
export function desktopUi(channel: KitChannel): Ui {
  return {
    interactive: true,
    say: (line = "") => channel.emit({ type: "say", text: line }),
    ask(question) {
      const { kind, expect } = askKind(question);
      return ask(channel, kind, question, expect ? { expect } : {});
    },
    confirm(question, fallback = false) {
      return parseYesNo(ask(channel, "confirm", question, { fallback }), fallback);
    },
    pause() {},
  };
}

/** Tools the console lets write to the terminal are captured, then shown line by line. */
export function desktopSystem(sys: System, channel: KitChannel): System {
  return {
    ...sys,
    async run(argv, options = {}) {
      if (!options.inherit) return sys.run(argv, options);
      const result = await sys.run(argv, { ...options, inherit: false });
      for (const [text, stream] of [
        [result.stdout, "out"],
        [result.stderr, "err"],
      ] as const) {
        for (const line of text.trimEnd().split(/\r?\n/))
          if (line) channel.emit({ type: "say", text: line, stream });
      }
      return result;
    },
  };
}

export function omarBridge(base: () => Context = defaultContext): KitBridge {
  return {
    catalog: () => omarCatalog(base()),
    async run(action, _input, channel) {
      const entry = actions().find((candidate) => candidate.id === action.id);
      if (!entry) throw new Error(`Action inconnue : ${action.id}`);
      const ctx = base();
      const desktop: Context = {
        ...ctx,
        ui: desktopUi(channel),
        sys: desktopSystem(ctx.sys, channel),
      };
      return captureConsole(channel, async () => {
        const result = await entry.item.run(desktop);
        return typeof result === "number" ? result : 0;
      });
    },
  };
}

export const desktopMain = (
  argv: string[],
  channel?: KitChannel,
  base?: () => Context,
): Promise<number> => runDesktop(argv, omarBridge(base), channel);
