// SPDX-License-Identifier: Apache-2.0
import { readM3ThemeMode } from "@aphrody/m3-next/server";
import { Suspense } from "react";
import { Nav } from "../nav";

/** Reads the request cookie: dynamic, so it sits behind <Suspense> while the shell stays static. */
async function ServerMode() {
  const mode = await readM3ThemeMode();
  return <p data-testid="server-mode">The server saw the preference: {mode}</p>;
}

export default function ThemePage() {
  return (
    <>
      <Nav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <h1 className="text-headline-medium">Theme</h1>
        <p className="text-body-large text-on-surface-variant">
          proxy.ts writes the cookie on the first visit; the toggle in the bar
          changes it.
        </p>
        <Suspense fallback={<p>Reading the cookie...</p>}>
          <ServerMode />
        </Suspense>
      </main>
    </>
  );
}
