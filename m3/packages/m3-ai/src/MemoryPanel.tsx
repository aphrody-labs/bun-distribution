// SPDX-License-Identifier: Apache-2.0
// Memory panel: the agent's saved memories as an M3 list, with per-item deletion and a
// "clear all" action guarded by an inline confirmation (or an injected one).

"use client";

import { CircleButton } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useMemo, useState } from "react";

import { type ChatLabels, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";
import { CircularIndicator, focusRing } from "./internal";

export interface MemoryItem {
  id: string;
  content: string;
  tags?: string[];
  /** ISO string, epoch milliseconds or Date. */
  createdAt: string | number | Date;
}

export interface MemoryPanelProps {
  memories: readonly MemoryItem[];
  loading?: boolean;
  onDelete?: (id: string) => void;
  /** Shows "clear all". */
  onClear?: () => void;
  /**
   * Replaces the built-in inline confirmation of "clear all" (e.g. an app dialog):
   * resolve `true` to clear.
   */
  confirmClear?: () => boolean | Promise<boolean>;
  labels?: Partial<ChatLabels>;
  locale?: string;
  formatDate?: (createdAt: Date) => string;
  className?: string;
}

const textButton = clsx(
  "inline-flex h-10 items-center rounded-full px-3 text-label-large",
  "transition-colors duration-200 ease-standard",
  focusRing,
);

export function MemoryPanel({
  memories,
  loading = false,
  onDelete,
  onClear,
  confirmClear,
  labels,
  locale,
  formatDate,
  className,
}: MemoryPanelProps) {
  const l = resolveChatLabels(labels);
  const [confirming, setConfirming] = useState(false);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const format = (value: string | number | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return formatDate ? formatDate(date) : dateFormat.format(date);
  };

  const requestClear = async () => {
    if (!onClear) return;
    if (confirmClear) {
      if (await confirmClear()) onClear();
      return;
    }
    setConfirming(true);
  };

  return (
    <section
      aria-label={l.memory}
      aria-busy={loading || undefined}
      className={clsx(
        "m3-memory-panel flex min-h-0 flex-col gap-2 rounded-large bg-surface-container-low py-3 text-on-surface",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 px-4">
        <h2 className="m-0 text-title-medium">{l.memory}</h2>
        {onClear && memories.length > 0 && !confirming ? (
          <button
            type="button"
            onClick={() => void requestClear()}
            className={clsx(textButton, "text-error hover:bg-error/8")}
          >
            {l.clearMemory}
          </button>
        ) : null}
      </header>
      {confirming ? (
        <div
          role="alertdialog"
          aria-label={l.clearMemory}
          className="mx-4 flex flex-col gap-2 rounded-medium bg-error-container px-4 py-3 text-on-error-container"
        >
          <p className="m-0 text-body-medium">{l.clearMemoryConfirm}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={clsx(textButton, "hover:bg-on-error-container/8")}
            >
              {l.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onClear?.();
              }}
              className={clsx(textButton, "bg-error px-4 text-on-error hover:bg-error/92")}
            >
              {l.confirm}
            </button>
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="flex justify-center py-6">
          <CircularIndicator size={24} label={l.memoryLoading} />
        </div>
      ) : memories.length === 0 ? (
        <p className="m-0 px-4 py-6 text-center text-body-medium text-on-surface-variant">
          {l.memoryEmpty}
        </p>
      ) : (
        <ul className="m-0 flex min-h-0 list-none flex-col overflow-y-auto p-0">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="group flex items-start gap-3 px-4 py-2 transition-colors duration-200 ease-standard hover:bg-on-surface/8"
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 text-body-medium break-words whitespace-pre-wrap text-on-surface">
                  {memory.content}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <time className="text-label-small text-on-surface-variant">
                    {format(memory.createdAt)}
                  </time>
                  {memory.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex h-6 items-center rounded-small border border-outline-variant px-2 text-label-small text-on-surface-variant"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {onDelete ? (
                <CircleButton
                  icon={<ChatIcon name="delete" size={18} />}
                  variant="standard"
                  size="sm"
                  onClick={() => onDelete(memory.id)}
                  aria-label={l.deleteMemory}
                  title={l.deleteMemory}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
