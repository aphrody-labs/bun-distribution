import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import DesignEditor from "./DesignEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design & thème",
};

export default async function AdminDesignPage() {
  await requireAdmin();
  return <DesignEditor />;
}
