"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAdminAction } from "@/lib/admin-logger";
import { getServerUser } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";

const userEditSchema = z.object({
  full_name: z.string().optional(),
  role: z.enum(["user", "admin", "moderator", "staff"]),
});

type UserEditValues = z.infer<typeof userEditSchema>;

export async function updateUserProfile(userId: string, values: UserEditValues) {
  // 1. Check if current user is admin
  const user = await getServerUser();

  if (!user) {
    return { error: "Non authentifié" };
  }

  const db = createPostgresClient();
  const { data: currentUserProfile } = await db.from("profiles").select("role").eq("id", user.id).single();

  // Cast explicite pour éviter l'erreur de type
  const role = (currentUserProfile as unknown as { role: string } | null)?.role;

  if (role !== "admin") {
    return { error: "Non autorisé" };
  }

  // 2. Validate input
  const validation = userEditSchema.safeParse(values);
  if (!validation.success) {
    return { error: "Données invalides" };
  }

  // 3. Update target user using Admin Client
  const { error } = await db
    .from("profiles")
    .update({
      full_name: validation.data.full_name,
      role: validation.data.role,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("Error updating user:", error);
    return { error: "Erreur lors de la mise à jour" };
  }

  await logAdminAction("update", "user", userId, values);

  revalidatePath("/admin/users");
  return { success: true };
}
