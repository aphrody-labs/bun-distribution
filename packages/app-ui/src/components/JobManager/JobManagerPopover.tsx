import { Popover, usePopover, CircleButton, Icon, m3FocusRing } from "@aphrody/m3-primitives";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { useState } from "react";
import { motion } from "motion/react";
import { JobList } from "./components/JobList";
import { useJobsContext } from "./hooks/JobsContext";
import { CARD_HEIGHT } from "./types";

interface JobManagerPopoverProps {
  className?: string;
}

export function JobManagerPopover({ className }: JobManagerPopoverProps) {
  const popover = usePopover();
  const [showOnlyRunning, setShowOnlyRunning] = useState(true);

  // Unified hook for job data and badge/icon
  const { activeJobCount, hasRunningJobs, jobs, pause, resume, cancel, getSpeedHistory } = useJobsContext();

  // Reset filter to "active only" when popover opens (adjusted during render, no effect)
  const [wasOpen, setWasOpen] = useState(popover.open);
  if (wasOpen !== popover.open) {
    setWasOpen(popover.open);
    if (popover.open) setShowOnlyRunning(true);
  }

  return (
    <Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
      <Popover.Trigger asChild>
        <button
          className={clsx(
            "w-full relative flex items-center gap-2 rounded-full px-2 py-1.5 text-label-large",
            "text-on-surface-variant cursor-default transition-colors duration-200 ease-standard",
            "hover:bg-on-surface/8 active:bg-on-surface/10 data-[state=open]:bg-secondary-container data-[state=open]:text-on-secondary-container",
            m3FocusRing,
            className,
          )}
        >
          <div className="size-4">
            {hasRunningJobs ? (
              <Icon name="progress_activity" size={16} className="animate-spin" />
            ) : (
              <Icon name="format_list_bulleted" size={16} />
            )}
          </div>
          <span>Jobs</span>
          {activeJobCount > 0 && (
            <span className="flex items-center justify-center min-w-4 h-4 px-1 text-label-small bg-primary text-on-primary rounded-full">
              {activeJobCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content side="top" align="start" sideOffset={8} className={clsx("w-[360px] max-h-[480px] z-50", "!p-0")}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
          <h3 className="text-title-small text-on-surface font-semibold">Tâches</h3>

          <div className="flex items-center gap-2">
            {activeJobCount > 0 && (
              <span className="text-body-large text-on-surface-variant font-medium">
                {activeJobCount} active{activeJobCount > 1 ? "s" : ""}
              </span>
            )}

            {/* Filter toggle button */}
            <CircleButton
              icon="filter_list"
              active={showOnlyRunning}
              onClick={() => setShowOnlyRunning(!showOnlyRunning)}
              title={showOnlyRunning ? "Toutes les tâches" : "Tâches actives uniquement"}
            />
          </div>
        </div>

        {/* Popover content with full job manager */}
        {popover.open && (
          <JobManagerPopoverContent
            jobs={jobs}
            showOnlyRunning={showOnlyRunning}
            setShowOnlyRunning={setShowOnlyRunning}
            pause={pause}
            resume={resume}
            cancel={cancel}
            getSpeedHistory={getSpeedHistory}
          />
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

function JobManagerPopoverContent({
  jobs,
  showOnlyRunning,
  setShowOnlyRunning: _setShowOnlyRunning,
  pause,
  resume,
  cancel,
  getSpeedHistory,
}: {
  jobs: any[];
  showOnlyRunning: boolean;
  setShowOnlyRunning: (value: boolean) => void;
  pause: (jobId: string) => Promise<void>;
  resume: (jobId: string) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  getSpeedHistory: (jobId: string) => import("./hooks/useJobs").SpeedSample[];
}) {
  const filteredJobs = showOnlyRunning ? jobs.filter(job => job.status === "running" || job.status === "paused") : jobs;

  return (
    <motion.div
      className="overflow-y-auto no-scrollbar"
      initial={false}
      animate={{
        height:
          filteredJobs.length === 0 ? CARD_HEIGHT + 16 : Math.min(filteredJobs.length * (CARD_HEIGHT + 8) + 16, 400),
      }}
      transition={{ duration: m3Durations.short4, ease: m3Easings.standard }}
    >
      <JobList
        jobs={filteredJobs}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
        getSpeedHistory={getSpeedHistory}
      />
    </motion.div>
  );
}
