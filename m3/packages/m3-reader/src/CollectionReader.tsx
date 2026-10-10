"use client";

import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

export interface ReaderCollectionChapter {
  id: string | number;
  label: string;
  pageCount: number;
}

export interface ReaderCollectionEdition {
  id: string;
  label: string;
  chapters: ReaderCollectionChapter[];
}

export interface CollectionReaderProps {
  title: string;
  editions: ReaderCollectionEdition[];
  initialEdition?: string;
  initialChapter?: string | number;
  emptyLabel: string;
  contentsLabel: string;
  previousLabel: string;
  nextLabel: string;
  onSelectionChange?: (edition: ReaderCollectionEdition, chapter: ReaderCollectionChapter) => void;
  renderChapter: (
    edition: ReaderCollectionEdition,
    chapter: ReaderCollectionChapter,
    index: number,
  ) => ReactNode;
}

/** Edition and chapter navigation shared by manga volumes and illustrated collections. */
export function CollectionReader({
  title,
  editions,
  initialEdition,
  initialChapter,
  emptyLabel,
  contentsLabel,
  previousLabel,
  nextLabel,
  onSelectionChange,
  renderChapter,
}: CollectionReaderProps) {
  const contentsId = useId();
  const available = useMemo(
    () =>
      editions
        .map((edition) => ({
          ...edition,
          chapters: edition.chapters.filter((chapter) => chapter.pageCount > 0),
        }))
        .filter((edition) => edition.chapters.length > 0),
    [editions],
  );
  const [editionId, setEditionId] = useState(
    () => available.find((edition) => edition.id === initialEdition)?.id ?? available[0]?.id ?? "",
  );
  const edition = available.find((item) => item.id === editionId) ?? available[0];
  const [chapterIndex, setChapterIndex] = useState(() =>
    Math.max(
      0,
      edition?.chapters.findIndex((chapter) => String(chapter.id) === String(initialChapter)) ?? 0,
    ),
  );
  const [contentsOpen, setContentsOpen] = useState(false);
  const safeIndex = Math.min(chapterIndex, Math.max(0, (edition?.chapters.length ?? 0) - 1));
  const chapter = edition?.chapters[safeIndex];

  useEffect(() => {
    if (edition && chapter) onSelectionChange?.(edition, chapter);
  }, [edition, chapter, onSelectionChange]);

  if (!edition || !chapter) {
    return (
      <p
        className="m3-reader-collection-empty"
        data-m3-component="CollectionReader"
        data-testid="collection-reader-empty"
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <section
      className="m3-reader m3-reader-collection"
      aria-label={title}
      data-m3-component="CollectionReader"
      data-testid="collection-reader"
    >
      <div className="m3-reader-collection-toolbar">
        <div
          className="m3-reader-collection-editions"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- groupe de boutons : une fieldset imposerait bordure et marges par défaut au style existant
          role="group"
          aria-label={title}
        >
          {available.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === edition.id ? "m3-reader-btn-active" : "m3-reader-btn"}
              aria-pressed={item.id === edition.id}
              onClick={() => {
                setEditionId(item.id);
                setChapterIndex(0);
                setContentsOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="m3-reader-btn"
          aria-expanded={contentsOpen}
          aria-controls={contentsOpen ? contentsId : undefined}
          onClick={() => setContentsOpen((value) => !value)}
        >
          {contentsLabel} ({edition.chapters.length})
        </button>
      </div>
      {contentsOpen && (
        <div
          id={contentsId}
          className="m3-reader-collection-contents"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- groupe de boutons : une fieldset imposerait bordure et marges par défaut au style existant
          role="group"
          aria-label={contentsLabel}
        >
          {edition.chapters.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={index === safeIndex ? "m3-reader-btn-active" : "m3-reader-btn"}
              aria-current={index === safeIndex ? "page" : undefined}
              disabled={item.pageCount === 0}
              onClick={() => {
                setChapterIndex(index);
                setContentsOpen(false);
              }}
            >
              {item.label} · {item.pageCount}
            </button>
          ))}
        </div>
      )}
      {renderChapter(edition, chapter, safeIndex)}
      <nav className="m3-reader-collection-navigation" aria-label={contentsLabel}>
        <button
          type="button"
          className="m3-reader-btn"
          disabled={safeIndex === 0}
          onClick={() => setChapterIndex(safeIndex - 1)}
        >
          {previousLabel}
        </button>
        <span aria-live="polite">
          {chapter.label} ({safeIndex + 1}/{edition.chapters.length})
        </span>
        <button
          type="button"
          className="m3-reader-btn"
          disabled={safeIndex >= edition.chapters.length - 1}
          onClick={() => setChapterIndex(safeIndex + 1)}
        >
          {nextLabel}
        </button>
      </nav>
    </section>
  );
}
