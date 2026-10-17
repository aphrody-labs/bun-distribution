import { Icon, m3FocusRing } from "@aphrody/m3-primitives";
import { useState } from "react";
import { clsx } from "clsx";
import type { JobListItem } from "../types";
import { getJobDisplayName, formatDuration, timeAgo } from "../types";
import { JobStatusIndicator } from "../components/JobStatusIndicator";

interface JobRowProps {
  job: JobListItem;
  onPause?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
}

export function JobRow({ job, onPause, onResume, onCancel }: JobRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  const displayName = getJobDisplayName(job);
  const showActionButton = job.status === "running" || job.status === "paused";
  const canPause = job.status === "running" && onPause;
  const canResume = job.status === "paused" && onResume;
  const canCancel = (job.status === "running" || job.status === "paused") && onCancel;

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canPause) {
      onPause(job.id);
    } else if (canResume) {
      onResume(job.id);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canCancel) {
      onCancel(job.id);
    }
  };

  // Format progress percentage
  const progressPercent = Math.round(job.progress * 100);

  // Get phase and message
  const phase = job.current_phase;
  const message = job.status_message;

  // Calculate duration - prefer started_at for accuracy, fallback to created_at
  const startTime = job.started_at || job.created_at;
  const duration = startTime
    ? job.completed_at
      ? new Date(job.completed_at).getTime() - new Date(startTime).getTime()
      : // oxlint-disable-next-line react/purity -- a running job shows its elapsed time against the clock at render, as before
        Date.now() - new Date(startTime).getTime()
    : 0;

  return (
    <div
      className={clsx(
        "group relative flex items-center gap-4 px-4 py-3 border-b border-outline-variant",
        "transition-colors duration-200 ease-standard hover:bg-on-surface/8",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        <JobStatusIndicator job={job} />
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0 flex items-center gap-6">
        {/* Job name and details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-title-small mt-1 text-on-surface truncate">{displayName}</h3>
            {phase && (
              <span className="text-label-small text-on-surface-variant px-2 py-0.5 rounded-small border border-outline-variant">
                {phase}
              </span>
            )}
          </div>
          {message && <p className="text-body-small text-on-surface-variant truncate">{message}</p>}
        </div>

        {/* Progress / Duration column */}
        <div className="flex-shrink-0 w-32">
          {job.status === "running" || job.status === "paused" ? (
            // Show progress bar for active jobs
            <div className="flex items-center gap-2">
              <div
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <progress> cannot host the animated child bar; the ARIA progressbar role is kept
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                className="flex-1 h-1 bg-secondary-container rounded-full overflow-hidden"
              >
                <div
                  className={clsx(
                    "h-full rounded-full transition-[width] duration-300 ease-standard",
                    job.status === "paused" ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-label-medium text-on-surface-variant w-8 text-right">{progressPercent}%</span>
            </div>
          ) : job.status === "completed" ? (
            // Show duration for completed jobs
            <span className="text-body-small text-on-surface-variant">{formatDuration(duration)}</span>
          ) : job.status === "queued" ? (
            // Show waiting status for queued jobs
            <span className="text-body-small text-on-surface-variant">Waiting...</span>
          ) : (
            // Show dash for failed/cancelled jobs
            <span className="text-body-small text-on-surface-variant">—</span>
          )}
        </div>

        {/* Completed/Started time */}
        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-body-small text-on-surface-variant">
            {job.status === "completed" && job.completed_at
              ? timeAgo(job.completed_at)
              : job.status === "running" && job.started_at
                ? timeAgo(job.started_at)
                : job.created_at
                  ? timeAgo(job.created_at)
                  : "—"}
          </span>
        </div>

        {/* Status */}
        <div className="flex-shrink-0 w-20 text-right">
          <span
            className={clsx(
              "inline-flex items-center px-2 py-1 rounded-small text-label-medium",
              job.status === "running" && "bg-primary-container text-on-primary-container",
              job.status === "completed" && "bg-success-container text-on-success-container",
              (job.status === "failed" || job.status === "cancelled") && "bg-error-container text-on-error-container",
              job.status === "paused" && "bg-warning-container text-on-warning-container",
              job.status === "queued" && "bg-surface-container-highest text-on-surface-variant",
            )}
          >
            {job.status}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      {isHovered && (
        <div className="flex items-center gap-1">
          {showActionButton && (canPause || canResume) && (
            <button
              onClick={handleAction}
              className={clsx(
                "flex-shrink-0 flex items-center justify-center size-8 rounded-full",
                "bg-secondary-container text-on-secondary-container hover:bg-on-secondary-container/8",
                "transition-colors duration-200 ease-standard",
                m3FocusRing,
              )}
              title={canPause ? "Pause job" : "Resume job"}
            >
              {canPause ? <Icon name="pause" size={18} filled /> : <Icon name="play_arrow" size={18} filled />}
            </button>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              className={clsx(
                "flex-shrink-0 flex items-center justify-center size-8 rounded-full",
                "text-on-surface-variant hover:bg-error hover:text-on-error",
                "transition-colors duration-200 ease-standard",
                m3FocusRing,
              )}
              title="Cancel job"
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
