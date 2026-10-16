// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

export function StudioHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 border-b border-outline-variant pb-6">
      {eyebrow && <p className="text-label-large text-primary">{eyebrow}</p>}
      <h2 className="text-headline-small text-on-surface">{title}</h2>
      {subtitle && (
        <p className="text-body-large text-on-surface-variant">{subtitle}</p>
      )}
    </header>
  );
}
