import type { Metadata } from "next";
import { redirectToAdminIa } from "@aphrody/admin-ui/components/admin/admin-ia-redirect";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Évaluations RAG & Bancs Dorés — Cockpit Unifié",
};

export default function AdminEvaluationsPage() {
  redirectToAdminIa("training");
}
