import { redirect } from "next/navigation";

export type AdminIaTab = "overview" | "training" | "canon" | "agents";

/** Keeps former focused URLs valid while the IA administration has one home. */
export function redirectToAdminIa(tab: AdminIaTab) {
  redirect(`/admin/ia?tab=${tab}`);
}
