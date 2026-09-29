"use client";

import Link from "next/link";
import { NavMega as PortableNavMega, type MegaItem, type NavMegaIcon } from "@shenron/ui/navigation/NavMega";
import { useLangue, useRubrique } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n";
import type { ReactNode } from "react";

export type { MegaItem, NavMegaIcon };

/** Site translations and Next navigation for the portable mega menu. */
export function NavMega({ label, groupe, items, linkClass, icon }: {
  label: string;
  groupe?: keyof Dictionary["nav"];
  items: MegaItem[];
  linkClass: string;
  icon?: NavMegaIcon | ReactNode;
}) {
  const { dico } = useLangue();
  const rubrique = useRubrique();
  const translatedItems = items.map((item) => {
    const translated = rubrique(item.href, { label: item.label, note: item.blurb });
    return { ...item, label: translated.label, blurb: translated.note };
  });
  return <PortableNavMega label={groupe ? (dico.nav[groupe] ?? label) : label} items={translatedItems} linkClass={linkClass} icon={icon} linkComponent={Link} />;
}