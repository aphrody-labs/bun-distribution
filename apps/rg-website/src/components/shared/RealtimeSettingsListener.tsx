"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { subscribeTable } from "@/lib/realtime";

/**
 * Rafraîchit les composants serveur dès qu'un réglage change en base.
 * Adossé au service rg-realtime (SSE) depuis la migration hors Supabase.
 */
export function RealtimeSettingsListener() {
  const router = useRouter();

  useEffect(() => {
    return subscribeTable({ table: "settings" }, () => {
      router.refresh();
    });
  }, [router]);

  return null; // Composant sans rendu
}
