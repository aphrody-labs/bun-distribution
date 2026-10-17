import type { UiLinkComponent } from "./link";

export type DomainAction = { href: string; label: string };

export function DomainBarView({
  domainLabel,
  adminHref,
  adminCta,
  actions = [],
  moderationHref,
  staffLabel = "Staff",
  moderationLabel = "Modération",
  className = "",
  linkComponent: Link = "a",
}: {
  domainLabel: string;
  adminHref?: string | null;
  adminCta?: string | null;
  actions?: readonly DomainAction[];
  moderationHref?: string;
  staffLabel?: string;
  moderationLabel?: string;
  className?: string;
  linkComponent?: UiLinkComponent;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-dbz-orange/50 bg-dbz-orange/[0.07] px-4 py-2.5 ${className}`}
    >
      <span className="font-display text-[0.625rem] font-bold uppercase tracking-[0.16em] text-dbz-orange">
        {staffLabel} · {domainLabel}
      </span>
      {adminHref && (
        <Link
          href={adminHref}
          className="text-[0.8125rem] text-white/80 underline-offset-4 hover:text-white hover:underline"
        >
          {adminCta}
        </Link>
      )}
      {actions.map(action => (
        <Link
          key={action.href}
          href={action.href}
          className="text-[0.8125rem] text-white/80 underline-offset-4 hover:text-white hover:underline"
        >
          {action.label}
        </Link>
      ))}
      {moderationHref && (
        <Link
          href={moderationHref}
          className="ml-auto text-[0.8125rem] text-white/55 underline-offset-4 hover:text-white hover:underline"
        >
          {moderationLabel}
        </Link>
      )}
    </div>
  );
}

export function PublicViewLinkView({
  href,
  label,
  className = "",
  linkComponent: Link = "a",
}: {
  href: string;
  label: string;
  className?: string;
  linkComponent?: UiLinkComponent;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 text-[0.8125rem] text-dbz-orange underline-offset-4 hover:underline ${className}`}
    >
      {label} <span aria-hidden>↗</span>
    </Link>
  );
}
