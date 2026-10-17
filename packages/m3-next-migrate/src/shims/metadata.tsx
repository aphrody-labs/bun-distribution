// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, type ReactNode } from "react";

export interface MetadataTitle {
  default?: string;
  template?: string;
  absolute?: string;
}

export interface MetadataOpenGraph {
  title?: string;
  description?: string;
  url?: string;
  siteName?: string;
  images?: Array<{ url: string; width?: number; height?: number; alt?: string } | string>;
}

export interface Metadata {
  title?: string | MetadataTitle | null;
  description?: string | null;
  applicationName?: string | null;
  keywords?: string[] | string | null;
  authors?: Array<{ name: string; url?: string }> | null;
  generator?: string | null;
  themeColor?: string | Array<{ media?: string; color: string }> | null;
  colorScheme?: "normal" | "light" | "dark" | "light dark" | null;
  viewport?: string | null;
  icons?:
    | {
        icon?: string | Array<{ url: string; sizes?: string; type?: string }>;
        apple?: string | Array<{ url: string; sizes?: string; type?: string }>;
      }
    | string
    | null;
  openGraph?: MetadataOpenGraph | null;
  other?: Record<string, string | number | boolean>;
}

export type ResolvingMetadata = Promise<Metadata>;

/** Resolve title string given a title definition or template */
export function resolveTitle(title: string | MetadataTitle | null | undefined, parentTitle?: string): string {
  if (!title) return parentTitle || "";
  if (typeof title === "string") return title;
  if (title.absolute) return title.absolute;
  if (title.default) {
    if (title.template && parentTitle) {
      return title.template.replace("%s", parentTitle);
    }
    return title.default;
  }
  return parentTitle || "";
}

/**
 * Synchronize window title:
 * 1. Updates document.title
 * 2. If running inside Tauri v2, sets the native Tauri window title via getCurrentWindow().setTitle(title)
 */
export async function setWindowTitle(title: string): Promise<void> {
  if (!title) return;
  if (typeof document !== "undefined") {
    document.title = title;
  }
  if (typeof window !== "undefined") {
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.window?.getCurrentWindow) {
        await tauri.window.getCurrentWindow().setTitle(title);
        return;
      }
      if (tauri?.core?.invoke) {
        await tauri.core.invoke("plugin:window|set_title", { title });
        return;
      }
      // Dynamic import fallback for Tauri v2 ESM
      const tauriWindowModule = (window as any).__TAURI_WINDOW_API__;
      if (tauriWindowModule?.getCurrentWindow) {
        await tauriWindowModule.getCurrentWindow().setTitle(title);
        return;
      }
    } catch {
      // Ignored outside Tauri runtime
    }
  }
}

/**
 * Update or create a <meta> tag in document.head
 */
export function setMetaTag(nameOrProperty: string, content: string): void {
  if (typeof document === "undefined" || !nameOrProperty || content == null) return;
  const isProperty = nameOrProperty.startsWith("og:") || nameOrProperty.startsWith("twitter:");
  const attribute = isProperty ? "property" : "name";
  let meta = document.querySelector(`meta[${attribute}="${nameOrProperty}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attribute, nameOrProperty);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

/**
 * Synchronize full Metadata object to document head and Tauri window
 */
export async function syncMetadata(meta: Metadata): Promise<void> {
  if (!meta) return;

  // Title
  if (meta.title) {
    const titleStr = resolveTitle(meta.title);
    if (titleStr) {
      await setWindowTitle(titleStr);
    }
  }

  // Description
  if (typeof meta.description === "string") {
    setMetaTag("description", meta.description);
  }

  // Application Name
  if (typeof meta.applicationName === "string") {
    setMetaTag("application-name", meta.applicationName);
  }

  // Keywords
  if (meta.keywords) {
    const kw = Array.isArray(meta.keywords) ? meta.keywords.join(", ") : meta.keywords;
    setMetaTag("keywords", kw);
  }

  // Open Graph
  if (meta.openGraph) {
    if (meta.openGraph.title) setMetaTag("og:title", meta.openGraph.title);
    if (meta.openGraph.description) setMetaTag("og:description", meta.openGraph.description);
    if (meta.openGraph.siteName) setMetaTag("og:site_name", meta.openGraph.siteName);
  }

  // Other metadata
  if (meta.other) {
    for (const [key, val] of Object.entries(meta.other)) {
      setMetaTag(key, String(val));
    }
  }
}

/**
 * React Hook to synchronize metadata (static or computed) to document.title & Tauri window
 */
export function useMetadata(metadataOrFn: Metadata | (() => Metadata | Promise<Metadata>), deps: any[] = []): void {
  useEffect(() => {
    let cancelled = false;
    async function apply() {
      try {
        const meta = typeof metadataOrFn === "function" ? await metadataOrFn() : metadataOrFn;
        if (!cancelled && meta) {
          await syncMetadata(meta);
        }
      } catch (err) {
        console.warn("Failed to synchronize metadata:", err);
      }
    }
    apply();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deps est le contrat du hook (liste fournie par l'appelant, comme pour useEffect), donc non littérale par conception.
  }, deps);
}

export interface HeadProps {
  children?: ReactNode;
}

/**
 * <Head> component for Next.js compatibility (replaces next/head and supports <title>/<meta> syncing)
 */
export function Head({ children }: HeadProps): ReactNode {
  // Sans tableau de dépendances : le titre est relu à chaque rendu, donc après tout changement de children.
  useEffect(() => {
    if (typeof document !== "undefined" && document.title) {
      setWindowTitle(document.title);
    }
  });

  return children;
}

export default Head;
