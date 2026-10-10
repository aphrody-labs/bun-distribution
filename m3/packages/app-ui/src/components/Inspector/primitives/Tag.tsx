import { Icon, m3FocusRing } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

interface TagProps {
  /** User-data tag colour; stays an inline style. */
  color: string;
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
  onRemove?: () => void;
}

/** M3 input chip carrying a user tag colour. */
export function Tag({ color, children, size = "sm", className, onRemove }: TagProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-small",
        size === "sm" && "h-6 px-2 text-label-medium",
        size === "md" && "h-8 px-3 text-label-large",
        className,
      )}
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span
        className={clsx("rounded-full", size === "sm" && "size-1.5", size === "md" && "size-2")}
        style={{ backgroundColor: color }}
      />
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={clsx(
            "-mr-1 ml-0.5 flex items-center justify-center rounded-full p-0.5 opacity-60 transition-opacity duration-200 ease-standard hover:bg-current/8 hover:opacity-100",
            m3FocusRing,
          )}
          aria-label="Remove tag"
        >
          <Icon name="close" size={size === "sm" ? 14 : 18} />
        </button>
      )}
    </span>
  );
}
