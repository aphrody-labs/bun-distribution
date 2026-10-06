// SPDX-License-Identifier: Apache-2.0
// Grounded answers: `[n]` markers rendered as citation chips, the numbered source list, and the
// refusal notice of a backend that declined to answer outside its sources.

"use client";

import { clsx } from "clsx";
import { useMemo } from "react";
import type { Components } from "react-markdown";

import { type ChatLabels, formatLabel, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";
import { focusRing } from "./internal";
import { Markdown, type MarkdownLinkHandler, externalLinkProps, isExternalHref } from "./Markdown";

/** One numbered passage an answer cites (`citations` of a grounded chat response). */
export interface Citation {
  /** Marker number used in the text as `[n]`. */
  n: number;
  id?: string;
  title: string;
  url?: string;
  sourceId?: string;
}

const CITATION_HREF = "#citation-";
const CODE_SPANS = /(```[\s\S]*?```|`[^`\n]*`)/;
const MARKER = /(?<![\]\\!])\[(\d{1,4})\](?!\()/g;

/**
 * Rewrite the `[n]` markers of `content` whose number is cited into markdown links
 * `[[n]](#citation-n)`. Code spans and fenced blocks are left untouched, as are markers
 * without a matching citation.
 */
export function linkCitationMarkers(content: string, citations: readonly Citation[]): string {
  if (citations.length === 0) return content;
  const known = new Set(citations.map((citation) => citation.n));
  return content
    .split(CODE_SPANS)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(MARKER, (match, digits: string) =>
            known.has(Number(digits)) ? `[\\[${digits}\\]](${CITATION_HREF}${digits})` : match,
          ),
    )
    .join("");
}

/** The numbers cited in `content`, in order of first appearance. */
export function citedNumbers(content: string): number[] {
  const seen: number[] = [];
  for (const part of content.split(CODE_SPANS).filter((_, index) => index % 2 === 0)) {
    for (const match of part.matchAll(MARKER)) {
      const n = Number(match[1]);
      if (!seen.includes(n)) seen.push(n);
    }
  }
  return seen;
}

export interface CitationChipProps {
  citation: Citation;
  labels?: Partial<ChatLabels>;
  onSelect?: (citation: Citation) => void;
  className?: string;
}

/** Inline citation marker: a dense M3 assist chip showing `n`, labelled with the source title. */
export function CitationChip({ citation, labels, onSelect, className }: CitationChipProps) {
  const l = resolveChatLabels(labels);
  const label = `${formatLabel(l.citation, { n: citation.n })}: ${citation.title}`;
  const chipClass = clsx(
    "mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-small px-1 align-baseline",
    "bg-secondary-container text-label-small text-on-secondary-container no-underline",
    "transition-colors duration-200 ease-standard hover:bg-secondary-container/80",
    focusRing,
    className,
  );
  if (!onSelect && citation.url) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noreferrer noopener"
        className={chipClass}
        aria-label={label}
        title={citation.title}
      >
        {citation.n}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={chipClass}
      aria-label={label}
      title={citation.title}
      onClick={() => onSelect?.(citation)}
    >
      {citation.n}
    </button>
  );
}

/** Markdown overrides of `CitedMarkdown`: citation links become chips, other links stay safe. */
function citationComponents(
  citations: readonly Citation[],
  labels: Partial<ChatLabels> | undefined,
  onCitationSelect: ((citation: Citation) => void) | undefined,
  onLinkClick: MarkdownLinkHandler | undefined,
): Components {
  const byNumber = new Map(citations.map((citation) => [citation.n, citation]));
  return {
    a: ({ node: _node, href, children, onClick, ...props }) => {
      if (href?.startsWith(CITATION_HREF)) {
        const citation = byNumber.get(Number(href.slice(CITATION_HREF.length)));
        if (citation)
          return <CitationChip citation={citation} labels={labels} onSelect={onCitationSelect} />;
      }
      return (
        <a
          href={href}
          {...(isExternalHref(href) ? externalLinkProps : {})}
          onClick={(event) => {
            onClick?.(event);
            if (href) onLinkClick?.(href, event);
          }}
          className={clsx(
            "rounded-extra-small text-primary underline underline-offset-2 hover:decoration-2",
            focusRing,
          )}
          {...props}
        >
          {children}
        </a>
      );
    },
  };
}

