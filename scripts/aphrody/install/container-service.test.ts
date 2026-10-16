// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeUp, ensureToken, tokenPath } from "./container-service.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "container-service-"));
  dirs.push(dir);
  return dir;
};

test("the token is generated once under ~/.aphrody/private with a restricted ACL", async () => {
  const h = home();
  const restricted: string[] = [];
  const acl = async (path: string) => {
    restricted.push(path);
  };
  const first = await ensureToken(h, acl);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(await ensureToken(h, acl)).toBe(first);
  expect(restricted).toEqual([tokenPath(h)]);
  expect(tokenPath(h)).toBe(
    join(h, ".aphrody", "private", "aphrody_mcp_http_token"),
  );
});

test("a token of the former runner is moved, keeping its value", async () => {
  const h = home();
  const legacy = join(h, ".aphrodyprivate");
  mkdirSync(legacy);
  writeFileSync(join(legacy, "aphrody_mcp_http_token"), `${"ab".repeat(32)}\n`);
  expect(await ensureToken(h, async () => {})).toBe("ab".repeat(32));
  expect(existsSync(legacy)).toBe(false);
  expect(readFileSync(tokenPath(h), "utf8").trim()).toBe("ab".repeat(32));
});

test("a malformed token file is refused", async () => {
  const h = home();
  mkdirSync(join(h, ".aphrody", "private"), { recursive: true });
  writeFileSync(tokenPath(h), "not a token");
  await expect(ensureToken(h, async () => {})).rejects.toThrow("hex token");
});

test("only the pc service is started, from the loaded image", () => {
  expect(composeUp("C:\\r\\compose.yaml")).toEqual([
    "docker",
    "compose",
    "-f",
    "C:\\r\\compose.yaml",
    "--profile",
    "pc",
    "up",
    "-d",
    "--no-build",
    "pc",
  ]);
});
