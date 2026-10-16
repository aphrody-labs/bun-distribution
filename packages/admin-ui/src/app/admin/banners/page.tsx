import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/session";
import { BannersEditor } from "./BannersEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bannières des pages",
};

export default async function AdminBannersPage() {
  await requireAdmin();
  // Suspense requis pour useSearchParams (deep-link ?page=episodes).
  return (
    <Suspense
      fallback={<div className="p-8 text-sm text-white/50">Chargement…</div>}
    >
      <BannersEditor />
    </Suspense>
  );
}
