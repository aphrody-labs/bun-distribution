import type { Metadata } from "next";
import { redirectToAdminIa } from "@aphrody/admin-ui/components/admin/admin-ia-redirect";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Doctrine de Canonicité & Paroles de Toriyama — Cockpit Unifié",
};

export default function AdminCanonPage() {
  redirectToAdminIa("canon");
}
