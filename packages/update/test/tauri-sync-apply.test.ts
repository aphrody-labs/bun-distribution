import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { schemaTag, schemaUrl } from "../src/tauri/apps.ts";
import {
  applyReport,
  parseConfig,
  summarize,
  type Row,
} from "../src/tauri/sync.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function put(root: string, file: string, text: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

const behind: Row = {
  kind: "crate",
  name: "tauri",
  current: "3.0.0-alpha.3",
  latest: "3.0.0-alpha.4",
  target: "3.0.0-alpha.4",
  status: "behind",
};

async function fixture(gate: string[]) {
  const root = await mkdtemp(join(tmpdir(), "tauri-sync-apply-"));
  dirs.push(root);
  await put(
    root,
    "Cargo.toml",
    `[workspace.dependencies]\ntauri = { version = "=3.0.0-alpha.3" }\n`,
  );
  await put(
    root,
    "package.json",
    JSON.stringify({ workspaces: { catalog: {} } }),
  );
  await put(
    root,
    "app/tauri.conf.json",
    `{\n  "$schema": "${schemaUrl("3.0.0-alpha.3")}"\n}\n`,
  );
  await put(
    root,
    "tools/config/tauri-apps.json",
    JSON.stringify({
      schemaVersion: 1,
      projects: [
        { id: "app", kind: "app", path: "app", confs: ["tauri.conf.json"] },
      ],
    }),
  );
  const configText = JSON.stringify({
    schemaVersion: 1,
    line: 3,
    upstream: {},
    policy: { npmMinimumReleaseAgeSeconds: 0 },
    rust: { crates: ["tauri"], forks: [] },
    js: {
      catalog: [],
      cli: { package: "@tauri-apps/cli", version: "3.0.0-alpha.3" },
    },
    gate: { bun: gate },
    patches: [],
  });
  await put(root, "tools/config/tauri-upstream.json", configText);
  return { root, config: parseConfig(configText) };
}

test("apply bumps the central pin and every first-party $schema tag", async () => {
  const { root, config } = await fixture([]);
  expect(await applyReport(root, config, summarize([behind], [], []))).toBe(0);
  expect(await readFile(join(root, "Cargo.toml"), "utf8")).toContain(
    'version = "=3.0.0-alpha.4"',
  );
  expect(
    schemaTag(await readFile(join(root, "app/tauri.conf.json"), "utf8")),
  ).toBe("3.0.0-alpha.4");
});

test("a failing gate reverts the pin and the config schema tags", async () => {
  const { root, config } = await fixture(["bun -e process.exit(1)"]);
  expect(await applyReport(root, config, summarize([behind], [], []))).toBe(1);
  expect(await readFile(join(root, "Cargo.toml"), "utf8")).toContain(
    'version = "=3.0.0-alpha.3"',
  );
  expect(
    schemaTag(await readFile(join(root, "app/tauri.conf.json"), "utf8")),
  ).toBe("3.0.0-alpha.3");
});

test("schema drift alone is applied without a version bump", async () => {
  const { root, config } = await fixture([]);
  await put(
    root,
    "app/tauri.conf.json",
    `{\n  "$schema": "${schemaUrl("3.0.0-alpha.2")}"\n}\n`,
  );
  const ok: Row = {
    ...behind,
    status: "ok",
    target: null,
    latest: "3.0.0-alpha.3",
  };
  const drift = [
    {
      file: "app/tauri.conf.json",
      key: "$schema",
      name: "tauri",
      mirror: "3.0.0-alpha.2",
      expected: "3.0.0-alpha.3",
    },
  ];
  expect(await applyReport(root, config, summarize([ok], [], [], drift))).toBe(
    0,
  );
  expect(
    schemaTag(await readFile(join(root, "app/tauri.conf.json"), "utf8")),
  ).toBe("3.0.0-alpha.3");
});
