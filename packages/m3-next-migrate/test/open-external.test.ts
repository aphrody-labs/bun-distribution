// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { openExternalUrl, type ExternalOpenerWindow } from "../src/shims/provider";

function fakeWindow(extra: Partial<ExternalOpenerWindow> = {}) {
  const calls: string[] = [];
  const win: ExternalOpenerWindow = {
    open: (url, target, features) => {
      calls.push(`window.open ${url} ${target} ${features}`);
    },
    ...extra,
  };
  return { win, calls };
}

describe("openExternalUrl", () => {
  it("prefers the Tauri 3 opener plugin", async () => {
    const { win, calls } = fakeWindow({
      __TAURI__: {
        opener: { openUrl: async url => void calls.push(`opener ${url}`) },
        shell: { open: async url => void calls.push(`shell ${url}`) },
      },
    });
    await openExternalUrl("https://example.com", "tauri", win);
    expect(calls).toEqual(["opener https://example.com"]);
  });

  it("keeps the Tauri 2 shell plugin working", async () => {
    const { win, calls } = fakeWindow({
      __TAURI__: {
        shell: { open: async url => void calls.push(`shell ${url}`) },
      },
    });
    await openExternalUrl("https://example.com", "tauri", win);
    expect(calls).toEqual(["shell https://example.com"]);
  });

  it("falls back to window.open when the plugin throws or is absent", async () => {
    const throwing = fakeWindow({
      __TAURI__: {
        opener: {
          openUrl: async () => {
            throw new Error("denied");
          },
        },
      },
    });
    await openExternalUrl("https://example.com", "tauri", throwing.win);
    expect(throwing.calls).toEqual(["window.open https://example.com _blank noopener,noreferrer"]);

    const bare = fakeWindow();
    await openExternalUrl("https://example.com", "tauri", bare.win);
    expect(bare.calls).toEqual(["window.open https://example.com _blank noopener,noreferrer"]);
  });

  it("never calls Tauri plugins outside tauri mode and ignores a missing window", async () => {
    const { win, calls } = fakeWindow({
      __TAURI__: {
        opener: { openUrl: async url => void calls.push(`opener ${url}`) },
      },
    });
    await openExternalUrl("https://example.com", "browser", win);
    expect(calls).toEqual(["window.open https://example.com _blank noopener,noreferrer"]);
    await openExternalUrl("https://example.com", "tauri", undefined);
  });
});
