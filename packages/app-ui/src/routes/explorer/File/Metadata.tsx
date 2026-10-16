import { clsx } from "clsx";
import type { File } from "@aphrody/drive-client";
import { formatBytes, formatRelativeTime } from "../utils";

interface MetadataProps {
  file: File;
  show?: Array<"size" | "modified" | "kind">;
  className?: string;
}

const DEFAULT_SHOW: NonNullable<MetadataProps["show"]> = ["size"];

export function Metadata({
  file,
  show = DEFAULT_SHOW,
  className,
}: MetadataProps) {
  return (
    <div
      className={clsx(
        "flex gap-2 text-body-small text-on-surface-variant",
        className,
      )}
    >
      {show.includes("size") && file.size > 0 && (
        <span>{formatBytes(file.size)}</span>
      )}
      {show.includes("modified") && (
        <span>{formatRelativeTime(file.modified_at)}</span>
      )}
      {show.includes("kind") && <span>{file.extension || "Folder"}</span>}
    </div>
  );
}
