import type { Metadata } from "next";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { LaunchManager } from "./LaunchManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accès et classement des rubriques",
  robots: { index: false },
};

export default async function AdminLaunchPage() {
  const config = await getLaunchConfig();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <h1 className="mb-2 font-saiyan text-4xl text-dbz-orange">ACCÈS DES RUBRIQUES</h1>
        <p className="mb-1 text-sm text-white/60">
          Pour chaque catégorie du wiki et chaque section du site : qui peut la voir — tout le monde, les membres
          connectés, certains rôles Discord, ou le staff seul. Les flèches règlent l&apos;ordre d&apos;affichage.
        </p>
        <p className="text-xs uppercase tracking-widest text-white/50">
          Piloté par la DB · effet sous 30 s · aucune migration
        </p>
      </header>
      <LaunchManager initial={config} />
    </div>
  );
}
