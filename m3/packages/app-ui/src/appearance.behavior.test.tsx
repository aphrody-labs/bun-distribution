// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppearanceSettings } from "./Settings/pages/AppearanceSettings";
import { applyAppearance, applyTheme, useTheme } from "./hooks/useTheme";

let root: Root | undefined;
const host = document.createElement("div");
document.body.append(host);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalClass = document.documentElement.className;
const originalStyle = document.documentElement.getAttribute("style");
const originalPreferences = localStorage.getItem("aphrody.preferences");

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.replaceChildren();
  document.documentElement.className = originalClass;
  if (originalStyle === null) document.documentElement.removeAttribute("style");
  else document.documentElement.setAttribute("style", originalStyle);
  if (originalPreferences === null) localStorage.removeItem("aphrody.preferences");
  else localStorage.setItem("aphrody.preferences", originalPreferences);
});

test("appearance applies the actual M3 classes and the accessibility floor", () => {
  applyAppearance({ theme: "light", fontSize: 22, reducedMotion: true });
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(document.documentElement.style.getPropertyValue("--aphrody-base-font-size")).toBe("22px");
  expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
  applyAppearance({ theme: "dark", fontSize: 8, reducedMotion: false });
  expect(document.documentElement.classList.contains("light")).toBe(false);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--aphrody-base-font-size")).toBe("18px");
});

test("appearance settings persist before applying and retain the current theme on failure", async () => {
  localStorage.setItem("aphrody.preferences", JSON.stringify({ theme: "dark" }));
  applyTheme("dark");
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppearanceSettings)));
  const light = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Clair"),
  )!;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  const storage = localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: storage.getItem.bind(storage),
      setItem: () => {
        throw new Error("storage unavailable");
      },
    },
  });
  try {
    await act(async () => light.click());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Impossible d’enregistrer");
    expect(light.getAttribute("aria-pressed")).toBe("false");
  } finally {
    Object.defineProperty(globalThis, "localStorage", descriptor);
  }
  await act(async () => light.click());
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(JSON.parse(localStorage.getItem("aphrody.preferences")!).theme).toBe("light");
  expect(light.getAttribute("aria-pressed")).toBe("true");
});

function ShellAppearance() {
  useTheme();
  return null;
}

test("shell appearance loads without a Drive connection", async () => {
  localStorage.setItem("aphrody.preferences", JSON.stringify({ theme: "light", fontSize: 20 }));
  root = createRoot(host);
  await act(async () => root!.render(createElement(ShellAppearance)));
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--aphrody-base-font-size")).toBe("20px");
});
