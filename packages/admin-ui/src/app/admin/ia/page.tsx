import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { UnifiedIaCockpit } from "@aphrody/admin-ui/components/admin/UnifiedIaCockpit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IA & Canon Cockpit — Console Unifiée",
  description:
    "Supervision temps réel, doctrine de canonicité, entraînement RAG et modèles",
};

export default async function AdminIaPage() {
  await requireAdmin();
  return <UnifiedIaCockpit initialTab="overview" />;
}
