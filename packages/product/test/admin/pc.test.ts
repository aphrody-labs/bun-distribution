// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PC_ACTIONS, runPcAction, serverStatus } from "../../src/admin/commands/pc.ts";
import { saveProfile } from "../../src/admin/lib/profile.ts";
import { samplePack, testContext } from "./helpers.ts";

const touch = (path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "x");
};
const withTools = (t: ReturnType<typeof testContext>) => {
  touch(join(t.ctx.paths.home, ".local", "bin", "aphrody.exe"));
  t.sys.handlers.push({ match: /.*/, result: {} });
};

test("every action maps to a fixed aphrody argv, never a shell string", () => {
  const all = PC_ACTIONS.flatMap(action => action.commands.map(c => `${c.tool} ${c.args.join(" ")}`));
  expect(all).toContain("aphrody winclean call get_disk_info");
  expect(all).toContain("aphrody winclean call wsl_list_distributions");
  expect(all.join(" ")).not.toContain("yolo");
  expect(all.join(" ")).not.toMatch(/wsl_execute|wsl_send_signal|kill|rm |delete|--apply/i);
});

test("a status action runs its commands on the PC", async () => {
  const t = testContext();
  withTools(t);
  expect(await runPcAction(t.ctx, "etat")).toBe(0);
  expect(t.sys.calls).toHaveLength(5);
  expect(t.sys.calls[0]!.argv.slice(1)).toEqual(["winclean", "call", "get_os_info"]);
  expect(t.sys.calls[0]!.options.inherit).toBe(true);
});

test("memory trimming needs a typed OUI, and says nothing is deleted", async () => {
  const no = testContext({ answers: ["non"] });
  withTools(no);
  expect(await runPcAction(no.ctx, "memoire")).toBe(0);
  expect(no.sys.calls).toEqual([]);
  expect(no.ui.lines.join("\n")).toContain("Aucun fichier n'est touché");
  const yes = testContext({ answers: ["OUI"] });
  withTools(yes);
  expect(await runPcAction(yes.ctx, "memoire")).toBe(0);
  expect(yes.sys.calls.map(c => c.argv.at(-1))).toEqual(["perf_purge_standby_list", "perf_empty_working_sets"]);
  const batch = testContext({ interactive: false });
  withTools(batch);
  await runPcAction(batch.ctx, "memoire");
  expect(batch.sys.calls).toEqual([]);
});

test("missing tools and non-Windows hosts are explained", async () => {
  const t = testContext();
  expect(await runPcAction(t.ctx, "diagnostic")).toBe(1);
  expect(t.ui.lines.join("\n")).toContain("pas installé");
  const linux = testContext({ platform: "linux" });
  expect(await runPcAction(linux.ctx, "etat")).toBe(1);
  expect(await runPcAction(t.ctx, "nope")).toBe(2);
});

test("server health goes through aphrody infra ssh for vps and dbfr only", async () => {
  const t = testContext();
  withTools(t);
  await saveProfile(
    t.ctx.paths,
    samplePack({
      hosts: {
        vps: { address: "198.51.100.1" },
        other: { address: "198.51.100.2" },
      },
      trainHost: undefined,
    }),
  );
  expect(await serverStatus(t.ctx)).toBe(0);
  expect(t.sys.calls.map(c => c.argv.slice(1))).toEqual([["infra", "ssh", "status", "--host", "vps"]]);
});
