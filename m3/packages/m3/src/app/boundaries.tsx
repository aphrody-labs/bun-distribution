"use client";
// SPDX-License-Identifier: Apache-2.0
// Client boundaries placed by the server around each route segment: `error.tsx`, `not-found.tsx`
// and the redirect raised by `redirect()` after the response started streaming.
import { Component, useContext, useEffect, type ComponentType, type ReactNode } from "react";
import { LocationContext, RouterContext } from "./runtime/router-context";
import { isNotFoundError, redirectInfo } from "./runtime/shared";

interface BoundaryProps {
  pathname: string;
  accept(error: unknown): boolean;
  render(error: unknown, reset: () => void): ReactNode;
  children?: ReactNode;
}

interface BoundaryState {
  caught: boolean;
  error: unknown;
  pathname: string;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { caught: false, error: undefined, pathname: this.props.pathname };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { caught: true, error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    // A navigation clears the error of the previous page.
    return props.pathname !== state.pathname ? { caught: false, error: undefined, pathname: props.pathname } : null;
  }

  reset = () => this.setState({ caught: false, error: undefined });

  override render(): ReactNode {
    if (!this.state.caught) return this.props.children;
    if (!this.props.accept(this.state.error)) throw this.state.error;
    return this.props.render(this.state.error, this.reset);
  }
}

const usePathname = () => useContext(LocationContext)?.pathname ?? "";

export interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** `error.tsx` of a segment. */
export function ErrorBoundary({
  fallback: Fallback,
  children,
}: {
  fallback: ComponentType<ErrorProps>;
  children?: ReactNode;
}) {
  return (
    <Boundary
      pathname={usePathname()}
      accept={error => !isNotFoundError(error) && !redirectInfo(error)}
      render={(error, reset) => <Fallback error={error as ErrorProps["error"]} reset={reset} />}
    >
      {children}
    </Boundary>
  );
}

/** `not-found.tsx` of a segment, shown when a client-streamed part calls `notFound()`. */
export function NotFoundBoundary({ fallback, children }: { fallback: ReactNode; children?: ReactNode }) {
  return (
    <Boundary pathname={usePathname()} accept={isNotFoundError} render={() => fallback}>
      {children}
    </Boundary>
  );
}

function Redirect({ url, replace }: { url: string; replace: boolean }) {
  const router = useContext(RouterContext);
  useEffect(() => {
    if (router) router[replace ? "replace" : "push"](url);
    else location.assign(url);
  }, [router, url, replace]);
  return null;
}

/** Root boundary: a `redirect()` raised while streaming navigates on the client. */
export function RedirectBoundary({ children }: { children?: ReactNode }) {
  return (
    <Boundary
      pathname={usePathname()}
      accept={error => !!redirectInfo(error)}
      render={error => {
        const info = redirectInfo(error)!;
        return <Redirect url={info.url} replace={info.type === "replace"} />;
      }}
    >
      {children}
    </Boundary>
  );
}
