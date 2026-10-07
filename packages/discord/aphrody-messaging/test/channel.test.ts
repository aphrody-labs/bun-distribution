// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { DiscordChannel } from "../src/index.ts";
import { DiscordChannel as CanonicalChannel } from "@aphrody/discord-kit/messaging";
test("legacy package exposes the canonical Discord implementation", () => {
  expect(DiscordChannel).toBe(CanonicalChannel);
});
