// SPDX-License-Identifier: Apache-2.0
import { M3Button } from "@aphrody/m3-baseui";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Nav } from "./nav";

/** Cache Components: computed once at build and revalidated hourly (or by `revalidateTag("stamp")`). */
async function stamp() {
  "use cache";
  cacheLife("hours");
  cacheTag("stamp");
  const runtime = process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`;
  return { at: new Date().toISOString(), runtime };
}

export default async function Home() {
  const { at, runtime } = await stamp();
  return (
    <>
      <Nav />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <h1 className="text-display-small-emphasized text-primary">Material 3 on Next.js 16</h1>
        <p className="text-body-large text-on-surface-variant">
          App Router, Cache Components, proxy.ts, React Compiler and typed routes, with Base UI parts styled by M3
          tokens through a Tailwind v4 preset.
        </p>
        <section className="rounded-extra-large bg-surface-container-high p-6 shadow-elevation-1">
          <h2 className="text-title-large">Cached on the server</h2>
          <p className="text-body-medium text-on-surface-variant" data-testid="stamp">
            Rendered {at} on {runtime}.
          </p>
        </section>
        <div className="flex flex-wrap gap-3">
          <M3Button render={<Link href="/components" />} nativeButton={false}>
            Components
          </M3Button>
          <M3Button variant="outlined" render={<a href="/api/health" />} nativeButton={false}>
            /api/health
          </M3Button>
        </div>
      </main>
    </>
  );
}
