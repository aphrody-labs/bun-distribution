// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/MessageBubble.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { CircleButton } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

import { Markdown } from "./Markdown";

export interface MessageBubbleProps {
  content: string;
  isUser: boolean;
  isStreaming?: boolean;
  onCopy?: (content: string) => void;
  onDislike?: (content: string) => void;
  onFork?: () => void;
  variant?: "default" | "codex";
  className?: string;
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
}: MessageBubbleProps) {
  const isCodex = variant === "codex";

  return (
    <div
      className={clsx("group flex flex-col py-1.5 w-full", isUser ? "items-end" : "items-start", className)}
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
          <Markdown content={content} size="large" className="break-words font-sans" />
        )}
      </div>
      {!isUser && (onCopy || onDislike || onFork) ? (
        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-standard group-focus-within:opacity-100 group-hover:opacity-100">
          {onCopy && (
            <CircleButton
              icon="content_copy"
              variant="standard"
              size="sm"
              onClick={() => onCopy(content)}
              aria-label={isStreaming ? "Copy Streaming Message" : "Copy Message"}
              title={isStreaming ? "Copy streaming message" : "Copier"}
            />
          )}
          {onDislike && (
            <CircleButton
              icon="thumb_down"
              variant="standard"
              size="sm"
              onClick={() => onDislike(content)}
              aria-label="Dislike"
              title="Je n'aime pas"
            />
          )}
          {onFork && (
            <CircleButton
              icon="call_split"
              variant="standard"
              size="sm"
              onClick={onFork}
              aria-label="Fork"
              title="Bifurquer à partir de ce tour"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
