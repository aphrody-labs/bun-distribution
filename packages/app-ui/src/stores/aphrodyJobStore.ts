// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";

export type AphrodyJobType =
  | "ocr"
  | "transcription"
  | "rag_index"
  | "model_download"
  | "crawler"
  | "training"
  | "thumbnail_generation"
  | "files.copy"
  | "files.move";

export interface AphrodyJobResultAction {
  label: "Ouvrir" | "Afficher dans Fichiers" | "Hôtes distants" | string;
  action: () => void | Promise<void>;
}

export interface AphrodyJob {
  id: string;
  name: AphrodyJobType | string;
  displayName: string;
  target: string;
  targetPath?: string;
  status:
    "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  progress: number; // 0 to 1
  status_message?: string;
  created_at: string;
  completed_at?: string;
  resultAction?: AphrodyJobResultAction;
  error?: string;
}

export interface AphrodyJobStoreState {
  jobs: AphrodyJob[];

  addJob: (job: Omit<AphrodyJob, "id" | "created_at">) => string;
  updateProgress: (id: string, progress: number, message?: string) => void;
  completeJob: (id: string, resultAction?: AphrodyJobResultAction) => void;
  failJob: (id: string, error?: string) => void;
  pauseJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  removeJob: (id: string) => void;
  clearCompleted: () => void;
  getJob: (id: string) => AphrodyJob | undefined;
}

export const useAphrodyJobStore = create<AphrodyJobStoreState>((set, get) => ({
  jobs: [],

  addJob: (jobInput) => {
    const id = `aphrody-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newJob: AphrodyJob = {
      ...jobInput,
      id,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      jobs: [newJob, ...state.jobs],
    }));

    return id;
  },

  updateProgress: (id, progress, message) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              progress: Math.min(Math.max(progress, 0), 1),
              ...(message !== undefined ? { status_message: message } : {}),
            }
          : job,
      ),
    }));
  },

  completeJob: (id, resultAction) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              status: "completed",
              progress: 1.0,
              completed_at: new Date().toISOString(),
              status_message: "Terminé",
              ...(resultAction ? { resultAction } : {}),
            }
          : job,
      ),
    }));
  },

  failJob: (id, error) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              status: "failed",
              status_message: error || "Échec de l'opération",
              error,
            }
          : job,
      ),
    }));
  },

  pauseJob: async (id) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? { ...job, status: "paused", status_message: "En pause" }
          : job,
      ),
    }));
  },

  resumeJob: async (id) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? { ...job, status: "running", status_message: "En cours" }
          : job,
      ),
    }));
  },

  cancelJob: async (id) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              status: "cancelled",
              status_message: "Annulé",
              completed_at: new Date().toISOString(),
            }
          : job,
      ),
    }));
  },

  removeJob: (id) => {
    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== id),
    }));
  },

  clearCompleted: () => {
    set((state) => ({
      jobs: state.jobs.filter(
        (job) => job.status !== "completed" && job.status !== "cancelled",
      ),
    }));
  },

  getJob: (id) => {
    return get().jobs.find((job) => job.id === id);
  },
}));
