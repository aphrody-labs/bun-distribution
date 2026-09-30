// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncManifest, syncXaiPackage } from "../src/ecosystem-deps.ts";

const root = mkdtempSync(join(tmpdir(), "aphrody-ecosystem-"));
const roots = {
  ai: join(root, "ai"),
  os: join(root, "os"),
  infra: join(root, "infra"),
  web: join(root, "web"),
};
for (const name of Object.values(roots)) {
  mkdirSync(name, { recursive: true });
  writeFileSync(join(name, "Cargo.toml"), "[workspace]\n");
}
for (const path of [
  join(roots.ai, "crates", "aphrody-gemini-web"),
  join(roots.infra, "crates", "aphrody-ssh"),
]) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "Cargo.toml"), "[package]\n");
}
mkdirSync(join(roots.web, "packages", "x"), { recursive: true });
writeFileSync(
  join(roots.web, "packages", "x", "package.json"),
  '{"name":"@aphrody/x","version":"1.3.0"}',
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("redirects a migrated AI crate and retains infra ownership", () => {
  const source =
    '[workspace.dependencies]\naphrody-gemini-web = { path = "crates/aphrody-gemini-web" }\naphrody-ssh = { path = "../aphrody-infra/crates/aphrody-ssh", version = "0.1.0" }\n';
  const result = syncManifest(source, "os", roots);
  expect(result.missing).toEqual([]);
  expect(result.text).toContain(
    'aphrody-gemini-web = { path = "../ai/crates/aphrody-gemini-web" }',
  );
  expect(result.text).toContain('aphrody-ssh = { path = "../infra/crates/aphrody-ssh"');
});

test("reports absent targets without editing the dependency", () => {
  const source = 'aphrody-embed = { path = "crates/aphrody-embed" }';
  const result = syncManifest(source, "os", roots);
  expect(result.text).toBe(source);
  expect(result.missing).toHaveLength(1);
});

test("switches the xAI package's @aphrody/x dependency between the web checkout and the registry", () => {
  const source = '{"name":"@aphrody/xai","dependencies":{"@aphrody/x":"1.3.0"}}';
  const local = syncXaiPackage(source, roots, false);
  expect(local.text).toContain('"@aphrody/x":"file:../../../web/packages/x"');
  expect(local.change).toBe("@aphrody/x: 1.3.0 -> file:../../../web/packages/x");
  const registry = syncXaiPackage(local.text, roots, true);
  expect(registry.text).toBe(source);
  expect(syncXaiPackage(registry.text, roots, true).change).toBeUndefined();
});
