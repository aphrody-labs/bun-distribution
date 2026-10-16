import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import ChronologyEditor from "./ChronologyEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chronologie",
};

export default async function AdminChronologiePage() {
  await requireAdmin();
  return <ChronologyEditor />;
}
