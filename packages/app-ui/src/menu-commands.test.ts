import { describe, expect, test } from "bun:test";
import {
  isMacPlatform,
  MENU_EVENTS,
  menuCommandForKey,
  menuShortcut,
} from "./menu-commands";

const key = (
  k: string,
  mods: Partial<{
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }> = {},
) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("menuCommandForKey", () => {
  test("maps Ctrl+N, Ctrl+O, Ctrl+Shift+O", () => {
    expect(menuCommandForKey(key("n", { ctrlKey: true }))).toBe("new-session");
    expect(menuCommandForKey(key("o", { ctrlKey: true }))).toBe("open-file");
    expect(menuCommandForKey(key("O", { ctrlKey: true, shiftKey: true }))).toBe(
      "open-folder",
    );
  });
  test("ignores other combos", () => {
    expect(menuCommandForKey(key("n"))).toBeNull();
    expect(
      menuCommandForKey(key("N", { ctrlKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      menuCommandForKey(key("o", { ctrlKey: true, altKey: true })),
    ).toBeNull();
    expect(menuCommandForKey(key("o", { metaKey: true }))).toBeNull();
    expect(menuCommandForKey(key("k", { ctrlKey: true }))).toBeNull();
  });
});

describe("isMacPlatform", () => {
  test("prefers userAgentData", () => {
    expect(
      isMacPlatform({
        userAgentData: { platform: "macOS" },
        platform: "Win32",
      }),
    ).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: "Windows" } })).toBe(
      false,
    );
  });
  test("falls back to navigator.platform", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

test("events and shortcuts match the native menu", () => {
  expect(MENU_EVENTS["open-folder"]).toBe("aphrody://menu/open-folder");
  expect(menuShortcut("open-folder", false)).toEqual(["Ctrl", "Shift", "O"]);
  expect(menuShortcut("new-session", true)).toEqual(["⌘", "N"]);
});
