// SPDX-License-Identifier: Apache-2.0
// Fiche factuelle propriétaire <-> Omar : le fichier poussé par le PC du propriétaire (réseau, SSH, VNC, WireGuard,
// Aphrody, vps) reçoit la partie déclarée par Omar (rapport `fiche`), puis est joint au message épinglé de #sync-fiche
// (édité en place seulement quand le contenu change). Aucun secret : jetons, clés privées et mots de passe en sont exclus.
import type { Api } from "./sync.ts";
import { DiscordError, type Message } from "./api.ts";
import type { SyncState } from "./protocol.ts";

export const FICHE_NAME = "fiche-aphro-omar.md";

const SECRET = /(private|preshared|password|passwd|secret|token\s*[:=]|bearer\s+[a-z0-9]{8,})/i;

/** Retire toute ligne qui ressemble à un secret avant publication. */
export function scrub(text: string): string {
  return text
    .split("\n")
    .filter(l => !SECRET.test(l) || /bearer-token|vnc-password|token\)/i.test(l))
    .join("\n");
}

export function renderOmarSection(data: Record<string, unknown> | undefined): string {
  if (!data || Object.keys(data).length === 0)
    return "## Déclaré par Omar\n\n_Aucun rapport `fiche` reçu. Omar : poste `APHRODY-SYNC/1 report fiche` avec ton nom d'utilisateur Windows/WSL, tes ports, tes services, tes tâches de boot._\n";
  const lines = Object.entries(data).map(([k, v]) => `- ${k} : ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return `## Déclaré par Omar\n\n${lines.join("\n")}\n`;
}

export function mergeFiche(owner: string, omar: Record<string, unknown> | undefined, now: Date): string {
  return scrub(`${owner.trimEnd()}\n\n${renderOmarSection(omar)}\n_Fiche synchronisée le ${now.toISOString()}._\n`);
}

export async function syncFiche(
  api: Api & {
    upload: (m: "POST" | "PATCH", p: string, b: Record<string, unknown>, n: string, c: string) => Promise<Message>;
  },
  state: SyncState,
  owner: string | undefined,
  now = new Date(),
): Promise<{
  status: "unchanged" | "edited" | "created" | "absent";
  merged?: string;
}> {
  const channel = state.channels.fiche;
  if (!channel || !owner) return { status: "absent" };
  const merged = mergeFiche(owner, state.omarFiche, new Date(0)); // hash indépendant de l'horodatage
  const hash = new Bun.CryptoHasher("sha256").update(merged).digest("hex");
  const full = mergeFiche(owner, state.omarFiche, now);
  if (state.ficheHash === hash && state.ficheMessageId) return { status: "unchanged", merged: full };
  const payload = {
    content: `Fiche aphro ↔ Omar (${now.toISOString()}), sha256 ${hash.slice(0, 12)}`,
    allowed_mentions: { parse: [] },
  };
  if (state.ficheMessageId) {
    try {
      await api.upload("PATCH", `/channels/${channel}/messages/${state.ficheMessageId}`, payload, FICHE_NAME, full);
      state.ficheHash = hash;
      return { status: "edited", merged: full };
    } catch (error) {
      if (!(error instanceof DiscordError) || error.status !== 404) throw error;
    }
  }
  const created = await api.upload("POST", `/channels/${channel}/messages`, payload, FICHE_NAME, full);
  await api.pin(channel, created.id);
  state.ficheMessageId = created.id;
  state.ficheHash = hash;
  for (const m of await api.messages(channel, "limit=5")) if (m.type === 6) await api.remove(channel, m.id);
  return { status: "created", merged: full };
}
