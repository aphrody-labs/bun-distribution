// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { installedSteamGame, steamAppId, steamStreamUrl } from "./steam-target";

test("Steam deep links accept only bounded decimal app identities", () => {
  expect(steamAppId("454650")).toBe(454650);
  for (const value of [
    null,
    "",
    "0",
    "01",
    "-1",
    "1e3",
    "454650/foo",
    "454650&run=x",
    "4294967296",
  ])
    expect(steamAppId(value)).toBeNull();
  expect(steamAppId("4294967295")).toBe(4294967295);
  expect(steamStreamUrl(454650)).toBe("/stream?appId=454650");
  expect(() => steamStreamUrl(Number.NaN)).toThrow();
});

test("launch selection requires the requested app and fully installed nonempty content", () => {
  const installed = { appId: 454650, stateFlags: 4, sizeOnDisk: 23877704 };
  expect(installedSteamGame([installed], 454650)).toBe(installed);
  expect(installedSteamGame([installed], 1)).toBeUndefined();
  expect(
    installedSteamGame([{ ...installed, stateFlags: 1024 }], 454650),
  ).toBeUndefined();
  expect(
    installedSteamGame([{ ...installed, sizeOnDisk: 0 }], 454650),
  ).toBeUndefined();
});
