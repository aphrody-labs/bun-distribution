// SPDX-License-Identifier: Apache-2.0
import { sounds } from "@aphrody/assets/sounds";
import {
  useJobs as useJobsCore,
  type UseJobsReturn,
  type ExtendedJobListItem,
} from "@aphrody/drive-client";
import { useVolumeIndexingStore } from "../../../stores/volumeIndexingStore";
import { useAphrodyJobStore } from "../../../stores/aphrodyJobStore";
import { useCallback, useEffect, useMemo, useRef } from "react";

// Global set to track which jobs have already played their completion sound
const completedJobSounds = new Set<string>();

// Global throttle to prevent multiple sounds within 5 seconds
let lastSoundPlayedAt = 0;
const SOUND_THROTTLE_MS = 5000;

/**
 * Desktop-specific wrapper around useJobs that combines:
 * - Spacedrive core jobs (daemon queries and events)
 * - Aphrody AI jobs (OCR, transcription, indexation, crawlers, models, training)
 * - Volume indexing tracking integration
 * - Sound system for job completion
 */
export function useJobs(): UseJobsReturn {
  const { setVolumeJob, clearVolumeJob } = useVolumeIndexingStore();
  const aphrodyJobs = useAphrodyJobStore((s) => s.jobs);
  const pauseAphrodyJob = useAphrodyJobStore((s) => s.pauseJob);
  const resumeAphrodyJob = useAphrodyJobStore((s) => s.resumeJob);
  const cancelAphrodyJob = useAphrodyJobStore((s) => s.cancelJob);

  const jobs = useJobsCore({
    onJobCompleted: (jobId, jobType) => {
      if (!completedJobSounds.has(jobId)) {
        completedJobSounds.add(jobId);

        const now = Date.now();
        if (now - lastSoundPlayedAt >= SOUND_THROTTLE_MS) {
          lastSoundPlayedAt = now;
          if (jobType?.includes("copy") || jobType?.includes("Copy")) {
            sounds.copy();
          } else {
            sounds.jobDone();
          }
        }

        setTimeout(() => completedJobSounds.delete(jobId), 5000);
      }
    },
  });

  // Play completion sound for Aphrody AI jobs
  useEffect(() => {
    aphrodyJobs.forEach((aj) => {
      if (aj.status === "completed" && !completedJobSounds.has(aj.id)) {
        completedJobSounds.add(aj.id);
        const now = Date.now();
        if (now - lastSoundPlayedAt >= SOUND_THROTTLE_MS) {
          lastSoundPlayedAt = now;
          sounds.jobDone();
        }
        setTimeout(() => completedJobSounds.delete(aj.id), 5000);
      }
    });
  }, [aphrodyJobs]);

  // Map Aphrody AI jobs to ExtendedJobListItem structure
  const mappedAphrodyJobs: ExtendedJobListItem[] = useMemo(() => {
    return aphrodyJobs.map(
      (aj) =>
        ({
          id: aj.id,
          device_id: "0",
          action_type: aj.name,
          name: aj.name,
          status: aj.status as any,
          progress: aj.progress,
          created_at: aj.created_at,
          started_at: aj.created_at,
          completed_at: aj.completed_at ?? null,
          status_message: aj.status_message,
          current_path: aj.targetPath || aj.target,
          action_context: {
            action_type: aj.name,
            action_input: {
              target: aj.target,
              path: aj.targetPath ?? null,
            },
            initiated_at: aj.created_at,
            initiated_by: "User" as any,
            context: {
              target_name: aj.target,
              display_name: aj.displayName,
              resultAction: aj.resultAction,
              error: aj.error,
            },
          } as any,
        }) as unknown as ExtendedJobListItem,
    );
  }, [aphrodyJobs]);

  // Combined list of Spacedrive daemon jobs and Aphrody AI jobs
  const combinedJobs = useMemo(() => {
    return [...mappedAphrodyJobs, ...jobs.jobs];
  }, [mappedAphrodyJobs, jobs.jobs]);

  const combinedActiveCount = useMemo(() => {
    return combinedJobs.filter(
      (j) =>
        j.status === "running" ||
        j.status === "paused" ||
        j.status === "queued",
    ).length;
  }, [combinedJobs]);

  const combinedHasRunning = useMemo(() => {
    return combinedJobs.some((j) => j.status === "running");
  }, [combinedJobs]);

  const handlePause = useCallback(
    async (jobId: string) => {
      if (aphrodyJobs.some((j) => j.id === jobId)) {
        await pauseAphrodyJob(jobId);
      } else {
        await jobs.pause(jobId);
      }
    },
    [aphrodyJobs, pauseAphrodyJob, jobs],
  );

  const handleResume = useCallback(
    async (jobId: string) => {
      if (aphrodyJobs.some((j) => j.id === jobId)) {
        await resumeAphrodyJob(jobId);
      } else {
        await jobs.resume(jobId);
      }
    },
    [aphrodyJobs, resumeAphrodyJob, jobs],
  );

  const handleCancel = useCallback(
    async (jobId: string) => {
      if (aphrodyJobs.some((j) => j.id === jobId)) {
        await cancelAphrodyJob(jobId);
      } else {
        await jobs.cancel(jobId);
      }
    },
    [aphrodyJobs, cancelAphrodyJob, jobs],
  );

  const handleGetSpeedHistory = useCallback(
    (jobId: string) => {
      if (aphrodyJobs.some((j) => j.id === jobId)) {
        return [];
      }
      return jobs.getSpeedHistory(jobId);
    },
    [aphrodyJobs, jobs],
  );

  // Ref for stable jobs access
  const jobsRef = useRef(jobs.jobs);
  useEffect(() => {
    jobsRef.current = jobs.jobs;
  }, [jobs.jobs]);

  // Track volume indexing jobs
  useEffect(() => {
    jobs.jobs.forEach((job) => {
      if (job.name === "indexer" && job.status === "running") {
        const context = job.action_context?.context as any;
        const volumeFingerprint = context?.volume_fingerprint;
        if (volumeFingerprint && typeof volumeFingerprint === "string") {
          setVolumeJob(volumeFingerprint, job.id);
        }
      }
    });
  }, [jobs.jobs, setVolumeJob]);

  // Clear volume jobs on completion/failure/cancellation
  useEffect(() => {
    const runningIndexerJobs = jobs.jobs.filter(
      (j) => j.name === "indexer" && j.status === "running",
    );

    jobsRef.current.forEach((prevJob) => {
      if (
        prevJob.name === "indexer" &&
        !runningIndexerJobs.find((j) => j.id === prevJob.id)
      ) {
        const context = prevJob.action_context?.context as any;
        const volumeFingerprint = context?.volume_fingerprint;
        if (volumeFingerprint && typeof volumeFingerprint === "string") {
          clearVolumeJob(volumeFingerprint);
        }
      }
    });
  }, [jobs.jobs, clearVolumeJob]);

  return {
    jobs: combinedJobs,
    activeJobCount: combinedActiveCount,
    hasRunningJobs: combinedHasRunning,
    pause: handlePause,
    resume: handleResume,
    cancel: handleCancel,
    isLoading: jobs.isLoading,
    error: jobs.error,
    getSpeedHistory: handleGetSpeedHistory,
  };
}
