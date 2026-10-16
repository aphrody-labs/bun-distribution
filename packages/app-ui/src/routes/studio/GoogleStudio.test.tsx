// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { GoogleStudio } from "./GoogleStudio";
import { useI18n } from "../../i18n";
import { studioLabel, studioPath } from "./navigation";

test("public Studio routes search to the same translated SafeSearch controller", () => {
  expect(studioLabel("google", "en")).toBe("Aphrody Search");
  expect(studioLabel("google", "fr")).toBe("Recherche Aphrody");
  expect(studioPath("google")).toBe("/studio?section=google");
  useI18n.getState().setLanguage("en");
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GoogleStudio />
    </MemoryRouter>,
  );
  expect(html).toContain("Aphrody web search");
  expect(html).toContain("SafeSearch enabled");
  expect(html).toContain('href="/os"');
  expect(html).not.toContain('href="/studio?section=drive"');
  expect(html).not.toContain('value="images"');
  expect(html).not.toContain('href="https://www.google.com');
});

test("native Studio preserves every owned search vertical while translating the surface", async () => {
  const element = document.createElement("div");
  const root = createRoot(element);
  const host = window as unknown as {
    __TAURI_INTERNALS__?: { invoke: unknown };
  };
  const prior = host.__TAURI_INTERNALS__;
  host.__TAURI_INTERNALS__ = {
    invoke: () => {
      throw new Error("No native calls in SSR fixture");
    },
  };
  try {
    for (const language of ["fr", "en"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- locale updates share one mounted UI and must run in order.
      await act(async () => {
        useI18n.getState().setLanguage(language);
        root.render(
          <MemoryRouter>
            <GoogleStudio />
          </MemoryRouter>,
        );
      });
      const html = element.innerHTML;
      for (const vertical of ["web", "images", "news", "videos", "books"])
        expect(html).toContain(`value="${vertical}"`);
      expect(html).toContain(`lang="${language}"`);
      expect(html).toContain(
        language === "en" ? "Your search" : "Votre recherche",
      );
      expect(html).toContain('type="checkbox"');
      expect(html).not.toContain("Recherche Google");
    }
  } finally {
    await act(async () => root.unmount());
    if (prior) host.__TAURI_INTERNALS__ = prior;
    else delete host.__TAURI_INTERNALS__;
  }
});
