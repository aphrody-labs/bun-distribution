import { type IconSource, renderIcon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

interface SectionProps {
  title: string;
  icon?: IconSource;
  children: React.ReactNode;
  className?: string;
}

/** Supporting-pane section: M3 title-small header with an optional leading icon. */
export function Section({ title, icon, children, className }: SectionProps) {
  return (
    <section className={clsx("space-y-3", className)}>
      <div className="flex items-center gap-2 px-2">
        {icon !== undefined &&
          renderIcon(icon, { size: 18, className: "text-primary" })}
        <h3 className="text-title-small text-on-surface-variant">{title}</h3>
      </div>
      <div className="space-y-2 px-2">{children}</div>
    </section>
  );
}
