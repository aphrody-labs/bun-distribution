interface SourceDataRowProps {
  title: string;
  preview?: string | null;
  subtitle?: string | null;
  date?: string | null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function cleanPreview(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function SourceDataRow({
  title,
  preview,
  subtitle,
  date,
}: SourceDataRowProps) {
  return (
    <div className="hover:bg-on-surface/8 flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-small px-3 py-2.5 transition-colors">
      {/* Title row */}
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-on-surface min-w-0 flex-1 truncate text-body-medium">
          {title}
        </span>
        {date && (
          <span className="text-outline shrink-0 text-[11px]">
            {formatDate(date)}
          </span>
        )}
      </div>
      {subtitle && (
        <p className="text-outline truncate text-body-small">{subtitle}</p>
      )}
      {preview && (
        <p className="text-outline/70 truncate text-body-small">
          {cleanPreview(preview)}
        </p>
      )}
    </div>
  );
}
