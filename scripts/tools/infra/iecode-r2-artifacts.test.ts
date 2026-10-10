// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { validateArtifactInput, type ArtifactInput } from "./iecode-r2-artifacts";

const manifest = (): ArtifactInput => ({
  schema: "iecode.r2-artifacts/1",
  revision: "a".repeat(40),
  files: [
    {
      bucket: "iecode-vfs",
      key: `iecode/releases/${"a".repeat(40)}/archives/${"b".repeat(64)}/product.tar.gz`,
      source: resolve("product.tar.gz"),
      bytes: 5,
      sha256: "b".repeat(64),
      visibility: "private",
    },
  ],
});

test("storage scope rejects traversal, mutable prefixes and duplicate objects", () => {
  const input = manifest();
  expect(validateArtifactInput(input)).toHaveLength(1);
  input.files[0]!.key = "other/product.tar.gz";
  expect(() => validateArtifactInput(input)).toThrow("prefixes");
  input.files[0]!.key = `iecode/releases/${input.revision}/../product.tar.gz`;
  expect(() => validateArtifactInput(input)).toThrow("prefixes");
  input.files[0]!.key = `iecode/releases/${input.revision}/archives/${"b".repeat(64)}/product.tar.gz`;
  input.files.push({ ...input.files[0]! });
  expect(() => validateArtifactInput(input)).toThrow("Duplicate");
});

test("storage cannot publish credentials, raw databases or a provider store", () => {
  const input = manifest();
  for (const path of [
    ".codex/auth.json",
    "cookies/session.json",
    ".env.production",
    "mirror.sqlite",
    "rg.dump",
  ]) {
    input.files[0]!.source = resolve(path);
    expect(() => validateArtifactInput(input)).toThrow();
  }
});
