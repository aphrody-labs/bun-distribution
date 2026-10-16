// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createLogger, redact } from "../../src/admin/lib/log.ts";
import { testContext } from "./helpers.ts";

test("redact masks keys, tokens and credentials in URLs", () => {
  const text = [
    "PrivateKey = cNDOxEMQ7rC2DPNdG67aB2XDs8B9mL5jIX3MCHMruEw=",
    "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
    "Authorization: Bearer abc.def.ghi",
    "git clone https://user:secret@github.com/x/y.git",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----",
  ].join("\n");
  const clean = redact(text);
  for (const secret of [
    "cNDOxEMQ7rC2",
    "ghp_abcdef",
    "github_pat_11",
    "abc.def.ghi",
    "secret@",
    "b3BlbnNzaC1rZXk",
  ])
    expect(clean).not.toContain(secret);
  expect(clean).toContain("[MASQUE]");
  expect(redact("public key ssh-ed25519 AAAA is fine")).toBe("public key ssh-ed25519 AAAA is fine");
});

test("the logger redacts, timestamps and never throws", () => {
  const { ctx } = testContext();
  ctx.log("PrivateKey = cNDOxEMQ7rC2DPNdG67aB2XDs8B9mL5jIX3MCHMruEw=");
  const written = readFileSync(ctx.log.file, "utf8");
  expect(written).toStartWith("[2026-10-06T12:00:00.000Z] ");
  expect(written).not.toContain("cNDOxEMQ7rC2");
  const broken = createLogger("/proc/definitely/not/writable/omar.log");
  expect(() => broken("x")).not.toThrow();
});
