"use server";

import { botAdmin } from "@/lib/bot-admin";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

type ThemeInput = {
  id: string;
  name: string;
  accent: string;
  aura: string;
  bgGrad1: string;
  bgGrad2: string;
  bgGrad3: string;
  bgFile?: string | null;
  textShadow: string;
  enabled?: boolean;
};

export async function createTheme(input: ThemeInput) {
  await requireAdmin();
  try {
    await botAdmin.canvas.themeCreate(input);
    revalidatePath("/admin/canvas/themes");
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "erreur",
    };
  }
}

export async function updateTheme(id: string, patch: Partial<ThemeInput>) {
  await requireAdmin();
  try {
    await botAdmin.canvas.themeUpdate(id, patch);
    revalidatePath("/admin/canvas/themes");
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "erreur",
    };
  }
}

export async function deleteTheme(id: string) {
  await requireAdmin();
  try {
    await botAdmin.canvas.themeRemove(id);
    revalidatePath("/admin/canvas/themes");
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "erreur",
    };
  }
}
