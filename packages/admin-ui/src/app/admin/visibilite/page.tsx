import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { AdminHeader } from "@aphrody/admin-ui/app/admin/db-universe/_Header";
import { VisibilityManager } from "./VisibilityManager";

export const metadata: Metadata = { title: "Visibilité du wiki" };
// Écran admin gated (cookies/session) — jamais mis en cache.
export const dynamic = "force-dynamic";

export default async function VisibilitePage() {
  // Le layout /admin gate déjà, mais on re-garde par défense en profondeur.
  await requireAdmin();
  return (
    <div className="w-full mx-auto max-w-[1100px] px-4 py-8 lg:px-8">
      <AdminHeader
        title="Visibilité"
        subtitle="Afficher / masquer chaque entité du wiki sur le site public"
      />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-white/60">
        Masque une entité du site public sans la supprimer : elle disparaît des
        index et sa page renvoie 404 pour les visiteurs, mais reste éditable ici
        et dans le studio. Utilise « Tout afficher / Tout masquer » pour
        basculer une catégorie entière, ou clique une entité pour la basculer
        individuellement.
      </p>
      <VisibilityManager />
    </div>
  );
}
