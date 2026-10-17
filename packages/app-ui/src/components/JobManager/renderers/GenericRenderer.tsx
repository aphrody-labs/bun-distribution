// SPDX-License-Identifier: Apache-2.0
import { Icon, m3FocusRing } from "@aphrody/m3-primitives";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { motion } from "motion/react";
import type { JobRenderer, JobRendererProps } from "./index";
import { getJobDisplayName, getJobSubtext } from "../types";
import { usePlatform } from "../../../contexts/PlatformContext";

/**
 * Generic job card renderer - used for AI jobs and system jobs
 * Displays: Job name, target object, progress, controls, and completion result action ('Ouvrir', 'Afficher dans Fichiers').
 */
function GenericCardContent({
  job,
  isExpanded,
  statusBadge,
  canExpand,
  showActionButton,
  canPause,
  canResume,
  canCancel,
  onAction,
  onCancel,
}: JobRendererProps) {
  const platform = usePlatform();
  const displayName = getJobDisplayName(job);
  const subtext = getJobSubtext(job);

  const context = job.action_context?.context as Record<string, unknown> | null;
  const resultAction = context?.resultAction as
    | {
        label: "Ouvrir" | "Afficher dans Fichiers";
        action: () => void | Promise<void>;
      }
    | undefined;

  const targetPath =
    ((job.action_context?.action_input as Record<string, unknown> | null)?.path as string | undefined) ||
    (typeof job.current_path === "string" ? job.current_path : undefined);

  const handleResultClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (resultAction?.action) {
      try {
        await resultAction.action();
        return;
      } catch (err) {
        console.error("Result action failed:", err);
      }
    }

    if (targetPath) {
      if (platform.revealFile) {
        await platform.revealFile(targetPath).catch(() => {});
      } else if (platform.openPathDefault) {
        await platform.openPathDefault(targetPath).catch(() => {});
      }
    }
  };

  return (
    <>
      {/* Row 1: Title, status badge, and controls */}
      <div className="flex items-center gap-3 min-h-0">
        <span className="flex-1 truncate text-title-small text-on-surface font-medium">{displayName}</span>

        {/* Status badge */}
        <span className="flex-shrink-0 text-label-large text-on-surface-variant max-w-[120px] truncate">
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
            <Icon name="expand_more" size={18} className="text-on-surface-variant" />
          </motion.div>
        )}

        {/* Action buttons while running or hovered */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Result Action when completed: 'Ouvrir' / 'Afficher dans Fichiers' */}
          {job.status === "completed" && (
            <button
              type="button"
              onClick={handleResultClick}
              className={clsx(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label-large font-medium",
                "bg-primary text-on-primary hover:bg-primary/90 transition-all active:scale-95 shadow-sm",
                m3FocusRing,
              )}
              title={resultAction?.label || (targetPath ? "Afficher dans fichiers" : "Ouvrir")}
            >
              <Icon name={resultAction?.label === "Ouvrir" ? "open_in_new" : "folder_open"} size={16} filled />
              <span>{resultAction?.label || (targetPath ? "Afficher dans fichiers" : "Ouvrir")}</span>
            </button>
          )}

          {/* Pause / Resume buttons */}
          {showActionButton && (canPause || canResume) && (
            <button
              type="button"
              onClick={onAction}
              className={clsx(
                "flex-shrink-0 flex items-center justify-center size-7 rounded-full",
                "bg-secondary-container text-on-secondary-container hover:bg-on-secondary-container/12",
                "transition-colors duration-200 ease-standard",
                m3FocusRing,
              )}
              title={canPause ? "Mettre en pause" : "Reprendre"}
            >
              {canPause ? <Icon name="pause" size={18} filled /> : <Icon name="play_arrow" size={18} filled />}
            </button>
          )}

          {/* Cancel button */}
          {canCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={clsx(
                "flex-shrink-0 flex items-center justify-center size-7 rounded-full",
                "bg-on-surface/8 text-on-surface-variant hover:bg-error hover:text-on-error",
                "transition-colors duration-200 ease-standard",
                m3FocusRing,
              )}
              title="Annuler la tâche"
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Subtext (target object & progress) */}
      <div className="min-h-0">
        <span className="text-body-large text-on-surface-variant max-w-[280px] truncate block font-sans">
          {subtext}
        </span>
      </div>
    </>
  );
}

/**
 * Generic renderer with no details panel
 */
export const GenericRenderer: JobRenderer = {
  CardContent: GenericCardContent,
};
