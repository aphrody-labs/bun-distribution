import type { JobStatus } from "@aphrody/drive-client";
import { m3Easings } from "@aphrody/m3-motion";
import { motion } from "motion/react";
import { JOB_STATUS_COLORS, PROGRESS_BAR_HEIGHT } from "../types";

interface JobProgressBarProps {
  progress: number;
  status: JobStatus;
}

/**
 * M3 linear progress indicator: `secondary-container` track, full shape, active indicator in the
 * status role (primary while running, warning when paused, outline once completed). A running job
 * that has not reported progress yet shows the M3 indeterminate indicator.
 */
export function JobProgressBar({ progress, status }: JobProgressBarProps) {
  // Only show progress bar for running, paused jobs, or completed jobs with some visual feedback
  const showProgress = status === "running" || status === "paused" || status === "completed";

  if (!showProgress) {
    return <div style={{ height: PROGRESS_BAR_HEIGHT }} />;
  }

  const isCompleted = status === "completed";
  const isPending = status === "running" && progress === 0;
  // Completed jobs recede to the outline role; running/paused use their status role
  const color = isCompleted ? "var(--md-sys-color-outline-variant)" : JOB_STATUS_COLORS[status];
  const displayProgress = Math.min(Math.max(progress, 0), 1);

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <progress> cannot host the positioned indicator children (motion.div or the width-driven bar) and its native rendering would change
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isPending ? undefined : Math.round(displayProgress * 100)}
      aria-busy={isPending || undefined}
      className="relative w-full rounded-full overflow-hidden bg-secondary-container mt-1.5"
      style={{ height: PROGRESS_BAR_HEIGHT }}
    >
      {isPending ? (
        <motion.div
          className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary"
          initial={{ x: "-100%" }}
          animate={{ x: "250%" }}
          transition={{
            duration: 2,
            ease: m3Easings.standard,
            repeat: Infinity,
          }}
        />
      ) : (
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-standard-decelerate"
          style={{
            width: `${displayProgress * 100}%`,
            backgroundColor: color,
          }}
        />
      )}
    </div>
  );
}
