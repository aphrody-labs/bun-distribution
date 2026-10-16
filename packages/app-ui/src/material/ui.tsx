// Small building blocks shared by the pages. Plain elements styled with the M3 preset utilities.
import type { CSSProperties, ReactNode } from "react";
import { PACKAGES } from "./inventory.ts";

/** Inline SVG markup from `m3:icons/*`. */
export function Svg({
  html,
  className = "",
  small = false,
  label,
}: {
  html: string;
  className?: string;
  small?: boolean;
  label?: string;
}) {
  return (
    <span
      className={`${small ? "m3-icon-sm" : "m3-icon"} inline-flex shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A package chip: name and version from the inventory. */
export function PackageChip({ name }: { name: string }) {
  const info = PACKAGES.find((p) => p.name === name);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-small border border-outline-variant px-2 py-0.5 text-label-small text-on-surface-variant"
      title={info?.description ?? name}
    >
      <span className="font-medium text-on-surface">{name}</span>
      {info ? <span>{info.version}</span> : null}
    </span>
  );
}

export function Chips({ names }: { names: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <PackageChip key={name} name={name} />
      ))}
    </div>
  );
}

/** A titled block of a page. */
export function Section({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-title-large text-on-surface">{title}</h2>
          {description ? (
            <p className="text-body-medium text-on-surface-variant">
              {description}
            </p>
          ) : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-large bg-surface-container p-4 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <pre className="m3-code m3-scroll max-h-72">{children}</pre>;
}

export function Swatch({
  name,
  value,
  on,
}: {
  name: string;
  value: string;
  on?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex h-16 items-end rounded-medium border border-outline-variant p-2 text-label-small"
        style={{ background: value, color: on }}
        title={`${name} ${value}`}
      >
        {value}
      </div>
      <span className="truncate text-label-small text-on-surface-variant">
        {name}
      </span>
    </div>
  );
}

/** A page: title, the packages it exercises, content and an optional supporting pane (wide windows). */
export function Page({
  title,
  summary,
  packages,
  children,
  aside,
  panes,
}: {
  title: string;
  summary: string;
  packages: readonly string[];
  children: ReactNode;
  aside?: ReactNode;
  panes: 1 | 2 | 3;
}) {
  const showAside = aside && panes >= 2;
  return (
    <div className="mx-auto flex w-full max-w-[1800px] gap-6 p-(--m3-gutter)">
      <article
        className="flex min-w-0 flex-1 flex-col gap-6"
        aria-labelledby="page-title"
      >
        <header className="flex flex-col gap-2">
          <h1 id="page-title" className="text-headline-large text-on-surface">
            {title}
          </h1>
          <p className="max-w-3xl text-body-large text-on-surface-variant">
            {summary}
          </p>
          <Chips names={packages} />
        </header>
        {children}
        {aside && !showAside ? (
          <div className="flex flex-col gap-4">{aside}</div>
        ) : null}
      </article>
      {showAside ? (
        <aside
          className="m3-scroll sticky top-0 hidden max-h-[calc(100vh-6rem)] w-[22rem] shrink-0 flex-col gap-4 self-start overflow-y-auto medium:flex"
          aria-label="Supporting pane"
        >
          {aside}
        </aside>
      ) : null}
    </div>
  );
}
