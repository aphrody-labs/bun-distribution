// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

/** Server Component: typed `href`s (typedRoutes) and the client toggle. */
export function Nav() {
  return (
    <nav className="flex items-center gap-2 border-b border-outline-variant bg-surface-container px-4 py-2">
      <Link
        href="/"
        className="state-layer rounded-full px-4 py-2 text-label-large text-on-surface-variant"
      >
        Home
      </Link>
      <Link
        href="/components"
        className="state-layer rounded-full px-4 py-2 text-label-large text-on-surface-variant"
      >
        Components
      </Link>
      <Link
        href="/theme"
        className="state-layer rounded-full px-4 py-2 text-label-large text-on-surface-variant"
      >
        Theme
      </Link>
      <span className="ms-auto">
        <ThemeToggle />
      </span>
    </nav>
  );
}
