import { Button, Icon, Switch } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

/**
 * Material Design 3 building blocks shared by the settings pages: a page header, list sections
 * (section header in `title-small` over a `surface-container-low` list), two-line list items
 * with trailing switches, notices on the container roles and the save action.
 */

export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <header className="space-y-1">
      <h2 className="text-on-surface text-headline-small">{title}</h2>
      {description && (
        <p className="text-on-surface-variant text-body-medium">
          {description}
        </p>
      )}
    </header>
  );
}

export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

export function SettingsSection({
  title,
  children,
  footer,
  className,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("space-y-2", className)}>
      {title && <h3 className="text-primary px-4 text-title-small">{title}</h3>}
      <div className="bg-surface-container-low divide-outline-variant overflow-hidden rounded-large divide-y">
        {children}
      </div>
      {footer && (
        <div className="text-on-surface-variant px-4 text-body-small">
          {footer}
        </div>
      )}
    </section>
  );
}

/** M3 list item: headline, supporting text and a trailing element (min 56 dp two-line). */
export function SettingsItem({
  label,
  description,
  trailing,
  children,
  htmlFor,
}: {
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
}) {
  const Headline = htmlFor ? "label" : "div";
  return (
    <div className="flex min-h-14 flex-col justify-center gap-3 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <Headline htmlFor={htmlFor} className="min-w-0">
          <span className="text-on-surface block text-body-large">{label}</span>
          {description && (
            <span className="text-on-surface-variant block text-body-medium">
              {description}
            </span>
          )}
        </Headline>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/** A boolean form field rendered as an M3 list item with a trailing switch. */
export function SettingsSwitch<T extends FieldValues>({
  control,
  name,
  label,
  description,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: ReactNode;
  description?: ReactNode;
}) {
  const id = `settings-${String(name)}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SettingsItem
          htmlFor={id}
          label={label}
          description={description}
          trailing={
            <Switch
              id={id}
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              icons
            />
          }
        />
      )}
    />
  );
}

/** Inline notice on an M3 container role. */
export function SettingsNotice({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "error" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={clsx(
        "flex items-start gap-3 rounded-medium px-4 py-3 text-body-medium",
        tone === "warning" && "bg-warning-container text-on-warning-container",
        tone === "error" && "bg-error-container text-on-error-container",
        tone === "info" && "bg-secondary-container text-on-secondary-container",
      )}
    >
      <Icon
        name={tone === "error" ? "error" : tone === "info" ? "info" : "warning"}
        size={20}
        className="mt-px"
      />
      <p>{children}</p>
    </div>
  );
}

/** Filled M3 button that submits the page form. */
export function SettingsSaveButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" variant="filled" size="lg" disabled={pending}>
      {pending ? "Saving..." : "Save changes"}
    </Button>
  );
}

/** Native select styled as a dense M3 outlined field (keeps `register()` working). */
export const settingsSelectClassName = clsx(
  "bg-surface-container-highest text-on-surface h-10 w-full rounded-extra-small border border-outline px-3 text-body-large",
  "transition-colors duration-200 ease-standard hover:border-on-surface",
  "focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2",
);
