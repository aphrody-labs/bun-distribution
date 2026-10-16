// SPDX-License-Identifier: Apache-2.0
// SSR and hydration smoke tests for the swiper-based readers (needs test/setup.ts).

import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";

import { CaptionedReader } from "../src/CaptionedReader";
import { MangaReader } from "../src/MangaReader";

async function hydrationErrors(element: ReactElement): Promise<unknown[]> {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(element);
  const errors: unknown[] = [];
  const root = hydrateRoot(container, element, {
    onRecoverableError: (e) => errors.push(e),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  root.unmount();
  container.remove();
  return errors;
}

const manga = <MangaReader title="Chapitre 1" pages={["p1.jpg", "p2.jpg"]} />;
const captioned = (
  <CaptionedReader
    title="Recueil illustré"
    pages={[
      { number: 1, image: "a.jpg", text: "texte" },
      { number: 2, image: "b.jpg" },
    ]}
  />
);

describe("swiper-based readers", () => {
  test("MangaReader renders its title on the server", () => {
    expect(renderToStaticMarkup(manga)).toContain("Chapitre 1");
  });

  test("CaptionedReader renders its title on the server", () => {
    expect(renderToStaticMarkup(captioned)).toContain("Recueil illustré");
  });

  test("MangaReader hydrates without recoverable errors", async () => {
    expect(await hydrationErrors(manga)).toEqual([]);
  });

  test("CaptionedReader hydrates without recoverable errors", async () => {
    expect(await hydrationErrors(captioned)).toEqual([]);
  });
});
