// SPDX-License-Identifier: Apache-2.0
"use client";
import { M3Button } from "@aphrody/m3-baseui";
import { useM3ThemeToggle } from "@aphrody/m3-next/client";

/** Client Component compiled by the React Compiler (no useCallback or useMemo needed). */
export function ThemeToggle() {
  const { mode, resolved, toggle } = useM3ThemeToggle();
  return (
    <M3Button
      variant="tonal"
      size="xs"
      onClick={toggle}
      data-testid="theme-toggle"
    >
      Theme: {mode} ({resolved})
    </M3Button>
  );
}
