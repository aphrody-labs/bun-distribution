// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/MessageBubble.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { CircleButton } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

import { type ChatLabels, resolveChatLabels } from "./chatLabels";
import { type Citation, CitationList, CitedMarkdown, RefusalNotice } from "./citations";
import { ChatIcon } from "./chatIcons";
import { Markdown, type MarkdownLinkHandler } from "./Markdown";

export interface MessageBubbleProps {
  content: string;
  isUser: boolean;
  isStreaming?: boolean;
  onCopy?: (content: string) => void;
  onDislike?: (content: string) => void;
  onFork?: () => void;
  variant?: "default" | "codex";
  className?: string;
  /** Visible strings (aria-labels, titles); English defaults. */
  labels?: Partial<ChatLabels>;
  /** Grounded answer: `[n]` markers become citation chips and the sources are listed below. */
  citations?: readonly Citation[];
  /** The backend refused to answer: a refusal notice replaces an empty answer. */
  refusal?: boolean;
  onCitationSelect?: (citation: Citation) => void;
  /** Link activation in the answer (e.g. open the system browser from Tauri). */
  onLinkClick?: MarkdownLinkHandler;
}

/**
 * One chat turn. The user turn is an M3 bubble, the assistant turn is plain markdown
 * on the surface, as in M3 / Codex conversations.
 */
export function MessageBubble({
  content,
  isUser,
  isStreaming = false,
  onCopy,
  onDislike,
  onFork,
  variant = "default",
  className,
  labels,
  citations,
  refusal = false,
  onCitationSelect,
  onLinkClick,
}: MessageBubbleProps) {
  const isCodex = variant === "codex";
  const l = resolveChatLabels(labels);
  const cited = !isUser && citations && citations.length > 0 ? citations : null;

  return (
    <div
      className={clsx(
        "group flex flex-col py-1.5 w-full",
        isUser ? "items-end" : "items-start",
        className,
      )}
    >
      <div
        className={clsx(
          "min-w-0",
          isUser
            ? isCodex
              ? "max-w-[75%] rounded-[28px] bg-surface-container-high px-5 py-3 text-body-large text-on-surface shadow-xs"
              : "max-w-[80%] rounded-large rounded-br-extra-small bg-secondary-container px-4 py-2.5 text-body-large text-on-secondary-container"
            : "w-full max-w-full bg-transparent text-body-large text-on-surface",
        )}
        aria-busy={isStreaming || undefined}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{content}</div>
        ) : (
          <>
            {refusal && !content.trim() ? (
              <RefusalNotice labels={labels} />
            ) : cited ? (
              <CitedMarkdown
                content={content}
                citations={cited}
                labels={labels}
                onCitationSelect={onCitationSelect}
                onLinkClick={onLinkClick}
                className="break-words font-sans"
              />
            ) : (
              <Markdown
                content={content}
                size="large"
                labels={labels}
                onLinkClick={onLinkClick}
                className="break-words font-sans"
              />
            )}
            {refusal && content.trim() ? <RefusalNotice labels={labels} className="mt-2" /> : null}
            {cited && !isStreaming ? (
              <CitationList citations={cited} labels={labels} onSelect={onCitationSelect} />
            ) : null}
          </>
        )}
      </div>
      {!isUser && (onCopy || onDislike || onFork) ? (
        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-standard group-focus-within:opacity-100 group-hover:opacity-100">
          {onCopy && (
            <CircleButton
              icon={<ChatIcon name="content_copy" size={18} />}
              variant="standard"
              size="sm"
              onClick={() => onCopy(content)}
              aria-label={isStreaming ? l.copyStreamingMessage : l.copyMessage}
              title={isStreaming ? l.copyStreamingMessage : l.copyMessage}
            />
          )}
          {onDislike && (
            <CircleButton
              icon={<ChatIcon name="thumb_down" size={18} />}
              variant="standard"
              size="sm"
              onClick={() => onDislike(content)}
              aria-label={l.dislike}
              title={l.dislike}
            />
          )}
          {onFork && (
            <CircleButton
              icon={<ChatIcon name="call_split" size={18} />}
              variant="standard"
              size="sm"
              onClick={onFork}
              aria-label={l.fork}
              title={l.fork}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
