// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise real session signing against an isolated test store, never the owner's keys.
const directory = mkdtempSync(join(tmpdir(), "play-launch-"));
const previous = process.env.PLAY_SECRETS;
process.env.PLAY_SECRETS = directory;
const { guarded, issueCookie } = await import("./auth");
const { launchSteamGame } = await import("./steam");
if (previous === undefined) delete process.env.PLAY_SECRETS;
else process.env.PLAY_SECRETS = previous;
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("host launch guard rejects anonymous and foreign-origin requests before dispatch", async () => {
  let invoked = 0;
  const route = guarded(() => {
    invoked++;
    return new Response(null, { status: 202 });
  });
  const url = "https://play.aphrody.app/api/steam/454650/launch";
  const cookie = issueCookie("test-user", "mesh").split(";")[0]!;
  expect(
    (await route(new Request(url, { method: "POST" }), undefined)).status,
  ).toBe(401);
  expect(
    (
      await route(
        new Request(url, {
          method: "POST",
          headers: { cookie, origin: "https://other.example" },
        }),
        undefined,
      )
    ).status,
  ).toBe(403);
  expect(invoked).toBe(0);
  expect(
    (
      await route(
        new Request(url, {
          method: "POST",
          headers: { cookie, origin: "https://play.aphrody.app" },
        }),
        undefined,
      )
    ).status,
  ).toBe(202);
  expect(invoked).toBe(1);
});

test("launch endpoint rejects non-app identities before opening Steam", async () => {
  for (const value of ["0", "454650/../../", "454650 --arg", "4294967296"])
    expect((await launchSteamGame(value)).status).toBe(400);
});
