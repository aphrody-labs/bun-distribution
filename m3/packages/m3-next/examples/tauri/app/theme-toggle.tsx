// SPDX-License-Identifier: Apache-2.0
"use client";
import { M3Button } from "@aphrody/m3-baseui";
import { useM3ThemeToggle } from "@aphrody/m3-next/client";

export function ThemeToggle() {
  const { mode, toggle } = useM3ThemeToggle();
  return (
    <M3Button variant="tonal" onClick={toggle}>
      Theme: {mode}
    </M3Button>
  );
}
