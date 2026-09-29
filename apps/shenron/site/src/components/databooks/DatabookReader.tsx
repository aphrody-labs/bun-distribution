"use client";
import { useCallback } from "react";
import { DatabookReader as BaseDatabookReader, type DatabookReaderPage } from "@shenron/ui/reader";
import { TranscriptionTexte } from "./TranscriptionTexte";
import { assetUrl } from "@/lib/assets";
import { useReglages } from "@/lib/use-capacites";
import { optimizedSrc, optimizedSrcSet } from "@/lib/images";

export type { DatabookReaderPage };
export type DatabookReaderProps = { pages: DatabookReaderPage[]; title: string; bookId?: number | string | null };

export function DatabookReader({ pages, title, bookId }: DatabookReaderProps) {
  const { prechargement } = useReglages();
  const loadTranscriptions = useCallback(async (numbers: number[], signal: AbortSignal): Promise<Record<string, string>> => {
    if (bookId == null) return {};
    const response = await fetch(`/api/databooks/${bookId}/textes?pages=${numbers.join(",")}`, { signal });
    if (!response.ok) return {};
    const body: { textes?: Record<string, string> } = await response.json();
    return body.textes ?? {};
  }, [bookId]);
  const renderTranscription = useCallback(({ text, page, verified }: { text: string; page: number; verified: boolean }) => (
    <TranscriptionTexte texte={text} bookId={bookId} page={page} verifiee={verified} />
  ), [bookId]);
  return <div className="m3-reader--dragon-ball"><BaseDatabookReader pages={pages} title={title} resolveAssetUrl={assetUrl} imageSrc={optimizedSrc} imageSrcSet={optimizedSrcSet} loadTranscriptions={bookId == null ? undefined : loadTranscriptions} renderTranscription={renderTranscription} preloadCount={prechargement} /></div>;
}
