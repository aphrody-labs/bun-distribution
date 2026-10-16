import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import HomeEditor from "./HomeEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Page d'accueil",
};

export default async function AdminHomePage() {
  await requireAdmin();
  return <HomeEditor />;
}
