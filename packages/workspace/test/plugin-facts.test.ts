// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkPluginFacts } from "../src/plugin-facts.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => $`rm -rf ${root}`.quiet()));
});

test("relative evidence roots resolve inside the plugin, independent of the working directory", async () => {
  const store = join(tmpdir(), `plugin-facts-${crypto.randomUUID()}`);
  roots.push(store);
  await Bun.write(
    `${store}/demo/plugin.json`,
    '{"name":"demo","version":"1.0.0","description":"d"}\n',
  );
  await Bun.write(`${store}/demo/references/upstream-main.json`, "{}\n");
  await Bun.write(
    `${store}/demo/skills/a/SKILL.md`,
    "---\nname: a\ndescription: d\n---\n",
  );
  await Bun.write(
    `${store}/demo/source-of-truth.json`,
    JSON.stringify({
      version: 1,
      sources: [{ root: ".", evidence: ["references/upstream-main.json"] }],
      knowledge: ["skills/a/SKILL.md"],
    }),
  );
  const [record] = checkPluginFacts(store);
  expect(record!.status).toBe("stale");
  expect(Object.keys(record!.receipt!.inputs)).toContain(
    `${resolve(store, "demo")}:references/upstream-main.json`,
  );
});
