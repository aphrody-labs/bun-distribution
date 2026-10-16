import { Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

interface ThumbnailProps {
  src?: string;
  kind?: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const iconForKind = (kind?: string): string => {
  if (!kind) return "draft";
  const k = kind.toLowerCase();
  if (k.includes("image") || ["jpg", "png", "gif", "svg"].includes(k)) return "image";
  if (k.includes("video") || ["mp4", "mov", "avi"].includes(k)) return "movie";
  if (k.includes("audio") || ["mp3", "wav", "flac"].includes(k)) return "music_note";
  if (["js", "ts", "tsx", "jsx", "py", "rs"].includes(k)) return "code_blocks";
  if (["pdf", "txt", "md"].includes(k)) return "description";
  return "draft";
};

const sizeClasses = { sm: "size-16", md: "size-24", lg: "size-32" } as const;
const iconSizes = { sm: 32, md: 48, lg: 64 } as const;

export function Thumbnail({ src, kind, name, size = "md", className }: ThumbnailProps) {
  return (
    <div
      className={clsx(
        "relative flex items-center justify-center overflow-hidden rounded-medium border border-outline-variant bg-surface-container",
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <Icon
          name={iconForKind(kind)}
          size={iconSizes[size]}
          weight={200}
          className="text-on-surface-variant/40"
        />
      )}
    </div>
  );
}
