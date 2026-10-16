import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/** En-tête partagé des collections du wiki.
 *
 * Les listes personnages, techniques et objets doivent avoir le même rythme
 * visuel : une identité courte, une description lisible et un compteur. Garder
 * ce contrat ici évite que chaque page recrée un titre légèrement différent.
 */
export function WikiPageHeader({
  icon,
  title,
  description,
  count,
  className,
}: {
  icon: string;
  title: string;
  description: React.ReactNode;
  count?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative overflow-hidden rounded-3xl border border-outline-variant/60 bg-surface-container-low px-5 py-5 sm:px-7 sm:py-6",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-primary/10 blur-2xl"
        aria-hidden="true"
      />
      <div className="relative flex items-start gap-4">
        <div className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Icon name={icon} size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-on-surface sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-on-surface-variant">{description}</p>
        </div>
        {count != null && (
          <div className="hidden shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-on-surface-variant sm:block">
            {count}
          </div>
        )}
      </div>
    </header>
  );
}
