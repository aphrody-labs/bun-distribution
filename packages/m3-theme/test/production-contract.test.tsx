// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- installs browser globals before React DOM is loaded
import "@aphrody/m3-config/test/dom";
import { afterEach, describe, expect, test } from "bun:test";
import {
  applyDynamicFusionTheme,
  clearM3Scheme,
  httpSchemeSheet,
  schemeRoles,
  type M3SchemeRequest,
  type M3SchemeSheet,
} from "../src/index.ts";
import { useEffect } from "react";
import { M3ThemeProvider, useM3Theme, type M3ThemeContextType } from "../src/react.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

/** Stand-in for the Rust `scheme` sheet (same shape as `sheets::scheme_css`); records requests. */
function rustSheet() {
  const requests: M3SchemeRequest[] = [];
  const sheet: M3SchemeSheet = async request => {
    requests.push(request);
    const tone = request.contrast === 1 ? "000000" : request.dark ? "eeeeee" : "123456";
    return `/* M3 ${request.variant} scheme */\n:root {\n  color-scheme: ${request.dark ? "dark" : "light"};\n  --md-sys-color-primary: #${tone};\n  --md-sys-color-on-primary: #ffffff;\n}\n`;
  };
  return { sheet, requests };
}

const schemeStyles = () => [...document.head.querySelectorAll("style[data-m3-scheme]")];
const inlineColours = (element: HTMLElement) => (element.getAttribute("style") ?? "").match(/--[\w-]+/g) ?? [];

afterEach(() => {
  clearM3Scheme(document.documentElement);
  for (const style of schemeStyles()) style.remove();
});

