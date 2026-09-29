"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MangaReader as BaseMangaReader, type MangaReaderProps as ReaderProps } from "@shenron/ui/reader";
import { assetMirrorUrl } from "@shenron/config/public-urls";
import { assetUrl } from "@/lib/assets";
import { API_ORIGIN, CDN_ORIGIN } from "@/lib/config";

export type MangaReaderProps = Pick<ReaderProps, "pages" | "title" | "direction" | "prevHref" | "nextHref" | "prevPages" | "nextPages"> & {
  chapterId?: number;
  chapterNumber?: number;
  series?: string;
  chapterTitle?: string | null;
};

const renderChapterLink: NonNullable<ReaderProps["renderChapterLink"]> = ({ href, children, className, ariaLabel }) => (
  <Link href={href} className={className} aria-label={ariaLabel} title={ariaLabel}>{children}</Link>
);

export function MangaReader({ chapterId, chapterNumber, series, chapterTitle, ...props }: MangaReaderProps) {
  const [initialPage, setInitialPage] = useState(1);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const requested = Number(new URLSearchParams(window.location.search).get("planche"));
    if (Number.isFinite(requested) && requested >= 1) setInitialPage(Math.trunc(requested));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!chapterId) return;
    try {
      const read = JSON.parse(localStorage.getItem("dbfr_read_chapters") ?? "[]");
      const ids: number[] = Array.isArray(read) ? read.map(Number) : [];
      if (!ids.includes(chapterId)) ids.push(chapterId);
      localStorage.setItem("dbfr_read_chapters", JSON.stringify(ids));
      localStorage.setItem("dbfr_last_read_chapter", JSON.stringify({
        id: chapterId, chapter_number: chapterNumber ?? 0, title: chapterTitle || null, series: series || "DBS",
      }));
    } catch (error) { console.error("Failed to save read chapter", error); }
  }, [chapterId, chapterNumber, series, chapterTitle]);
  const onPageChange = useCallback((page: number) => {
    if (!chapterId || !ready) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("planche") === String(page)) return;
    url.searchParams.set("planche", String(page));
    window.history.replaceState(null, "", url.toString());
  }, [chapterId, ready]);
  const apiPageHref = useCallback((page: number) => chapterId ? `/api/manga/chapter/${chapterId}/planche/${page}` : null, [chapterId]);
  const resolveMirrorUrl = useCallback((url: string) => assetMirrorUrl(url, CDN_ORIGIN, API_ORIGIN), []);
  return <div className="m3-reader--dragon-ball"><BaseMangaReader key={initialPage} {...props} initialPage={initialPage} onPageChange={onPageChange} apiPageHref={apiPageHref} resolveAssetUrl={assetUrl} resolveMirrorUrl={resolveMirrorUrl} renderChapterLink={renderChapterLink} /></div>;
}
