/** Public settings with a verified consumer. No credentials or infrastructure configuration. */
export const ADMIN_PUBLIC_SETTINGS = {
  home_intro_title: { label: "Titre de présentation RG", kind: "text", consumer: "/" },
  home_intro_text: { label: "Présentation RG", kind: "text", consumer: "/" },
  home_intro_image: { label: "Image de présentation RG", kind: "url", consumer: "/" },
  home_achillea_description: { label: "Description Achilléa", kind: "text", consumer: "/api/public/achillea/info" },
  home_achillea_discord: { label: "Invitation Discord Achilléa", kind: "url", consumer: "/api/public/achillea/info" },
  home_achillea_image: { label: "Bannière Achilléa", kind: "url", consumer: "/api/public/achillea/info" },
  home_achillea_link: { label: "Lien Achilléa", kind: "url", consumer: "/api/public/achillea/info" },
} as const;

export type AdminPublicSettingKey = keyof typeof ADMIN_PUBLIC_SETTINGS;

export function parseAdminPublicSetting(
  key: string,
  value: unknown,
): { ok: true; key: AdminPublicSettingKey; value: string } | { ok: false; message: string } {
  if (!Object.hasOwn(ADMIN_PUBLIC_SETTINGS, key)) {
    return { ok: false, message: "Paramètre non disponible dans la configuration publique" };
  }
  if (typeof value !== "string" || value.length > 4000 || value.trim().length === 0) {
    return { ok: false, message: "Valeur texte non vide de 4 000 caractères maximum requise" };
  }
  const typedKey = key as AdminPublicSettingKey;
  if (ADMIN_PUBLIC_SETTINGS[typedKey].kind === "url") {
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
      return { ok: true, key: typedKey, value };
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") return { ok: true, key: typedKey, value };
    } catch {
      /* Invalid URL. */
    }
    return { ok: false, message: "URL HTTPS ou chemin local absolu requis" };
  }
  return { ok: true, key: typedKey, value };
}
