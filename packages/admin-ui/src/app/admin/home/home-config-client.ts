/** Message lisible pour une réponse d'erreur de /api/home-config (`{ error }` JSON ou texte brut). */
export function errorMessageFromBody(text: string, status: number): string {
  const raw = text.trim();
  if (!raw) return `HTTP ${status}`;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const msg = (parsed as { error: unknown }).error;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  } catch {
    /* corps non JSON (proxy, HTML) → texte brut */
  }
  return raw.length > 200 ? `HTTP ${status}` : raw;
}

/**
 * Premier chargement uniquement : un refetch (focus de fenêtre, reconnexion)
 * ne doit jamais écraser les modifications non enregistrées.
 */
export function seedConfig<T>(current: T | null, loaded: T | undefined): T | null {
  return current ?? loaded ?? null;
}
