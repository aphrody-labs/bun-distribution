import { WikiStudio } from "@aphrody/admin-ui/components/admin/WikiStudio";

// Gate admin assuré par `app/admin/layout.tsx` (requireAdmin) ; QueryProvider y
// est aussi monté. Ici on extrait juste les params et on rend le studio client.
export const dynamic = "force-dynamic";

export default async function WikiStudioPage({ params }: { params: Promise<{ table: string; id: string }> }) {
  // Next a déjà décodé les params dynamiques — pas de double-décodage ici.
  const { table, id } = await params;
  return <WikiStudio table={table} id={id} />;
}
