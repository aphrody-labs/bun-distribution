// SPDX-License-Identifier: Apache-2.0
// The light client provider: mode, cookie bridge, <html> classes, and the on-demand colour engine.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  M3NextThemeProvider,
  M3ThemeProvider,
  useM3Theme,
  useM3ThemeToggle,
  type M3ThemeContextType,
} from "../src/client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

// happy-dom stores cookies only for http(s) documents.
(
  window as unknown as { happyDOM: { setURL(url: string): void } }
).happyDOM.setURL("http://localhost/");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let root: ReturnType<typeof createRoot> | undefined;
let theme: M3ThemeContextType;
let toggle: ReturnType<typeof useM3ThemeToggle>;

function Probe() {
  // oxlint-disable-next-line react/globals -- test probe: publishes the live hook values to the test-scoped variables the assertions read
  theme = useM3Theme();
  // oxlint-disable-next-line react/globals -- same test probe capture as the theme line above
  toggle = useM3ThemeToggle();
  return (
    <span id="probe">
      {theme.themeMode}:{theme.resolvedTheme}
    </span>
  );
}

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {
    await sleep(20);
  });
}

const html = document.documentElement;
const clearCookie = () => {
  document.cookie = "m3-theme=; path=/; max-age=0";
  document.cookie = "app-theme=; path=/; max-age=0";
  document.cookie = "app.theme=; path=/; max-age=0";
};

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  html.className = "";
  html.removeAttribute("style");
  html.removeAttribute("data-m3-theme");
  clearCookie();
});

describe("M3ThemeProvider", () => {
  test("renders on the server without touching the DOM", () => {
    expect(
      renderToString(
        <M3NextThemeProvider initialMode="dark">
          <b>child</b>
        </M3NextThemeProvider>,
      ),
    ).toBe("<b>child</b>");
  });

  test("useM3Theme outside the provider throws a clear error", () => {
    expect(() => renderToString(<Probe />)).toThrow(
      "useM3Theme must be used within an M3ThemeProvider",
    );
  });

  test("a server-rendered mode is kept, the class and cookie follow", async () => {
    await mount(
      <M3NextThemeProvider initialMode="dark">
        <Probe />
      </M3NextThemeProvider>,
    );
    expect(theme.themeMode).toBe("dark");
    expect(theme.resolvedTheme).toBe("dark");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.classList.contains("light")).toBe(false);
    expect(html.dataset["m3Theme"]).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");
    expect(document.cookie).toContain("m3-theme=dark");
  });

  test("a static shell adopts the saved preference after hydration, without overwriting it", async () => {
    document.cookie = "m3-theme=light; path=/";
    html.classList.add("light");
    await mount(
      <M3NextThemeProvider initialMode="system">
        <Probe />
      </M3NextThemeProvider>,
    );
    expect(theme.themeMode).toBe("light");
    expect(document.cookie).toContain("m3-theme=light");
    expect(html.classList.contains("light")).toBe(true);
    expect(html.classList.contains("dark")).toBe(false);
  });

  test("setThemeMode writes the cookie and flips the classes; toggle cycles light, dark, system", async () => {
    await mount(
      <M3ThemeProvider defaultThemeMode="light">
        <Probe />
      </M3ThemeProvider>,
    );
    expect(html.classList.contains("light")).toBe(true);
    await act(async () => theme.setThemeMode("dark"));
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.classList.contains("light")).toBe(false);
    expect(document.cookie).toContain("m3-theme=dark");
    await act(async () => toggle.toggle());
    expect(toggle.mode).toBe("system");
    await act(async () => toggle.toggle());
    expect(toggle.mode).toBe("light");
    expect(document.cookie).toContain("m3-theme=light");
  });

  test("a custom cookie name is used for reading and writing", async () => {
    document.cookie = "app-theme=dark; path=/";
    await mount(
      <M3ThemeProvider cookieName="app-theme">
        <Probe />
      </M3ThemeProvider>,
    );
    expect(theme.themeMode).toBe("dark");
    expect(document.cookie).toContain("app-theme=dark");
    expect(document.cookie).not.toContain("m3-theme=");
  });

  test("partial cookie values are ignored and punctuation preserves cookie identity", async () => {
    document.cookie = "m3-theme=darkened; path=/";
    await mount(
      <M3ThemeProvider defaultThemeMode="light">
        <Probe />
      </M3ThemeProvider>,
    );
    expect(theme.themeMode).toBe("light");
    await act(async () => root?.unmount());
    root = undefined;
    clearCookie();
    document.cookie = "app.theme=dark; path=/";
    await mount(
      <M3ThemeProvider cookieName="app.theme">
        <Probe />
      </M3ThemeProvider>,
    );
    expect(theme.themeMode).toBe("dark");
    expect(document.cookie).toContain("app.theme=dark");
    expect(document.cookie).not.toContain("apptheme=");
  });

  test("the inlined scheme costs nothing: no inline roles, no colour engine", async () => {
    await mount(
      <M3NextThemeProvider initialMode="light" seed="#0b57d0">
        <Probe />
      </M3NextThemeProvider>,
    );
    expect(html.style.getPropertyValue("--md-sys-color-primary")).toBe("");
  });

  test("a new seed loads the engine on demand and sets the roles; the inlined seed clears them again", async () => {
    await mount(
      <M3ThemeProvider defaultThemeMode="light" defaultSeedColor="#6750a4">
        <Probe />
      </M3ThemeProvider>,
    );
    await act(async () => theme.setSeedColor("#b3261e"));
    await act(async () => {
      await sleep(50);
    });
    const custom = html.style.getPropertyValue("--md-sys-color-primary");
    expect(custom).toMatch(/^#[0-9a-f]{6}$/i);
    await act(async () => theme.setSeedColor("#6750a4"));
    await act(async () => {
      await sleep(50);
    });
    expect(html.style.getPropertyValue("--md-sys-color-primary")).toBe("");
  });

  test("schemeInlined={false} computes the roles on mount", async () => {
    await mount(
      <M3ThemeProvider
        defaultThemeMode="dark"
        defaultSeedColor="#0b57d0"
        schemeInlined={false}
      >
        <Probe />
      </M3ThemeProvider>,
    );
    await act(async () => {
      await sleep(50);
    });
    expect(html.style.getPropertyValue("--md-sys-color-primary")).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
  });
});
