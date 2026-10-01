// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";

test("native adapters preserve Shenron doctor routing and sanitized auth presence", () => {
  const adapter = join(import.meta.dir, "../../src/aphrody/native.ts");
  const child = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    let status = {configured: true, admin_credentials_present: false};
    let args;
    mock.module("@aphrody/bun/shenron", () => ({
      EXPECTED_SHENRON_ABI_VERSION: 1,
      shenronAbiVersion: () => 1,
      shenronVersion: () => "fixture",
      shenronRunCaptured: (received) => {
        args = received;
        return {code: 0, stdout: JSON.stringify({pillar: "shenron_sovereign_bridge", status: "degraded"}), stderr: ""};
      },
      shenronRagSearch: () => [], shenronRagStats: () => null,
      shenronPersonaPrompt: () => "fixture",
      shenronAuthStatus: () => ({code: 0, stdout: JSON.stringify(status), stderr: ""}),
    }));
    const {aphrodyNative} = await import(${JSON.stringify(adapter)});
    assert.deepEqual(await aphrodyNative.doctor(), {pillar: "shenron_sovereign_bridge", status: "degraded"});
    assert.deepEqual(args, ["shenron", "doctor", "--json"]);
    for (const configured of [false, true]) for (const present of [false, true]) {
      status = {configured, admin_credentials_present: present, secret: "must not project"};
      assert.deepEqual(aphrodyNative.authStatus(), {configured, adminCredentialsPresent: present});
    }
    status = {admin_token_configured: true, ai_token_configured: true};
    assert.equal(aphrodyNative.authStatus(), null);
    status = {configured: true, admin_credentials_present: "true"};
    assert.equal(aphrodyNative.authStatus(), null);
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  expect(child.exitCode).toBe(0);
});
