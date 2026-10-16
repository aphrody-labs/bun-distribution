// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { memoryChannel, type KitEvent } from "../../src/shared/desktop.ts";
import { desktopMain, omarCatalog } from "../../src/admin/desktop.ts";
import { saveProfile } from "../../src/admin/lib/profile.ts";
import { samplePack, testContext } from "./helpers.ts";

const touch = (path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "x");
};
const said = (events: KitEvent[]) =>
  events.flatMap((event) => (event.type === "say" ? [event.text] : [])).join("\n");

test("the catalog is the console menus, sub-menus as groups, admin once the access pack is imported", async () => {
  const t = testContext();
  const catalog = omarCatalog(t.ctx);
  expect(catalog.protocol).toBe("aphrody.kit/1");
  expect(catalog.admin).toBe(false);
  expect(catalog.groups.map((group) => group.id)).toEqual(["principal", "entrainement", "pc"]);
  const titles = catalog.actions.map((action) => action.title);
  expect(titles).toContain("Tout installer ou réparer");
  expect(titles).toContain("Santé des serveurs (vps, dbfr)");
  expect(titles.some((title) => title.startsWith("Mon PC et mes serveurs"))).toBe(false);
  expect(catalog.actions.find((a) => a.id === "pc.1")?.windowsOnly).toBe(true);
  await saveProfile(t.ctx.paths, samplePack());
  expect(omarCatalog(t.ctx).admin).toBe(true);
});

test("a typed OUI question becomes a typed dialog; the answer runs the action and output is captured", async () => {
  const t = testContext();
  touch(join(t.ctx.paths.home, ".local", "bin", "aphrody.exe"));
  t.sys.handlers.push({ match: /.*/, result: { stdout: "purge ok\n" } });
  const memory = omarCatalog(t.ctx).actions.find((a) =>
    a.title.startsWith("Libérer de la mémoire"),
  );
  const channel = memoryChannel(["OUI"]);
  expect(await desktopMain(["run", memory!.id], channel, () => t.ctx)).toBe(0);
  const ask = channel.events.find((event) => event.type === "ask");
  expect(ask).toMatchObject({ type: "ask", kind: "typed", expect: "OUI" });
  expect(t.sys.calls.every((call) => call.options.inherit === false)).toBe(true);
  expect(said(channel.events)).toContain("purge ok");
  expect(channel.events.at(-1)).toEqual({ type: "done", code: 0 });
});

test("a cancelled dialog changes nothing", async () => {
  const t = testContext();
  touch(join(t.ctx.paths.home, ".local", "bin", "aphrody.exe"));
  t.sys.handlers.push({ match: /.*/, result: {} });
  const memory = omarCatalog(t.ctx).actions.find((a) =>
    a.title.startsWith("Libérer de la mémoire"),
  );
  const channel = memoryChannel([null]);
  await desktopMain(["run", memory!.id], channel, () => t.ctx);
  expect(t.sys.calls).toEqual([]);
  expect(said(channel.events)).toContain("Annulé");
});

test("unknown actions and verbs end with an error then done", async () => {
  const t = testContext();
  const channel = memoryChannel();
  expect(await desktopMain(["run", "nope"], channel, () => t.ctx)).toBe(2);
  expect(channel.events.map((event) => event.type)).toEqual(["error", "done"]);
  const catalog = memoryChannel();
  expect(await desktopMain(["catalog"], catalog, () => t.ctx)).toBe(0);
  expect(catalog.events[0]?.type).toBe("catalog");
});
