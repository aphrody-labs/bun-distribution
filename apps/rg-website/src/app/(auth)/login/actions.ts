"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * Déconnexion — invalide la session Better Auth côté serveur.
 */
export async function logout(): Promise<void> {
  await auth.api.signOut({ headers: await headers() }).catch(() => {});
  revalidatePath("/", "layout");
  redirect("/");
}
