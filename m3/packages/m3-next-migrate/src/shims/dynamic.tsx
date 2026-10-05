// SPDX-License-Identifier: Apache-2.0
"use client";

import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";

export interface DynamicOptions<P = {}> {
  loader?: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;
  loading?: (props: {
    error?: Error | null;
    isLoading?: boolean;
    pastDelay?: boolean;
    retry?: () => void;
  }) => ReactNode;
  ssr?: boolean;
}

export type DynamicComponent<P = {}> = ComponentType<P>;

export function dynamic<P extends object = {}>(
  dynamicOptions:
    | (() => Promise<{ default: ComponentType<P> } | ComponentType<P>>)
    | DynamicOptions<P>,
  options?: DynamicOptions<P>,
): DynamicComponent<P> {
  const mergedOptions: DynamicOptions<P> =
    typeof dynamicOptions === "function"
      ? { loader: dynamicOptions, ...options }
      : { ...dynamicOptions, ...options };

  const loader = mergedOptions.loader;
  if (!loader) {
    throw new Error("next/dynamic shim: loader function is required");
  }

  const LazyComponent = lazy(async () => {
    const res = await loader();
    if ("default" in res && res.default) {
      return { default: res.default as ComponentType<P> };
    }
    return { default: res as ComponentType<P> };
  });

  const LoadingFallback = mergedOptions.loading;

  return function DynamicWrapper(props: P) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      setMounted(true);
    }, []);
    const fallback = LoadingFallback ? LoadingFallback({ isLoading: true }) : null;
    if (mergedOptions.ssr === false && !mounted) return fallback;
    return (
      <Suspense fallback={fallback}>
        <LazyComponent {...(props as any)} />
      </Suspense>
    );
  };
}

export default dynamic;
