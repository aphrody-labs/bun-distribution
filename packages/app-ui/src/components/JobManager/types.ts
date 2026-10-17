import type { JsonValue, ExtendedJobListItem, GenericProgress } from "@aphrody/drive-client";

// Re-export for backwards compatibility
export type JobListItem = ExtendedJobListItem;
export type { GenericProgress };

/** M3 color role per job status (CSS values resolved against the active scheme). */
export const JOB_STATUS_COLORS = {
  running: "var(--md-sys-color-primary)",
  completed: "var(--md-ext-color-success)",
  failed: "var(--md-sys-color-error)",
  paused: "var(--md-ext-color-warning)",
  queued: "var(--md-sys-color-outline)",
  cancelled: "var(--md-sys-color-error)",
} as const;

export const CARD_HEIGHT = 72; // px
export const STATUS_DOT_SIZE = 8; // px
export const PROGRESS_BAR_HEIGHT = 12; // px

/**
 * Extracts a meaningful display name from the job's action context
 */
export function getJobDisplayName(job: JobListItem): string {
  const customDisplayName = (job.action_context?.context as Record<string, unknown> | null)?.display_name;
  if (customDisplayName && typeof customDisplayName === "string") {
    return customDisplayName;
  }

  const jobName = job.name.toLowerCase();
  if (jobName === "ocr" || jobName === "aphrody_ocr") return "Extraction de texte";
  if (jobName === "transcription" || jobName === "speech_to_text") return "Transcription audio";
  if (jobName === "rag_index" || jobName === "rag") return "Indexation RAG";
  if (jobName === "model_download" || jobName === "model_pull") return "Téléchargement modèle";
  if (jobName === "crawler" || jobName === "web_crawl") return "Exploration web";
  if (jobName === "training" || jobName === "train_run") return "Entraînement";
  if (jobName === "indexer") return "Indexation";
  if (jobName === "thumbnail_generation") return "Génération de miniatures";

  if (!job.action_context?.action_type) {
    return job.name
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  const { action_type, action_input } = job.action_context;

  try {
    switch (action_type) {
      case "ocr":
      case "aphrody_ocr":
        return "Extraction de texte";
      case "transcription":
      case "speech_to_text":
        return "Transcription audio";
      case "rag_index":
      case "rag":
        return "Indexation RAG";
      case "model_download":
        return "Téléchargement modèle";
      case "crawler":
        return "Exploration web";
      case "training":
        return "Entraînement";
      case "locations.add": {
        const path = extractPath(action_input);
        if (path) {
          const homePath = path.replace(/^\/Users\/[^/]+/, "~");
          return `Emplacement ajouté : ${homePath}`;
        }
        break;
      }
      case "files.copy": {
        const source = extractSourcePath(action_input);
        if (source) {
          const fileName = source.split("/").pop() || source;
          return `Copie de '${fileName}'`;
        }
        break;
      }
      case "files.move": {
        const source = extractSourcePath(action_input);
        if (source) {
          const fileName = source.split("/").pop() || source;
          return `Déplacement de '${fileName}'`;
        }
        break;
      }
      case "files.delete": {
        const target = extractTargetPath(action_input);
        if (target) {
          const fileName = target.split("/").pop() || target;
          return `Suppression de '${fileName}'`;
        }
        break;
      }
      case "media.thumbnail":
        return "Génération de miniatures";
      case "media.extract":
        return "Extraction média";
      case "indexing.start":
        return "Indexation d'emplacement";
      case "volumes.index": {
        const context = job.action_context?.context as Record<string, unknown> | null;
        const volumeName = context?.volume_name;
        if (volumeName && typeof volumeName === "string") {
          return `Indexation ${volumeName}`;
        }
        return "Indexation de volume";
      }
      default: {
        return action_type
          .split(".")
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
      }
    }
  } catch (error) {
    console.warn("Failed to extract display name from action context:", error);
  }

  return job.name;
}

/**
 * Gets the subtext to display below the job title (target object and progress/status)
 */
export function getJobSubtext(job: JobListItem): string {
  const context = job.action_context?.context as Record<string, unknown> | null;
  const targetName =
    (context?.target_name as string) ||
    (job.action_context?.action_input ? extractPath(job.action_context.action_input) : null) ||
    (typeof job.current_path === "string" ? job.current_path.split(/[/\\]/).pop() : null);

  const prefix = targetName ? `${targetName} • ` : "";

  switch (job.status) {
    case "running": {
      if (job.status_message) return `${prefix}${job.status_message}`;
      if (job.current_phase) return `${prefix}${job.current_phase}`;
      return `${prefix}${job.progress > 0 ? `${Math.round(job.progress * 100)} %` : "En cours..."}`;
    }
    case "completed":
      return `${prefix}Terminé`;
    case "failed":
      return `${prefix}Échec`;
    case "queued":
      return `${prefix}En attente`;
    case "paused":
      return `${prefix}En pause`;
    case "cancelled":
      return `${prefix}Annulé`;
    default:
      return prefix || "";
  }
}

/**
 * Gets the status badge text (shown on the right side)
 */
export function getStatusBadge(job: JobListItem): string {
  switch (job.status) {
    case "running":
      return `${Math.round(job.progress * 100)}%`;
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "paused":
      return "Paused";
    case "queued":
      return "Queued";
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

/**
 * Formats duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Formats a date to time ago (e.g., "2m ago", "1h ago")
 */
export function timeAgo(date: string | Date | undefined): string {
  if (!date) return "—";

  const now = new Date();
  const past = typeof date === "string" ? new Date(date) : date;

  // Check if date is valid
  if (isNaN(past.getTime())) return "—";

  const diffMs = now.getTime() - past.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

// Helper functions to extract paths from JsonValue
function extractPath(input: JsonValue): string | null {
  if (typeof input === "object" && input !== null && "path" in input) {
    const path = input.path;
    // Handle Physical path: { Physical: { device_slug: "...", path: "..." } }
    if (typeof path === "object" && path !== null && "Physical" in path) {
      const physical = path.Physical;
      if (typeof physical === "object" && physical !== null && "path" in physical) {
        return String(physical.path);
      }
    }
    // Handle Local path: { Local: { path: "..." } }
    if (typeof path === "object" && path !== null && "Local" in path) {
      const local = path.Local;
      if (typeof local === "object" && local !== null && "path" in local) {
        return String(local.path);
      }
    }
    // Handle direct string path
    if (typeof path === "string") {
      return path;
    }
  }
  return null;
}

function extractSourcePath(input: JsonValue): string | null {
  if (typeof input === "object" && input !== null && "source" in input) {
    return String(input.source);
  }
  if (typeof input === "object" && input !== null && "sources" in input) {
    const sources = input.sources;
    if (
      typeof sources === "object" &&
      sources !== null &&
      "paths" in sources &&
      Array.isArray(sources.paths) &&
      sources.paths.length > 0
    ) {
      const firstPath = sources.paths[0];
      if (typeof firstPath === "object" && firstPath !== null && "Local" in firstPath) {
        const local = firstPath.Local;
        if (typeof local === "object" && local !== null && "path" in local) {
          return String(local.path);
        }
      }
    }
  }
  return null;
}

function extractTargetPath(input: JsonValue): string | null {
  if (typeof input === "object" && input !== null && "target" in input) {
    return String(input.target);
  }
  if (typeof input === "object" && input !== null && "targets" in input) {
    const targets = input.targets;
    if (
      typeof targets === "object" &&
      targets !== null &&
      "paths" in targets &&
      Array.isArray(targets.paths) &&
      targets.paths.length > 0
    ) {
      return String(targets.paths[0]);
    }
  }
  return null;
}
