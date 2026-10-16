import { requireAdmin } from "@/lib/session";
import { AdminSidebar } from "@aphrody/admin-ui/components/admin/AdminSidebar";
import { QueryProvider } from "@aphrody/admin-ui/components/admin/QueryProvider";
import { AdminFrame } from "@shenron/ui/layout/AdminFrame";
import type { Metadata } from "next";

// L'espace admin n'est pas indexable par les moteurs de recherche
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Administration · Dragon Ball France",
    template: "%s · Admin DBFR",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Vérifie que l'utilisateur est bien admin — redirige sinon
  await requireAdmin();

  return (
    <QueryProvider>
      <AdminFrame sidebar={<AdminSidebar />}>{children}</AdminFrame>
    </QueryProvider>
  );
}