describe("runtime theme application", () => {
  test("httpSchemeSheet sends the m3Css fields and surfaces server errors", async () => {
    const urls: string[] = [];
    const ok = httpSchemeSheet("/api/m3/css", async url => {
      urls.push(url);
      return new Response(":root {\n  --md-sys-color-primary: #112233;\n  --md-ext-color-x: #000000;\n}\n");
    });
    const request = {
      sheet: "scheme",
      seed: "#8c6c88",
      variant: "tonal-spot",
      contrast: 0.5,
      dark: true,
    } as const;
    const css = await ok(request);
    expect(urls).toEqual(["/api/m3/css?sheet=scheme&seed=%238c6c88&variant=tonal-spot&contrast=0.5&dark=true"]);
    expect(schemeRoles(css)).toEqual({ "--md-sys-color-primary": "#112233" });
    const failing = httpSchemeSheet(
      "/api/m3/css",
      async () => new Response('unknown variant "content"', { status: 400 }),
    );
    expect(failing(request)).rejects.toThrow("answered 400: unknown variant");
  });

  test("without a Rust sheet source a theme change fails and changes nothing", async () => {
    const target = document.createElement("section");
    const before = target.outerHTML;
    expect(applyDynamicFusionTheme("#6750a4", { dark: true, target })).rejects.toThrow(
      "colours are not computed in JS",
    );
    expect(target.outerHTML).toBe(before);
    expect(schemeStyles()).toHaveLength(0);
  });

  test("Rust scheme sheets land in a stylesheet with their high contrast twin, never inline", async () => {
    const { sheet, requests } = rustSheet();
    const root = document.documentElement;
    await applyDynamicFusionTheme(" ABC ", {
      dark: true,
      variant: "expressive",
      sheet,
    });
    expect(requests).toEqual([
      {
        sheet: "scheme",
        seed: "#aabbcc",
        variant: "expressive",
        contrast: 0,
        dark: true,
      },
      {
        sheet: "scheme",
        seed: "#aabbcc",
        variant: "expressive",
        contrast: 1,
        dark: true,
      },
    ]);
    expect(inlineColours(root)).toEqual([]);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("light")).toBe(false);
    const [style] = schemeStyles();
    expect(style!.textContent).toBe(
      ":root,\n:root.light,\n:root.dark {\n  color-scheme: dark;\n  --md-sys-color-primary: #eeeeee;\n  --md-sys-color-on-primary: #ffffff;\n}\n" +
        "@media (prefers-contrast: more) {\n:root,\n:root.light,\n:root.dark {\n  color-scheme: dark;\n  --md-sys-color-primary: #000000;\n  --md-sys-color-on-primary: #ffffff;\n}\n}\n",
    );

    await applyDynamicFusionTheme("#abc", {
      dark: false,
      contrastLevel: 1,
      sheet,
    });
    expect(requests.at(-1)).toEqual({
      sheet: "scheme",
      seed: "#aabbcc",
      variant: "tonal-spot",
      contrast: 1,
      dark: false,
    });
    expect(schemeStyles()).toHaveLength(1);
    expect(schemeStyles()[0]!.textContent).not.toContain("prefers-contrast");
  });

  test("an invalid input or sheet leaves the installed theme intact", async () => {
    const { sheet } = rustSheet();
    const target = document.createElement("section");
    document.body.append(target);
    await applyDynamicFusionTheme("#6750a4", { dark: false, target, sheet });
    const id = target.getAttribute("data-m3-scheme");
    expect(id).toBeTruthy();
    const installed = schemeStyles()[0]!.textContent;
    expect(installed).toStartWith(`[data-m3-scheme="${id}"],\n[data-m3-scheme="${id}"].light`);
    const before = target.outerHTML;
    expect(applyDynamicFusionTheme("invalid", { dark: true, target, sheet })).rejects.toThrow("Invalid M3 seed");
    expect(
      applyDynamicFusionTheme("#6750a4", {
        contrastLevel: Number.NaN,
        dark: true,
        target,
        sheet,
      }),
    ).rejects.toThrow(RangeError);
    expect(
      applyDynamicFusionTheme("#6750a4", {
        dark: true,
        target,
        sheet: () => ":root { --x: 1; }",
      }),
    ).rejects.toThrow("not a Rust m3Css `scheme` sheet");
    await Bun.sleep(0);
    expect(target.outerHTML).toBe(before);
    expect(schemeStyles()[0]!.textContent).toBe(installed);
    clearM3Scheme(target);
    expect(schemeStyles()).toHaveLength(0);
    target.remove();
  });
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("M3ThemeProvider", () => {
  let theme: M3ThemeContextType;
  function Probe() {
    const value = useM3Theme();
    useEffect(() => {
      theme = value;
    });
    return null;
  }
  test("the compiled theme only gets its mode; changes without a sheet throw", async () => {
    await using _ = await mount(
      <M3ThemeProvider defaultSeedColor="#8c6c88" defaultThemeMode="dark">
        <Probe />
      </M3ThemeProvider>,
    );
    const root = document.documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(inlineColours(root)).toEqual([]);
    expect(schemeStyles()).toHaveLength(0);
    expect(() => theme.setSeedColor("#123456")).toThrow("needs the `sheet` prop");
    expect(() => theme.setContrastLevel(1)).toThrow("needs the `sheet` prop");
    expect(() => theme.setVariant("vibrant")).toThrow("needs the `sheet` prop");
    await act(async () => theme.setThemeMode("light"));
    expect(root.classList.contains("light")).toBe(true);
    expect(root.classList.contains("dark")).toBe(false);
  });

  test("a change installs the Rust sheet and returning to the compiled theme removes it", async () => {
    const { sheet, requests } = rustSheet();
    await using _ = await mount(
      <M3ThemeProvider defaultSeedColor="#8c6c88" defaultThemeMode="light" sheet={sheet}>
        <Probe />
      </M3ThemeProvider>,
    );
    expect(requests).toEqual([]);
    await act(async () => theme.setSeedColor("#123456"));
    await act(() => Bun.sleep(0));
    expect(requests.map(request => [request.seed, request.contrast, request.dark])).toEqual([
      ["#123456", 0, false],
      ["#123456", 1, false],
    ]);
    expect(schemeStyles()).toHaveLength(1);
    expect(inlineColours(document.documentElement)).toEqual([]);
    expect(theme.schemeError).toBeUndefined();
    await act(async () => theme.setSeedColor("#8c6c88"));
    expect(schemeStyles()).toHaveLength(0);
  });

  test("a failing sheet source is reported, not swallowed", async () => {
    await using _ = await mount(
      <M3ThemeProvider
        defaultThemeMode="light"
        sheet={() => Promise.reject(new Error("aphrody-ffi native library not found"))}
      >
        <Probe />
      </M3ThemeProvider>,
    );
    await act(async () => theme.setVariant("vibrant"));
    await act(() => Bun.sleep(0));
    expect(theme.schemeError?.message).toBe("aphrody-ffi native library not found");
    expect(schemeStyles()).toHaveLength(0);
  });
});
