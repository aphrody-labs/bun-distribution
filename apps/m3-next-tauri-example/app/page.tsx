// SPDX-License-Identifier: Apache-2.0
import { M3Button, M3Switch } from "@aphrody/m3-baseui";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export default function Home() {
  return (
    <main className="flex flex-col items-start gap-4">
      <h1 className="text-headline-medium">Static export for Tauri</h1>
      <p className="text-body-large text-on-surface-variant">
        Only the sheets of the components used on the page are imported (core,
        button, switch).
      </p>
      <M3Switch defaultChecked aria-label="Notifications" />
      <ThemeToggle />
      <M3Button
        variant="outlined"
        render={<Link href="/about" />}
        nativeButton={false}
      >
        About
      </M3Button>
    </main>
  );
}
