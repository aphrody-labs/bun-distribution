// SPDX-License-Identifier: Apache-2.0
"use client";

import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { useNextMigrateContext } from "./provider";

export type UrlObject = {
  pathname?: string;
  query?: Record<string, string | number | boolean>;
  hash?: string;
};

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | UrlObject;
  as?: string | UrlObject;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  passHref?: boolean;
  shallow?: boolean;
  legacyBehavior?: boolean;
  children?: ReactNode;
}

function resolveHrefString(href: string | UrlObject): string {
  if (typeof href === "string") return href;
  const path = href.pathname || "/";
  const params = href.query ? new URLSearchParams(href.query as Record<string, string>).toString() : "";
  const hash = href.hash ? (href.hash.startsWith("#") ? href.hash : `#${href.hash}`) : "";
  const query = params ? `?${params}` : "";
  return `${path}${query}${hash}`;
}

function isExternalUrl(url: string): boolean {
  return /^(https?:|\/\/|mailto:|tel:)/i.test(url);
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    href,
    replace = false,
    scroll = true,
    prefetch: _prefetch,
    passHref: _passHref,
    shallow: _shallow,
    legacyBehavior: _legacyBehavior,
    onClick,
    children,
    target,
    rel,
    ...rest
  },
  ref,
) {
  const ctx = useNextMigrateContext();
  const hrefString = resolveHrefString(href);
  const external = isExternalUrl(hrefString) || target === "_blank";

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;

    if (external) {
      if (ctx.mode === "tauri") {
        e.preventDefault();
        void ctx.openExternal(hrefString);
      }
      return;
    }

    // Ignore non-left clicks or modified clicks
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return;
    }

    e.preventDefault();
    ctx.navigate(hrefString, { replace, scroll });
  };

  return (
    <a
      ref={ref}
      href={hrefString}
      onClick={handleClick}
      target={target}
      rel={external && !rel ? "noopener noreferrer" : rel}
      {...rest}
    >
      {children}
    </a>
  );
});

export default Link;
