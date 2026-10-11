// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ProductSearchHome } from "./ProductSearchHome";

test("homepage exposes a labelled native search and retains product resource destinations", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ProductSearchHome />
    </MemoryRouter>,
  );
  expect(html).toContain('<search aria-label="Google search through Aphrody"');
  expect(html).toContain('for="aphrody-home-search"');
  expect(html).toContain('type="search"');
  expect(html).toContain('aria-live="polite"');
  for (const href of [
    "https://os.aphrody.com/",
    "/docs",
    "/templates",
    "/material-3/components",
    "/studio?section=google",
    "https://downloads.aphrody.com/",
  ]) {
    expect(html).toContain(`href="${href}"`);
  }
  expect(html).toContain("no account cookies");
  expect(html).not.toContain("60fps");
  expect(html).not.toContain("WebAssembly");
});

test("public search exposes upstream unavailability and an encoded Google destination", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  // The decorative pet's continuous state updates prevent act() from settling.
  globalThis.requestAnimationFrame = () => 0;
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    requested.push(String(url));
    return Response.json({ error: "Search is temporarily unavailable" }, { status: 502 });
  }) as typeof fetch;
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ProductSearchHome publicPreview />
        </MemoryRouter>,
      ),
    );
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "TypeScript 7 & Bun",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(requested).toHaveLength(1);
    expect(requested[0]).toStartWith("/api/search?");
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Search is temporarily unavailable");
    const link = alert.querySelector("a")!;
    expect(link.href).toBe("https://www.google.com/search?q=TypeScript%207%20%26%20Bun");
    expect(link.rel).toBe("noopener noreferrer");
    expect(host.textContent).not.toContain("Results for");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
    await act(async () => root.unmount());
    host.remove();
  }
});
