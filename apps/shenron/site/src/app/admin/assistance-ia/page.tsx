import type { Metadata } from "next";
import { redirectToAdminIa } from "@/components/admin/admin-ia-redirect";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Supervision IA & Modèles — Cockpit Unifié",
};

export default function AssistanceIaPage() {
	redirectToAdminIa("overview");
}
