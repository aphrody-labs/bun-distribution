import { useState } from "react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { motion, AnimatePresence } from "motion/react";
import type { JobListItem } from "../types";
import type { SpeedSample } from "../hooks/useJobs";
import { CARD_HEIGHT, getStatusBadge } from "../types";
import { JobStatusIndicator } from "./JobStatusIndicator";
import { JobProgressBar } from "./JobProgressBar";
import { getJobRenderer } from "../renderers";

interface JobCardProps {
  job: JobListItem;
  onPause?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  getSpeedHistory?: (jobId: string) => SpeedSample[];
}

export function JobCard({
  job,
  onPause,
  onResume,
  onCancel,
  getSpeedHistory,
}: JobCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get the renderer for this job type
  const renderer = getJobRenderer(job.name);
  const statusBadge = getStatusBadge(job);

  const showActionButton = job.status === "running" || job.status === "paused";
  const canPause = job.status === "running" && !!onPause;
  const canResume = job.status === "paused" && !!onResume;
  const canCancel =
    (job.status === "running" || job.status === "paused") && !!onCancel;

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

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Check if this job can expand (has a details panel)
  const canExpand = !!renderer.DetailsPanel;

  return (
    <motion.div
      layout
      className="rounded-medium border border-outline-variant bg-surface-container-low overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="flex cursor-pointer transition-colors duration-200 ease-standard hover:bg-on-surface/8"
        style={{ height: CARD_HEIGHT }}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- la zone contient du contenu flow (divs, barre de progression) : un <button> natif serait invalide ; rôle, tabIndex et clavier sont explicites
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          // Only the card itself: keys pressed on the nested action buttons must not toggle it.
          if (
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            toggleExpanded();
          }
        }}
      >
        {/* Left icon area */}
        <JobStatusIndicator job={job} />

        {/* Divider line */}
        <div className="w-px bg-outline-variant" />

        {/* Content column */}
        <div className="flex-1 flex flex-col gap-2 p-3.5 min-h-0">
          {/* Custom content (delegated to renderer) */}
          <renderer.CardContent
            job={job}
            isExpanded={isExpanded}
            statusBadge={statusBadge}
            canExpand={canExpand}
            isHovered={isHovered}
            showActionButton={showActionButton}
            canPause={canPause}
            canResume={canResume}
            canCancel={canCancel}
            onAction={handleAction}
            onCancel={handleCancel}
          />

          {/* Progress bar (always at bottom) */}
          <JobProgressBar progress={job.progress} status={job.status} />
        </div>
      </div>

      {/* Expanded details section - only if renderer provides DetailsPanel */}
      <AnimatePresence>
        {isExpanded && renderer.DetailsPanel && getSpeedHistory && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: {
                duration: m3Durations.medium2,
                ease: m3Easings.emphasizedDecelerate,
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                duration: m3Durations.short3,
                ease: m3Easings.emphasizedAccelerate,
              },
            }}
            className="overflow-hidden"
          >
            <div className="border-t border-outline-variant">
              <renderer.DetailsPanel
                job={job}
                speedHistory={getSpeedHistory(job.id)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
