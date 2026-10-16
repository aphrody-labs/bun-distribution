// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { authorizeGoogleDrive } from "./studio-bridge";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function native(reply: (command: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          return reply(command, args);
        },
      },
    },
  });
  return calls;
}

describe("Studio bridge follows actual native IPC contracts", () => {
  test("Drive consent forwards the native grant unchanged", async () => {
    const grant = { access_token: "a", refresh_token: "r", client_id: "c", client_secret: "s" };
    const calls = native(() => grant);
    expect(await authorizeGoogleDrive()).toBe(grant);
    expect(calls).toEqual([{ command: "studio_google_drive_authorize", args: {} }]);
  });
  test("native failures propagate without a synthetic result", async () => {
    const failure = new Error("consent refused");
    native(() => {
      throw failure;
    });
    await expect(authorizeGoogleDrive()).rejects.toBe(failure);
  });
  test("browser callers cannot report native success", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    await expect(authorizeGoogleDrive()).rejects.toThrow("Cette vue nécessite");
  });
});
