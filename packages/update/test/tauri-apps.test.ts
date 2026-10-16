import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  audit,
  confSchemaDrift,
  discover,
  fixConfSchemas,
  gateFromRegistry,
  npmTauriDeps,
  owner,
  parseArgs,
  parseRegistry,
  pinnedTauriVersion,
  rewriteSchemaTag,
  schemaTag,
  schemaUrl,
  tauriCargoDeps,
  workspaceState,
} from "../src/tauri/apps.ts";

const rootCargo = `[workspace]
members = ["crates/ui/*", "crates/koharu/*"]
exclude = ["crates/os/kernel/comps/drive"]

[workspace.dependencies]
tauri = { version = "=3.0.0-alpha.3", default-features = false }
tauri-build = "=3.0.0-alpha.2"
`;

const registryJson = JSON.stringify({
  schemaVersion: 1,
  scanSkip: ["target", "node_modules", ".git"],
  projects: [
    {
      id: "app",
      kind: "app",
      path: "crates/ui/app",
      package: "aphrody-app",
      workspace: "member",
      confs: ["tauri.conf.json"],
      gate: true,
      generated: ["crates/ui/app/gen"],
    },
    {
      id: "drive",
      kind: "plugin",
      path: "crates/os/kernel/comps/drive",
      package: "aphrody-os-drive",
      workspace: "excluded",
    },
    { id: "fixtures", kind: "upstream", path: "upstream/fx", workspace: "upstream", subtree: true },
  ],
});

test("parseRegistry rejects unsupported versions, incomplete and duplicate projects", () => {
  expect(() => parseRegistry(JSON.stringify({ schemaVersion: 2, projects: [] }))).toThrow(
    "schemaVersion",
  );
  expect(() => parseRegistry(JSON.stringify({ schemaVersion: 1 }))).toThrow("projects");
  expect(() =>
    parseRegistry(JSON.stringify({ schemaVersion: 1, projects: [{ id: "a" }] })),
  ).toThrow("incomplete");
  const dup = { id: "a", kind: "app", path: "x" };
  expect(() => parseRegistry(JSON.stringify({ schemaVersion: 1, projects: [dup, dup] }))).toThrow(
    "duplicate",
  );
});

test("the gate is derived from gated registry projects", () => {
  expect(gateFromRegistry(parseRegistry(registryJson))).toEqual({
    cargoPackages: ["aphrody-app"],
    generatedPaths: ["crates/ui/app/gen"],
  });
});

test("tauriCargoDeps tells inherited workspace deps from pinned ones", () => {
  const manifest = `[package]
name = "x"
[build-dependencies]
tauri-build = { workspace = true }
[dependencies]
tauri = { workspace = true, features = ["tray-icon"] }
tauri-plugin-os.workspace = true
tauri-plugin-log = "2"
serde = "1"
[target.'cfg(windows)'.dependencies]
tauri-runtime-wry = { version = "3" }
[dependencies.tauri-plugin-fs]
version = "3"
`;
  expect(tauriCargoDeps(manifest)).toEqual([
    { name: "tauri-build", inherited: true },
    { name: "tauri", inherited: true },
    { name: "tauri-plugin-os", inherited: true },
    { name: "tauri-plugin-log", inherited: false },
    { name: "tauri-runtime-wry", inherited: false },
    { name: "tauri-plugin-fs", inherited: false },
  ]);
  expect(tauriCargoDeps(`[package]\nname = "tauri-mcp"\n[dependencies]\nserde = "1"\n`)).toEqual(
    [],
  );
});

test("npmTauriDeps ignores peer ranges and unrelated packages", () => {
  const manifest = JSON.stringify({
    dependencies: { "@tauri-apps/api": "catalog:", react: "19" },
    devDependencies: { "@tauri-apps/cli": "^3.0.0", "tauri-plugin-foo-api": "1" },
    peerDependencies: { "@tauri-apps/api": ">=3" },
  });
  expect(npmTauriDeps(manifest)).toEqual([
    { name: "@tauri-apps/api", version: "catalog:" },
    { name: "@tauri-apps/cli", version: "^3.0.0" },
    { name: "tauri-plugin-foo-api", version: "1" },
  ]);
});

test("workspaceState follows members, excludes and the upstream tree", () => {
  expect(workspaceState(rootCargo, "crates/ui/app")).toBe("member");
  expect(workspaceState(rootCargo, "crates/os/kernel/comps/drive")).toBe("excluded");
  expect(workspaceState(rootCargo, "upstream/victauri/crates/x")).toBe("upstream");
  expect(workspaceState(rootCargo, "packages/koharu/ui")).toBe("outside");
  // members globs match one path segment only
  expect(workspaceState(rootCargo, "crates/ui/app/nested")).toBe("outside");
});

test("owner matches exact paths and anything below a subtree", () => {
  const registry = parseRegistry(registryJson);
  expect(owner(registry, "crates/ui/app")?.id).toBe("app");
  expect(owner(registry, "crates/ui/app/src-tauri")).toBeUndefined();
  expect(owner(registry, "upstream/fx/examples/demo/src-tauri")?.id).toBe("fixtures");
  expect(owner(registry, "upstream/fxother")).toBeUndefined();
});

