// SPDX-License-Identifier: Apache-2.0
// SSR and hydration smoke test for CollectionReader. MangaReader and CaptionedReader import
// `swiper/react`, which imports `react` without declaring it as a peer, so Bun's isolated
// linker cannot resolve it when they are loaded directly; they are not covered here.

import { describe, expect, test } from "bun:test";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";

import { CollectionReader } from "../src/CollectionReader";

const labels = {
  emptyLabel: "Aucun contenu",
  contentsLabel: "Sommaire",
  previousLabel: "Précédent",
  nextLabel: "Suivant",
};
const editions = [
  {
    id: "vol-1",
    label: "Tome 1",
    chapters: [
      { id: 1, label: "Chapitre 1", pageCount: 12 },
      { id: 2, label: "Chapitre vide", pageCount: 0 },
      { id: 3, label: "Chapitre 3", pageCount: 8 },
    ],
  },
];
const element = (
  <CollectionReader
    title="Collection"
    editions={editions}
    {...labels}
    renderChapter={(_edition, chapter) => <p>contenu {chapter.label}</p>}
  />
);

describe("<CollectionReader>", () => {
  test("renders the first chapter on the server", () => {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("contenu Chapitre 1");
    expect(html).toContain("Sommaire (2)");
  });

  test("hides chapters without pages", () => {
    expect(renderToStaticMarkup(element)).not.toContain("Chapitre vide");
  });

  test("renders the empty label when no edition has content", () => {
    const html = renderToStaticMarkup(
      <CollectionReader
        title="Collection"
        editions={[]}
        {...labels}
        renderChapter={() => null}
      />,
    );
    expect(html).toContain("Aucun contenu");
  });

  test("hydrates server markup without recoverable errors", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(element);
    const errors: unknown[] = [];
    const root = hydrateRoot(container, element, {
      onRecoverableError: (e) => errors.push(e),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    root.unmount();
    container.remove();
    expect(errors).toEqual([]);
  });
});
