import { Icon } from "@aphrody/m3-primitives";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { motion, AnimatePresence } from "motion/react";
import type { JobListItem } from "../types";

interface JobStatusIndicatorProps {
  job: JobListItem;
}

// Phase icons for indexer
const INDEXER_PHASES = [
  { name: "Discovery", icon: "search" },
  { name: "Processing", icon: "file_copy" },
  { name: "Content Identification", icon: "auto_awesome" },
  { name: "Finalizing", icon: "check_circle" },
];

// Phase icons for thumbnail generation
const THUMBNAIL_PHASES = [
  { name: "Discovery", icon: "search" },
  { name: "Processing", icon: "image" },
  { name: "Cleanup", icon: "check_circle" },
];

// Get phases for a job type
function getJobPhases(jobName: string) {
  if (jobName === "indexer") {
    return INDEXER_PHASES;
  }
  if (jobName === "thumbnail_generation") {
    return THUMBNAIL_PHASES;
  }
  return null;
}

// Map job names to default Material Symbols (when no phases)
function getJobIcon(jobName: string): string {
  const name = jobName.toLowerCase();
  if (name === "ocr" || name === "aphrody_ocr") return "document_scanner";
  if (name === "transcription" || name === "speech_to_text") return "graphic_eq";
  if (name === "rag_index" || name === "rag") return "hub";
  if (name === "model_download" || name === "model_pull") return "download";
  if (name === "crawler" || name === "web_crawl") return "language";
  if (name === "training" || name === "train_run") return "model_training";
  if (name === "indexer") return "search";
  if (name === "thumbnail_generation") return "image";
  if (name.includes("copy") || name.includes("move")) return "file_copy";
  if (name.includes("delete")) return "folder_open";
  return "database";
}

export function JobStatusIndicator({ job }: JobStatusIndicatorProps) {
  const phases = getJobPhases(job.name);
  const currentPhase = job.current_phase;

  // If job has phases and we know the current phase, show carousel
  if (phases && currentPhase) {
    const currentIndex = phases.findIndex(p => p.name === currentPhase);

    // Show 3 icons: previous, current, next
    const PrevIcon = phases[currentIndex - 1]?.icon;
    const CurrentIcon = phases[currentIndex]?.icon;
    const NextIcon = phases[currentIndex + 1]?.icon;

    return (
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-full overflow-hidden">
        <div className="relative h-full w-full flex flex-col items-center justify-center">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={currentIndex}
              className="flex flex-col items-center gap-2"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{
                duration: m3Durations.medium2,
                ease: m3Easings.emphasized,
              }}
            >
              {/* Previous phase (dimmed) */}
              {PrevIcon && <Icon name={PrevIcon} size={12} className="text-outline opacity-38" />}

              {/* Current phase (highlighted) */}
              {CurrentIcon && <Icon name={CurrentIcon} size={16} filled className="text-primary" />}

              {/* Next phase (dimmed) */}
              {NextIcon && <Icon name={NextIcon} size={12} className="text-outline opacity-38" />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // No phases - show single icon
  const jobIcon = getJobIcon(job.name);
  return (
    <div className="flex-shrink-0 flex items-center justify-center w-10 h-full">
      <Icon name={jobIcon} size={16} className="text-on-surface-variant" />
    </div>
  );
}
