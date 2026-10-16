import { Icon, m3FocusRing } from "@aphrody/m3-primitives";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { motion } from "motion/react";
import type {
  JobRenderer,
  JobRendererProps,
  JobDetailsRendererProps,
} from "./index";
import { CopyJobDetails } from "../components/CopyJobDetails";

/**
 * Map strategy name to display label (enables i18n in future)
 */
function getStrategyLabel(
  strategyName: string | undefined,
  _isMove: boolean,
): string | null {
  if (!strategyName) return null;

  switch (strategyName) {
    case "RemoteTransfer":
      return "Network";
    case "LocalMove":
      return "Atomic";
    case "FastCopy":
      return "Fast";
    case "LocalStream":
      return "Streaming";
    default:
      return strategyName;
  }
}

/**
 * Extract first filename from copy job for display
 */
function extractFirstFileName(job: JobRendererProps["job"]): string {
  const actionInput = job.action_context?.action_input;
  if (
    typeof actionInput === "object" &&
    actionInput !== null &&
    "sources" in actionInput
  ) {
    const sources = actionInput.sources;
    if (
      typeof sources === "object" &&
      sources !== null &&
      "paths" in sources &&
      Array.isArray(sources.paths) &&
      sources.paths.length > 0
    ) {
      const firstPath = sources.paths[0];
      if (
        typeof firstPath === "object" &&
        firstPath !== null &&
        "Physical" in firstPath
      ) {
        const physical = firstPath.Physical;
        if (
          typeof physical === "object" &&
          physical !== null &&
          "path" in physical
        ) {
          const path = String(physical.path);
          return path.split("/").pop() || path;
        }
      }
    }
  }
  return "items";
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Format speed (bytes/sec) to human readable
 */
function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Format duration from seconds to human readable
 */
function formatDurationSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);

  if (hrs > 0) {
    return `${hrs}h ${mins % 60}m`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${Math.floor(seconds)}s`;
}

/**
 * Custom card content for file copy jobs
 * Renders the full card content: title row + subtext row
 */
function FileCopyCardContent({
  job,
  isExpanded,
  statusBadge,
  canExpand,
  isHovered,
  showActionButton,
  canPause,
  canResume,
  canCancel,
  onAction,
  onCancel,
}: JobRendererProps) {
  const generic = job.generic_progress;
  const metadata = (generic as any)?.metadata as any;
  const strategyName = metadata?.strategy?.strategy_name;
  const strategyLabel = getStrategyLabel(
    strategyName,
    job.action_context?.action_type === "files.move",
  );

  // Determine if this is a move operation
  const isMove = job.action_context?.action_type === "files.move";

  // Check if this is a cross-device transfer from metadata
  const isCrossDevice = metadata?.strategy?.is_cross_device === true;

  // Calculate title
  const fileCount = generic?.completion?.total || 0;
  const fileName = extractFirstFileName(job);
  const baseTitle =
    fileCount > 1
      ? `${isMove ? "Moving" : "Copying"} ${fileCount} items`
      : `${isMove ? "Moving" : "Copying"} '${fileName}'`;

  const title = isCrossDevice ? `${baseTitle} to another device` : baseTitle;

  // Calculate rich subtext with progress, speed, and ETA
  const completed = generic?.completion?.completed || 0;
  const speed = generic?.performance?.rate
    ? formatSpeed(generic.performance.rate)
    : null;
  const eta = generic?.performance?.estimated_remaining
    ? formatDurationSeconds(generic.performance.estimated_remaining.secs)
    : null;

  const subtext =
    job.status === "running" && speed && eta
      ? `${completed}/${fileCount} files • ${speed} • ${eta} remaining`
      : job.status === "running"
        ? `${completed}/${fileCount} files`
        : job.status === "completed"
          ? "Completed"
          : job.status === "failed"
            ? "Failed"
            : job.status === "paused"
              ? "Paused"
              : "Preparing...";

  return (
    <>
      {/* Row 1: Title, badges, status badge, and controls */}
      <div className="flex items-center gap-3 min-h-0">
        <span className="flex-1 truncate text-title-small text-on-surface">
          {title}
        </span>

        {/* Transfer method badge */}
        {strategyLabel && (
          <span className="px-1.5 py-0.5 text-label-small text-on-surface-variant border border-outline-variant rounded-small whitespace-nowrap">
            {strategyLabel}
          </span>
        )}

        {/* Status badge */}
        <span className="flex-shrink-0 text-label-medium text-on-surface-variant max-w-[80px] truncate">
          {statusBadge}
        </span>

        {/* Expansion caret */}
        {canExpand && (
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{
              duration: m3Durations.short3,
              ease: m3Easings.standard,
            }}
            className="flex-shrink-0"
          >
            <Icon
              name="expand_more"
              size={16}
              className="text-on-surface-variant"
            />
          </motion.div>
        )}

        {/* Action buttons */}
        {isHovered && (
          <div className="flex items-center gap-1">
            {showActionButton && (canPause || canResume) && (
              <button
                onClick={onAction}
                className={clsx(
                  "flex-shrink-0 flex items-center justify-center size-5 rounded-full",
                  "bg-secondary-container text-on-secondary-container hover:bg-on-secondary-container/8",
                  "transition-colors duration-200 ease-standard",
                  m3FocusRing,
                )}
                title={canPause ? "Pause job" : "Resume job"}
              >
                {canPause ? (
                  <Icon name="pause" size={14} filled />
                ) : (
                  <Icon name="play_arrow" size={14} filled />
                )}
              </button>
            )}
            {canCancel && (
              <button
                onClick={onCancel}
                className={clsx(
                  "flex-shrink-0 flex items-center justify-center size-5 rounded-full",
                  "bg-on-surface/8 text-on-surface-variant hover:bg-error hover:text-on-error",
                  "transition-colors duration-200 ease-standard",
                  m3FocusRing,
                )}
                title="Cancel job"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Row 2: Rich subtext */}
      <div className="min-h-0">
        <span className="text-label-small text-on-surface-variant max-w-[200px] truncate block">
          {subtext}
        </span>
      </div>
    </>
  );
}

/**
 * Details panel for expanded file copy jobs
 */
function FileCopyDetailsPanel({ job, speedHistory }: JobDetailsRendererProps) {
  return <CopyJobDetails job={job} speedHistory={speedHistory} />;
}

/**
 * File copy job renderer with rich UI
 */
export const FileCopyRenderer: JobRenderer = {
  CardContent: FileCopyCardContent,
  DetailsPanel: FileCopyDetailsPanel,
};