test("schema tag helpers read and rewrite only the tag", () => {
  const conf = `{\n  "$schema": "${schemaUrl("3.0.0-alpha.2")}",\n  "identifier": "x"\n}`;
  expect(schemaTag(conf)).toBe("3.0.0-alpha.2");
  const next = rewriteSchemaTag(conf, "3.0.0-alpha.3");
  expect(schemaTag(next)).toBe("3.0.0-alpha.3");
  expect(next).toContain('"identifier": "x"');
  expect(schemaTag('{"$schema":"https://schema.tauri.app/config/2"}')).toBeNull();
  expect(pinnedTauriVersion(rootCargo)).toBe("3.0.0-alpha.3");
  expect(pinnedTauriVersion(`[workspace.dependencies]\ntauri = "=3.0.0-alpha.4"\n`)).toBe(
    "3.0.0-alpha.4",
  );
});

test("parseArgs validates flags", () => {
  expect(parseArgs(["--check", "--json"], "/r")).toEqual({
    root: "/r",
    check: true,
    fix: false,
    json: true,
  });
  expect(() => parseArgs(["--fix", "--check"], "/r")).toThrow("mutually exclusive");
  expect(() => parseArgs(["--nope"], "/r")).toThrow("Unknown argument");
});

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function put(root: string, file: string, text: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

async function fixtureTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tauri-apps-"));
  dirs.push(root);
  await put(root, "Cargo.toml", rootCargo);
  await put(root, "tools/config/tauri-apps.json", registryJson);
  const stale = `{\n  "$schema": "${schemaUrl("3.0.0-alpha.2")}",\n  "build": { "frontendDist": "dist", "beforeBuildCommand": "bun --cwd ../aphrody-ui run build" }\n}\n`;
  await put(root, "crates/ui/app/tauri.conf.json", stale);
  await put(
    root,
    "crates/ui/app/Cargo.toml",
    `[dependencies]\ntauri = { workspace = true }\ntauri-plugin-log = "3"\n`,
  );
  await put(
    root,
    "crates/ui/app/package.json",
    JSON.stringify({ dependencies: { "@tauri-apps/api": "^3.0.0" } }),
  );
  // workspace-excluded and git-ignored-looking paths must still be found; target/node_modules must not
  await put(root, "crates/os/kernel/comps/drive/Cargo.toml", `[dependencies]\ntauri = { workspace = true }\n`);
  await put(root, "upstream/fx/examples/demo/src-tauri/tauri.conf.json", "{}");
  await put(root, "crates/ui/stray/Tauri.toml", "");
  await put(root, "crates/ui/app/target/debug/Cargo.toml", `[dependencies]\ntauri = "3"\n`);
  await put(
    root,
    "node_modules/x/package.json",
    JSON.stringify({ dependencies: { "@tauri-apps/api": "3" } }),
  );
  return root;
}

test("discover scans excluded paths and skips target and node_modules", async () => {
  const root = await fixtureTree();
  const found = await discover(root, ["target", "node_modules", ".git"]);
  expect(found.map((item) => item.dir)).toEqual([
    "crates/os/kernel/comps/drive",
    "crates/ui/app",
    "crates/ui/stray",
    "upstream/fx/examples/demo/src-tauri",
  ]);
  expect(found.find((item) => item.dir === "crates/ui/app")?.via.toSorted()).toEqual([
    "cargo",
    "conf",
    "npm",
  ]);
});

test("audit reports unregistered projects, pinned deps, schema drift and legacy sibling refs", async () => {
  const root = await fixtureTree();
  const report = await audit(root, parseRegistry(registryJson));
  const codes = report.violations.map((item) => `${item.code}:${item.subject}`).toSorted();
  expect(codes).toEqual([
    "legacy-sibling:crates/ui/app/tauri.conf.json",
    "pinned-crate:app",
    "pinned-npm:app",
    "schema-drift:crates/ui/app/tauri.conf.json",
    "unregistered:crates/ui/stray",
  ]);
  expect(report.rows.find((row) => row.dir === "crates/os/kernel/comps/drive")).toMatchObject({
    id: "drive",
    workspace: "excluded",
  });
  expect(report.rows.find((row) => row.dir === "upstream/fx/examples/demo/src-tauri")?.id).toBe(
    "fixtures",
  );
  expect(report.warnings.map((item) => item.code)).toEqual(["frontend-missing"]);
});

test("audit flags a missing registry path and a workspace mismatch", async () => {
  const root = await fixtureTree();
  const registry = parseRegistry(
    JSON.stringify({
      schemaVersion: 1,
      projects: [
        { id: "ghost", kind: "app", path: "crates/ui/ghost" },
        { id: "drive", kind: "plugin", path: "crates/os/kernel/comps/drive", package: "p", workspace: "member" },
      ],
    }),
  );
  const codes = (await audit(root, registry)).violations.map((item) => item.code);
  expect(codes).toContain("missing");
  expect(codes).toContain("workspace-mismatch");
});

test("fixConfSchemas rewrites only drifted first-party configs", async () => {
  const root = await fixtureTree();
  const registry = parseRegistry(registryJson);
  expect(await confSchemaDrift(root, registry, "3.0.0-alpha.3")).toEqual([
    { file: "crates/ui/app/tauri.conf.json", tag: "3.0.0-alpha.2" },
  ]);
  expect(await fixConfSchemas(root, registry, "3.0.0-alpha.3")).toEqual([
    "crates/ui/app/tauri.conf.json",
  ]);
  expect(await fixConfSchemas(root, registry, "3.0.0-alpha.3")).toEqual([]);
  const text = await readFile(join(root, "crates/ui/app/tauri.conf.json"), "utf8");
  expect(schemaTag(text)).toBe("3.0.0-alpha.3");
  expect(text).toContain("beforeBuildCommand");
});
