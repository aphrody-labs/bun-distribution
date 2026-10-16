// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import {
  CaptionedReader,
  CollectionReader,
  MangaReader,
  type ReaderCollectionEdition,
} from "@aphrody/m3-reader/source";
import { Card, Page, Section } from "../ui.tsx";
import type { PageProps } from "./index.ts";

function samplePage(number: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960"><rect width="720" height="960" fill="#f5f0ff"/><rect x="40" y="40" width="640" height="390" rx="18" fill="#e0d4f5"/><circle cx="${180 + number * 70}" cy="220" r="80" fill="#6750a4"/><rect x="40" y="470" width="300" height="400" rx="18" fill="#d6e6f0"/><rect x="380" y="470" width="300" height="400" rx="18" fill="#ead8e7"/><text x="60" y="920" font-family="sans-serif" font-size="28" fill="#34264d">Local illustration · page ${number}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const PAGES = [1, 2, 3].map(samplePage);
const EDITIONS: ReaderCollectionEdition[] = [
  {
    id: "first",
    label: "Illustrated edition",
    chapters: [
      { id: "one", label: "Shapes", pageCount: 3 },
      { id: "two", label: "Reading", pageCount: 3 },
    ],
  },
  {
    id: "second",
    label: "Annotated edition",
    chapters: [{ id: "notes", label: "Annotations", pageCount: 3 }],
  },
];
const NOTES = PAGES.map((image, index) => ({
  image,
  number: index + 1,
  text: `Local demonstration page ${index + 1}. The shapes above are original inline SVG sample artwork. Use the paged view, zoom, and keyboard navigation to explore.`,
  verifiee: true,
}));

export default function Reader({ adaptive }: PageProps) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"manga" | "notes">("manga");
  return (
    <Page
      title="Reader"
      summary="An illustrated collection, paged manga viewer and annotated databook. All three pages use original local SVG sample artwork and require no external image request."
      packages={["@aphrody/m3-reader"]}
      panes={adaptive.panes}
    >
      <Section title="Reader mode">
        <div className="flex gap-3">
          {(["manga", "notes"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`state-layer rounded-full px-4 py-2 text-label-large ${kind === value ? "bg-secondary-container text-on-secondary-container" : "border border-outline"}`}
            >
              {value === "manga" ? "Paged illustration" : "Annotated pages"}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title="Local illustrated collection"
        description="Switch editions, chapters, reading direction and paged or vertical modes."
      >
        <Card>
          <CollectionReader
            title="Local M3 illustrations"
            editions={EDITIONS}
            emptyLabel="No sample pages"
            contentsLabel="Contents"
            previousLabel="Previous chapter"
            nextLabel="Next chapter"
            renderChapter={(_edition, chapter) =>
              kind === "manga" ? (
                <MangaReader
                  key={chapter.id}
                  pages={PAGES}
                  title={chapter.label}
                  direction="ltr"
                  onPageChange={setPage}
                />
              ) : (
                <CaptionedReader
                  key={chapter.id}
                  pages={NOTES}
                  title={chapter.label}
                />
              )
            }
          />
        </Card>
        {kind === "manga" ? (
          <output className="block text-body-medium">
            Illustration page: {page}
          </output>
        ) : null}
      </Section>
    </Page>
  );
}
