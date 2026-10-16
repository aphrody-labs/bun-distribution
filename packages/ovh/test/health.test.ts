// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { AphrodyOvh } from "../src/index.js";

test("OVH health never turns an API authorization failure into an authenticated empty account", async () => {
  const controller = Object.assign(Object.create(AphrodyOvh.prototype), {
    credentialsSource: "fixture-profile",
    dns: {
      listZones: async () => {
        throw new Error("HTTP 403 fixture");
      },
    },
    vps: { listVps: async () => [] },
  }) as AphrodyOvh;
  const health = await controller.checkHealth();
  expect(health.authenticated).toBe(false);
  expect(health.credentialsSource).toBe("fixture-profile");
  expect(health.error).toContain("403");
});