export interface CitedMarkdownProps {
  content: string;
  citations: readonly Citation[];
  labels?: Partial<ChatLabels>;
  /** Called when a marker is activated; without it, markers with a `url` open it. */
  onCitationSelect?: (citation: Citation) => void;
  /** Activation of an ordinary link (not a citation marker); see `Markdown.onLinkClick`. */
  onLinkClick?: MarkdownLinkHandler;
  size?: "small" | "medium" | "large";
  className?: string;
}

/** Markdown whose `[n]` markers become citation chips. */
export function CitedMarkdown({
  content,
  citations,
  labels,
  onCitationSelect,
  onLinkClick,
  size = "large",
  className,
}: CitedMarkdownProps) {
  const components = useMemo(
    () => citationComponents(citations, labels, onCitationSelect, onLinkClick),
    [citations, labels, onCitationSelect, onLinkClick],
  );
  return (
    <Markdown
      content={linkCitationMarkers(content, citations)}
      components={components}
      labels={labels}
      size={size}
      className={className}
    />
  );
}

export interface CitationListProps {
  citations: readonly Citation[];
  labels?: Partial<ChatLabels>;
  onSelect?: (citation: Citation) => void;
  className?: string;
}

/** The numbered sources of an answer, as an M3 list on `surface-container-low`. */
export function CitationList({ citations, labels, onSelect, className }: CitationListProps) {
  if (citations.length === 0) return null;
  const l = resolveChatLabels(labels);
  const sorted = [...citations];
  sorted.sort((a, b) => a.n - b.n);
  return (
    <section
      aria-label={l.sources}
      className={clsx(
        "m3-citation-list mt-2 rounded-medium bg-surface-container-low py-2",
        className,
      )}
    >
      <h3 className="px-4 pb-1 text-label-large text-on-surface-variant">{l.sources}</h3>
      <ol className="m-0 list-none p-0">
        {sorted.map((citation) => {
          const body = (
            <>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-small bg-secondary-container text-label-small text-on-secondary-container">
                {citation.n}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-medium text-on-surface">
                {citation.title}
              </span>
              {citation.url || onSelect ? (
                <ChatIcon name="open_in_new" size={18} className="text-on-surface-variant" />
              ) : null}
            </>
          );
          const rowClass = clsx(
            "flex min-h-12 w-full items-center gap-3 px-4 py-1 text-left",
            "transition-colors duration-200 ease-standard hover:bg-on-surface/8",
            focusRing,
            "focus-visible:outline-offset-[-3px]",
          );
          const name = `${formatLabel(l.citation, { n: citation.n })}: ${citation.title}`;
          return (
            <li
              key={`${citation.n}-${citation.id ?? citation.title}`}
              id={`citation-${citation.n}`}
            >
              {onSelect ? (
                <button
                  type="button"
                  className={rowClass}
                  aria-label={name}
                  onClick={() => onSelect(citation)}
                >
                  {body}
                </button>
              ) : citation.url ? (
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={rowClass}
                  aria-label={`${name} (${l.openSource})`}
                >
                  {body}
                </a>
              ) : (
                <div className="flex min-h-12 items-center gap-3 px-4 py-1">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export interface RefusalNoticeProps {
  labels?: Partial<ChatLabels>;
  /** Backend explanation, shown under the title instead of the generic body. */
  detail?: string;
  className?: string;
}

/** `refusal: true`: the answer is not established in the sources (M3 tonal note, not an error). */
export function RefusalNotice({ labels, detail, className }: RefusalNoticeProps) {
  const l = resolveChatLabels(labels);
  return (
    <div
      role="note"
      className={clsx(
        "m3-refusal-notice flex items-start gap-3 rounded-medium bg-surface-container-high px-4 py-3",
        className,
      )}
    >
      <ChatIcon name="info" size={20} className="mt-0.5 text-on-surface-variant" />
      <div className="min-w-0">
        <p className="m-0 text-title-small text-on-surface">{l.refusalTitle}</p>
        <p className="m-0 mt-0.5 text-body-medium text-on-surface-variant">
          {detail || l.refusalBody}
        </p>
      </div>
    </div>
  );
}
