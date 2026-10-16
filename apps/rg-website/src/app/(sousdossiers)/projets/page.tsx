export const dynamic = "force-dynamic";

import type { Metadata } from "next";

import { ProjectCard } from "@/components/shared/ProjectCard";
import { BreadcrumbSchema } from "@/components/shared/StructuredData";

import { Palette } from "@/lib/icons-config";
import { PROJETS } from "@/lib/projets";
import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/projets") },
  description: "Découvrez les outils et initiatives créatives de la communauté Rose Griffon.",
  title: "Projets | Rose Griffon",
};

export default function ProjetsPage() {
  return (
    <div className="space-y-6 px-4 py-4 pb-12 min-[600px]:px-6 min-[600px]:py-6 min-[840px]:space-y-8">
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/projets", name: "Projets" },
        ]}
      />

      <header className="flex min-h-16 items-center gap-3 border-b border-outline-variant/60 pb-4">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Palette className="size-5" aria-hidden />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-on-surface min-[840px]:text-3xl">Projets</h1>
      </header>

      {/* Grille — même carte et mêmes données que l'extrait de la page d'accueil */}
      <section className="grid grid-cols-1 gap-4 min-[600px]:grid-cols-2 min-[1200px]:grid-cols-3">
        {PROJETS.map(projet => (
          <ProjectCard key={projet.slug} projet={projet} />
        ))}
      </section>
    </div>
  );
}
