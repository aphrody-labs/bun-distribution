import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operationsContext } from "./aphrody-context";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "iecode-operations-"));
  temporary.push(directory);
  const root = join(directory, "iecode");
  const shared = join(directory, "aphrody");
  mkdirSync(root);
  mkdirSync(join(shared, "packages/bun-workspace/src/automation"), { recursive: true });
  writeFileSync(
    join(root, "workspace.manifest.json"),
    JSON.stringify({
      operations: {
        source: "../aphrody/packages/bun-workspace",
        authority: "@aphrody/bun-workspace",
      },
    }),
  );
  writeFileSync(join(shared, "packages/bun-workspace/package.json"), '{"name":"@aphrody/bun-workspace"}');
  writeFileSync(join(shared, "packages/bun-workspace/src/automation/ops.ts"), "");
  return { root, shared, directory };
}
test("uses the declared sibling independently of the caller working directory", () => {
  const { root, shared } = fixture();
  expect(operationsContext(root, {}).operationsRoot).toBe(shared);
  expect(operationsContext(root, { APHRODY_ROOT: "../aphrody" }).operationsRoot).toBe(shared);
});
test("an invalid explicit checkout cannot silently fall back to another owner", () => {
  const { root } = fixture();
  expect(() => operationsContext(root, { APHRODY_ROOT: "../missing" })).toThrow("does not exist");
});
test("rejects conflicting aliases while allowing two names for the same checkout", () => {
  const { root, shared, directory } = fixture();
  mkdirSync(join(directory, "other"));
  expect(() =>
    operationsContext(root, {
      APHRODY_ROOT: shared,
      APHRODY_INFRA_ROOT: join(directory, "other"),
    }),
  ).toThrow("different checkouts");
  symlinkSync(shared, join(directory, "alias"));
  expect(
    operationsContext(root, {
      APHRODY_ROOT: shared,
      APHRODY_INFRA_ROOT: join(directory, "alias"),
    }).operationsRoot,
  ).toBe(shared);
});
test("checks the selected package identity before executing its code", () => {
  const { root, shared } = fixture();
  writeFileSync(join(shared, "packages/bun-workspace/package.json"), '{"name":"foreign-owner"}');
  expect(() => operationsContext(root, {})).toThrow("Unexpected operations owner");
});

test("installed registry operations work without a sibling and explicit checkouts retain precedence", () => {
  const { root, shared } = fixture();
  const installed = join(root, "node_modules/@aphrody/bun-workspace");
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    join(installed, "package.json"),
    JSON.stringify({ name: "@aphrody/bun-workspace", exports: { "./automation/ops.ts": "./ops.ts" } }),
  );
  writeFileSync(join(installed, "ops.ts"), "");
  expect(operationsContext(root, {}).entry).toBe(join(installed, "ops.ts"));
  expect(operationsContext(root, {}).operationsRoot).toBeUndefined();
  expect(operationsContext(root, { APHRODY_ROOT: shared }).operationsRoot).toBe(shared);
  rmSync(shared, { recursive: true, force: true });
  expect(operationsContext(root, {}).entry).toBe(join(installed, "ops.ts"));
  writeFileSync(
    join(installed, "package.json"),
    JSON.stringify({ name: "foreign-owner", exports: { "./automation/ops.ts": "./ops.ts" } }),
  );
  expect(() => operationsContext(root, {})).toThrow("Unexpected operations owner");
});
