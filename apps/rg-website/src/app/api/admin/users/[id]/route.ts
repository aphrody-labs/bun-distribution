import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { createPostgresClient } from "@rosegriffon/db/service";

const VALID_ROLES = new Set(["admin", "staff", "user", "premium", "banned"]);

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Identifiant utilisateur invalide", success: false }, { status: 400 });
    }
    const body = await request.json();
    const { role, full_name, email_notifications } = body ?? {};

    if (role !== undefined && !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: "Rôle invalide", success: false }, { status: 400 });
    }
    if (full_name !== undefined && typeof full_name !== "string") {
      return NextResponse.json({ error: "full_name invalide", success: false }, { status: 400 });
    }
    if (full_name && full_name.length > 200) {
      return NextResponse.json({ error: "full_name trop long", success: false }, { status: 400 });
    }
    if (email_notifications !== undefined && typeof email_notifications !== "boolean") {
      return NextResponse.json({ error: "email_notifications invalide", success: false }, { status: 400 });
    }

    const supabase = createPostgresClient();

    if (email_notifications !== undefined) {
      // email_notifications appartient à user_preferences, pas à profiles
      await (supabase as any).from("user_preferences").upsert(
        {
          email_notifications,
          updated_at: new Date().toISOString(),
          user_id: id,
        },
        { onConflict: "user_id" },
      );
    }

    const profileUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (role !== undefined) profileUpdates.role = role;
    if (full_name !== undefined) profileUpdates.full_name = full_name;

    const { data: user, error } = await supabase.from("profiles").update(profileUpdates).eq("id", id).select().single();

    if (error || !user) {
      return NextResponse.json({ error: "Utilisateur non trouvé", success: false }, { status: 404 });
    }

    return NextResponse.json({
      data: user,
      message: "Utilisateur modifié avec succès",
      success: true,
    });
  } catch (error) {
    console.error("Erreur PUT utilisateur:", error);
    return NextResponse.json(
      {
        error: "Erreur lors de la modification de l'utilisateur",
        success: false,
      },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Identifiant utilisateur invalide", success: false }, { status: 400 });
    }
    const supabase = createPostgresClient();

    const { data: user, error } = await supabase
      .from("profiles")
      .update({
        role: "banned",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error || !user) {
      return NextResponse.json({ error: "Utilisateur non trouvé", success: false }, { status: 404 });
    }

    return NextResponse.json({
      message: "Utilisateur désactivé",
      success: true,
    });
  } catch (error) {
    console.error("Erreur DELETE utilisateur:", error);
    return NextResponse.json(
      {
        error: "Erreur lors de la désactivation de l'utilisateur",
        success: false,
      },
      { status: 500 },
    );
  }
}
