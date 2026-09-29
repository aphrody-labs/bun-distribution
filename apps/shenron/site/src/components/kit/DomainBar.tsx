"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DomainBarView, PublicViewLinkView } from "@shenron/ui/navigation/DomainBarView";
import { useMe } from "@/lib/use-me";
import { domainForPath, getDomain, type DomainKey } from "@/lib/domains";

/** Staff authorization and domain routing stay in the application. */
export function DomainBar({ domain, actions = [], className = "" }: {
  domain?: DomainKey;
  actions?: readonly { href: string; label: string }[];
  className?: string;
}) {
  const me = useMe();
  const pathname = usePathname();
  if (!me?.isAdmin) return null;
  const resolved = domain ? getDomain(domain) : domainForPath(pathname ?? "/");
  if (!resolved) return null;
  return <DomainBarView domainLabel={resolved.label} adminHref={resolved.adminHref} adminCta={resolved.adminCta} actions={actions} moderationHref="/admin/moderation" className={className} linkComponent={Link} />;
}

export function PublicViewLink({ domain, href, label = "Voir côté public", className = "" }: {
  domain?: DomainKey;
  href?: string;
  label?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const resolved = domain ? getDomain(domain) : domainForPath(pathname ?? "/");
  const target = href ?? resolved?.publicHref;
  if (!target) return null;
  return <PublicViewLinkView href={target} label={label} className={className} linkComponent={Link} />;
}