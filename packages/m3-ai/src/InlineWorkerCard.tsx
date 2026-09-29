// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/InlineWorkerCard.tsx), MIT, rebuilt on Material Design 3.

import { useId, useMemo, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Button, Icon } from "@aphrody/m3-primitives";
import { ToolCall } from "./ToolCall";
import { Markdown } from "./Markdown";
import type { TranscriptStep } from "./types";
import { pairTranscriptSteps } from "./types";
import { CircularIndicator, StatusChip, type ChipTone, expandMotion, focusRing } from "./internal";

/** Collapse runs of 3+ spaces to 2, preventing Markdown 4-space code blocks. */
function stripExcessWhitespace(text: string): string {
  return text.replace(/ {3,}/g, "  ");
}

interface InlineWorkerCardProps {
  title: string;
  status: string;
  toolCallCount: number;
  liveStatus?: string | null;
  transcript: TranscriptStep[];
  isTranscriptLoading?: boolean;
  onCopyLogs?: () => void;
  onCancel?: () => void;
  className?: string;
  /** Start expanded (uncontrolled). */
  defaultExpanded?: boolean;
}

function statusTone(status: string): ChipTone {
  switch (status) {
    case "running":
      return "primary";
    case "completed":
      return "success";
    case "failed":
    case "error":
    case "cancelled":
      return "error";
    default:
      return "neutral";
  }
}

/** A worker run as an M3 filled card: header, status chip, expandable transcript. */
function InlineWorkerCard({
  title,
  status,
  toolCallCount,
  liveStatus,
  transcript,
  isTranscriptLoading,
  onCopyLogs,
  onCancel,
  className,
  defaultExpanded = false,
}: InlineWorkerCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();

  const items = useMemo(() => pairTranscriptSteps(transcript), [transcript]);

  const isRunning = status === "running";
  const isDone = status === "completed";
  const tone = statusTone(status);

  return (
    <div className={clsx("group flex min-w-0 flex-col items-start", className)}>
      <div className="min-w-0 max-w-full overflow-hidden rounded-medium bg-surface-container text-on-surface">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={contentId}
          className={clsx(
            "flex w-full items-start gap-3 rounded-medium px-4 py-3 text-left transition-colors duration-200 ease-standard",
            "hover:bg-on-surface/8 active:bg-on-surface/10",
            focusRing,
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center">
            {isRunning ? (
              <CircularIndicator size={20} label="Worker running" />
            ) : isDone ? (
              <div className="flex size-8 items-center justify-center rounded-full bg-success-container text-on-success-container">
                <Icon name="check_circle" size={18} filled />
              </div>
            ) : tone === "error" ? (
              <div className="flex size-8 items-center justify-center rounded-full bg-error-container text-on-error-container">
                <Icon name="error" size={18} filled />
              </div>
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
                <Icon name="build" size={18} />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="line-clamp-2 min-w-0 flex-1 text-title-small text-on-surface">
                {title}
              </div>
              <StatusChip tone={tone}>{status}</StatusChip>
            </div>
            <div className="mt-1 flex items-center gap-2 text-body-small text-on-surface-variant">
              <span>{toolCallCount} tool calls</span>
              {liveStatus ? <span className="truncate text-outline">{liveStatus}</span> : null}
            </div>
          </div>

          <Icon
            name="expand_more"
            size={20}
            className={clsx(
              "mt-1.5 shrink-0 text-on-surface-variant transition-transform duration-300 ease-emphasized",
              expanded ? "rotate-180" : "",
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              id={contentId}
              key="transcript"
              {...expandMotion}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-2 border-t border-outline-variant px-4 py-3">
                {isTranscriptLoading ? (
                  <div className="flex items-center gap-2 text-body-small text-on-surface-variant">
                    <CircularIndicator size={16} label="Loading transcript" />
                    Loading worker transcript...
                  </div>
                ) : items.length > 0 ? (
                  items.map((item) =>
                    item.kind === "tool" ? (
                      <ToolCall key={item.pair.id} pair={item.pair} />
                    ) : (
                      <Markdown
                        key={`text-${item.text}`}
                        content={stripExcessWhitespace(item.text)}
                        size="small"
                        className="text-on-surface-variant"
                      />
                    ),
                  )
                ) : (
                  <div className="text-body-small text-on-surface-variant">No tool calls yet.</div>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {(onCopyLogs || (onCancel && isRunning)) && (
        <div className="mt-1 flex gap-1 opacity-0 transition-opacity duration-200 ease-standard group-focus-within:opacity-100 group-hover:opacity-100">
          {onCopyLogs && (
            <Button variant="text" size="xs" onClick={onCopyLogs} title="Copy logs">
              <Icon name="content_copy" size={18} />
              Copy
            </Button>
          )}
          {onCancel && isRunning && (
            <Button variant="text" size="xs" onClick={onCancel} title="Cancel">
              <Icon name="stop" size={18} />
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export { InlineWorkerCard };
export type { InlineWorkerCardProps };
