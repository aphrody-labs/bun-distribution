// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
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
