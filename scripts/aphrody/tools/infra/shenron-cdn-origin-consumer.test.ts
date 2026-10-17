// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { assertConsumerFile, validateConsumerPins } from "./shenron-cdn-origin-consumer";

test("consumer activation rejects missing artifact pins and accepts a complete provenance boundary", () => {
  const pins = {
    sourceCommit: "a".repeat(40),
    beforeCodeSha256: "b".repeat(64),
    candidateCodeSha256: "c".repeat(64),
    unitSha256: "d".repeat(64),
    configSha256: "e".repeat(64),
  };
  expect(() => validateConsumerPins(pins)).not.toThrow();
  for (const field of Object.keys(pins))
    expect(() => validateConsumerPins({ ...pins, [field]: "invalid" })).toThrow("required");
  expect(() =>
    validateConsumerPins({
      ...pins,
      candidateCodeSha256: pins.beforeCodeSha256,
    }),
  ).toThrow("Distinct");
});

test("canonical runtime inputs reject symlinks, another owner and exposed configuration", () => {
  const regular = {
    uid: 0,
    mode: 0o600,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  expect(() => assertConsumerFile(regular, true)).not.toThrow();
  expect(() => assertConsumerFile({ ...regular, mode: 0o644 }, false)).not.toThrow();
  for (const info of [
    { ...regular, uid: 1000 },
    { ...regular, mode: 0o644 },
    { ...regular, isFile: () => false },
    { ...regular, isSymbolicLink: () => true },
  ])
    expect(() => assertConsumerFile(info, true)).toThrow("Canonical");
});
