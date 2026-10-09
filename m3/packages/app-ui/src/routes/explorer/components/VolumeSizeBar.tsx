import { clsx } from "clsx";
import { formatBytes } from "../utils";

interface VolumeSizeBarProps {
  totalBytes: number;
  availableBytes: number;
  className?: string;
}

/**
 * Visual size bar for volumes showing used/available space
 */
export function VolumeSizeBar({ totalBytes, availableBytes, className }: VolumeSizeBarProps) {
  const usedBytes = totalBytes - availableBytes;
  const usedPercentage = (usedBytes / totalBytes) * 100;

  return (
    <div className={clsx("w-full px-2 py-1", className)}>
      {/* Size bar */}
      <div className="relative h-1.5 bg-surface-container rounded-full overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full transition-all bg-primary"
          style={{ width: `${usedPercentage}%` }}
        />
      </div>

      {/* Size text */}
      <div className="flex items-center justify-between text-[10px] text-on-surface-variant px-0.5">
        <span>{formatBytes(availableBytes)} free</span>
        <span>{formatBytes(totalBytes)}</span>
      </div>
    </div>
  );
}
