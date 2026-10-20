// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readSessionIdentity, sessionIdentity } from "./session-identity";

test("session identity uses initialized Rust account/read and retains no provider or credential fields", async () => {
  const calls: string[] = [];
  const identity = await readSessionIdentity(
    async () => {
      calls.push("initialize");
    },
    async (method, params) => {
      calls.push(method);
      expect(params).toEqual({});
      return {
        authMode: "oss",
        plan: "oss",
        email: "local@example.test",
        apiKey: "fixture-not-a-real-key",
      };
    },
  );
  expect(calls).toEqual(["initialize", "account/read"]);
  expect(identity).toEqual({ authMode: "oss" });
});
test("unidentified sessions remain unidentified and malformed responses fail", () => {
  expect(sessionIdentity({ authMode: null })).toEqual({ authMode: null });
  for (const value of [null, [], {}, { authMode: "connected" }])
    expect(() => sessionIdentity(value)).toThrow();
});
test("initialization failure prevents account requests", async () => {
  let requested = false;
  await expect(
    readSessionIdentity(
      async () => {
        throw new Error("Service unavailable");
      },
      async () => {
        requested = true;
        return {};
      },
    ),
  ).rejects.toThrow("Service unavailable");
  expect(requested).toBe(false);
});
