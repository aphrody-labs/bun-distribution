"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createAgentKey, parseScopes, revokeAgentKey, updateAgentKeyScopes } from "@/lib/agent-keys";
import type { AgentScope } from "@shenron/db/schema";

/**
 * Actions des clés d'agent.
 *
 * Le jeton en clair ne traverse ce chemin QU'UNE FOIS : il est renvoyé à l'écran
 * qui vient de le créer, puis n'existe plus nulle part (seul son SHA-256 est en
 * base). C'est la raison pour laquelle la création ne redirige pas : une
 * redirection perdrait la seule copie du secret.
 */

export type CreateResult = { ok: true; token: string; name: string; prefix: string } | { ok: false; error: string };

export async function createAgentKeyAction(input: {
  name: string;
  scopes: string[];
  note?: string;
  rateLimitPerHour?: number | null;
}): Promise<CreateResult> {
  const me = await requireAdmin();
  const name = input.name.trim();
  if (name.length < 3) return { ok: false, error: "Donne un nom d'au moins 3 caractères." };

  const scopes: AgentScope[] = parseScopes(input.scopes);
  if (scopes.length === 0) {
    return {
      ok: false,
      error: "Choisis au moins une portée — une clé sans portée ne peut rien.",
    };
  }

  try {
    const created = await createAgentKey({
      name,
      scopes,
      note: input.note ?? null,
      createdBy: me.user.id,
      rateLimitPerHour:
        typeof input.rateLimitPerHour === "number" && input.rateLimitPerHour > 0
          ? Math.min(5000, Math.trunc(input.rateLimitPerHour))
          : null,
    });
    revalidatePath("/admin/agents");
    return {
      ok: true,
      token: created.token,
      name: created.name,
      prefix: created.prefix,
    };
  } catch (err) {
    console.error("[admin] création clé agent", err);
    return { ok: false, error: "Création impossible." };
  }
}

export async function revokeAgentKeyAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  let done: boolean;
  try {
    done = await revokeAgentKey(id);
  } catch (err) {
    console.error("[admin] révocation clé agent", err);
    return {
      ok: false,
      error: "Révocation impossible : base de données indisponible, réessayez.",
    };
  }
  revalidatePath("/admin/agents");
  return done ? { ok: true } : { ok: false, error: "Clé inconnue ou déjà révoquée." };
}

export async function updateScopesAction(id: string, scopes: string[]): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const next = parseScopes(scopes);
  if (next.length === 0) {
    return {
      ok: false,
      error: "Une clé doit garder au moins une portée (sinon, révoque-la).",
    };
  }
  let done: boolean;
  try {
    done = await updateAgentKeyScopes(id, next);
  } catch (err) {
    console.error("[admin] modification portées clé agent", err);
    return {
      ok: false,
      error: "Modification impossible : base de données indisponible, réessayez.",
    };
  }
  revalidatePath("/admin/agents");
  return done ? { ok: true } : { ok: false, error: "Clé inconnue." };
}
