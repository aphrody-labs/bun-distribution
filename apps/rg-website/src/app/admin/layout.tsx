import AdminSidebar from "@/components/admin/AdminSidebar";
import { getServerUser, requireAdmin } from "@/lib/auth-helpers";
import { isPatreonAdmin } from "@/lib/patreon/admin-access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const user = await getServerUser();
  const showPatreon = await isPatreonAdmin(user);

  return (
    <div className="flex min-h-screen bg-muted/30">
      <AdminSidebar showPatreon={showPatreon} />
      <div className="flex-1 overflow-x-hidden pt-16 pb-20 lg:pt-0 lg:pb-0">{children}</div>
    </div>
  );
}
