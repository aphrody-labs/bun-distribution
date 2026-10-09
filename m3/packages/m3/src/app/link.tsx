"use client";
// SPDX-License-Identifier: Apache-2.0
// `next/link`: a plain `<a>` whose same-origin clicks become client navigations.
import { useContext, type AnchorHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from "react";
import { RouterContext } from "./runtime/router-context";

export interface UrlObject {
  pathname?: string;
  query?: Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>;
  hash?: string;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | UrlObject;
  replace?: boolean;
  scroll?: boolean;
  /** Fetch the target payload on hover/focus (default true). */
  prefetch?: boolean | null;
  ref?: Ref<HTMLAnchorElement>;
  children?: ReactNode;
}

function formatHref(href: string | UrlObject): string {
  if (typeof href === "string") return href;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const query = search.toString();
  const hash = href.hash ? (href.hash.startsWith("#") ? href.hash : `#${href.hash}`) : "";
  return `${href.pathname ?? ""}${query ? `?${query}` : ""}${hash}`;
}

export default function Link({ href, replace, scroll, prefetch, onClick, onMouseEnter, onFocus, ...rest }: LinkProps) {
  const router = useContext(RouterContext);
  const url = formatHref(href);
  const warm = () => {
    if (prefetch !== false) router?.prefetch(url);
  };
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!router || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((rest.target && rest.target !== "_self") || rest.download !== undefined) return;
    if (new URL(url, location.href).origin !== location.origin) return;
    event.preventDefault();
    router[replace ? "replace" : "push"](url, { scroll: scroll ?? true });
  };
  return (
    <a
      {...rest}
      href={url}
      onClick={click}
      onMouseEnter={event => {
        onMouseEnter?.(event);
        warm();
      }}
      onFocus={event => {
        onFocus?.(event);
        warm();
      }}
    />
  );
}
