// SPDX-License-Identifier: Apache-2.0
// "Model unavailable" state of a local chat: downloading, loading, or down, with an optional
// determinate M3 linear progress indicator and a retry action.

"use client";

import { clsx } from "clsx";

import { type ChatLabels, formatLabel, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";
import { CircularIndicator, focusRing } from "./internal";

export type ModelAvailabilityPhase = "downloading" | "loading" | "unavailable";

export interface ModelUnavailableProps {
  phase?: ModelAvailabilityPhase;
  /** Why the model cannot answer (backend message, already localized by the caller). */
  reason?: string;
  /** Download or load progress, 0..1; omit for an indeterminate state. */
  progress?: number | null;
  onRetry?: () => void;
  labels?: Partial<ChatLabels>;
  className?: string;
}

/** Clamp a progress fraction to 0..1; non-finite values give `null` (indeterminate). */
export function clampProgress(progress: number | null | undefined): number | null {
  if (progress === null || progress === undefined || !Number.isFinite(progress)) return null;
  return Math.min(1, Math.max(0, progress));
}

export function ModelUnavailable({
  phase = "unavailable",
  reason,
  progress,
  onRetry,
  labels,
  className,
}: ModelUnavailableProps) {
  const l = resolveChatLabels(labels);
  const value = clampProgress(progress);
  const busy = phase !== "unavailable";
  const title =
    phase === "downloading"
      ? l.modelDownloading
      : phase === "loading"
        ? l.modelLoading
        : l.modelUnavailable;
  const percent = value === null ? null : Math.round(value * 100);

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- live region wrapping block content (title, progress, action); <output> only holds phrasing content.
      role="status"
      aria-live="polite"
      aria-busy={busy || undefined}
      className={clsx(
        "m3-model-unavailable flex flex-col gap-3 rounded-large px-4 py-4",
        busy
          ? "bg-surface-container-high text-on-surface"
          : "bg-error-container text-on-error-container",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {busy ? (
          <CircularIndicator size={24} label={title} className="mt-0.5" />
        ) : (
          <ChatIcon name="cloud_off" size={24} className="mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-title-medium">{title}</p>
          {reason ? <p className="m-0 mt-1 text-body-medium opacity-90">{reason}</p> : null}
        </div>
        {percent !== null ? (
          <span className="shrink-0 text-label-large">
            {formatLabel(l.progressPercent, { percent })}
          </span>
        ) : null}
      </div>
      {busy && value !== null ? (
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 linear determinate indicator with a track gap; a native <progress> cannot be styled to the spec.
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="flex h-1 w-full items-center gap-1"
        >
          <span
            className="h-1 rounded-full bg-primary transition-[width] duration-300 ease-standard"
            style={{ width: `${(value * 100).toFixed(1)}%` }}
          />
          <span className="h-1 flex-1 rounded-full bg-secondary-container" />
        </div>
      ) : null}
      {onRetry && !busy ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className={clsx(
              "inline-flex h-10 items-center gap-2 rounded-full bg-error px-6 text-label-large text-on-error",
              "transition-colors duration-200 ease-standard hover:bg-error/92",
              focusRing,
            )}
          >
            <ChatIcon name="refresh" size={18} />
            <span>{l.retry}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
