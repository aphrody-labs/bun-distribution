import { clsx } from "clsx";

interface InfoRowProps {
  label: string;
  value: string | number | React.ReactNode;
  mono?: boolean;
  className?: string;
}

export function InfoRow({ label, value, mono, className }: InfoRowProps) {
  return (
    <div className={clsx("flex items-start justify-between gap-3", className)}>
      <span className="text-body-small text-on-surface-variant shrink-0">
        {label}
      </span>
      <span
        className={clsx(
          "text-label-medium text-on-surface truncate text-right",
          mono && "font-code",
        )}
      >
        {value}
      </span>
    </div>
  );
}
