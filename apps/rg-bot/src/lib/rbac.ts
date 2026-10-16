import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";

import { isBotAdminRole, type RgRole } from "@rosegriffon/types/roles";

import { cached, invalidate } from "./cache";
import { sql } from "./db";

export type { RgRole };

export interface RgAdmin {
  profileId: string;
  discordId: string;
  role: RgRole;
}

export class NotAdminError extends Error {
  constructor(message = "Non autorisé") {
    super(message);
    this.name = "NotAdminError";
  }
}

/**
 * Resolve the RG profile attached to a Discord user via Better Auth `account` table.
 * Throws if not admin/staff.
 */
const RBAC_CACHE_TTL_MS = 60_000;

export function invalidateRbacCache(discordId: string): void {
  invalidate(`rbac:${discordId}`);
}

export async function requireRgAdmin(discordId: string): Promise<RgAdmin> {
  const resolution = await cached(`rbac:${discordId}`, RBAC_CACHE_TTL_MS, async () => {
    const rows = await sql<{ id: string; role: RgRole | null }[]>`
      SELECT p.id, p.role
      FROM account a
      JOIN profiles p ON p.id::text = a.user_id
      WHERE a.provider_id = 'discord' AND a.account_id = ${discordId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  });

  if (!resolution) {
    throw new NotAdminError("Aucun compte RG lié à ce Discord. Connecte-toi via Discord OAuth sur rosegriffon.fr.");
  }
  if (!isBotAdminRole(resolution.role)) {
    throw new NotAdminError(`Rôle insuffisant (actuel: ${resolution.role ?? "user"})`);
  }
  return { profileId: resolution.id, discordId, role: resolution.role };
}

/**
 * Strict admin (excludes staff). Use for destructive or role-escalation actions.
 */
export async function requireRgAdminStrict(discordId: string): Promise<RgAdmin> {
  const admin = await requireRgAdmin(discordId);
  if (admin.role !== "admin") {
    throw new NotAdminError("Cette action nécessite le rôle admin (pas staff)");
  }
  return admin;
}

/**
 * Wrap a slash-command handler with RBAC enforcement.
 * Replies ephemerally on auth failure.
 */
export function withRgAdmin<Args extends unknown[]>(
  handler: (admin: RgAdmin, interaction: ChatInputCommandInteraction, ...args: Args) => Promise<void>,
  opts: { strict?: boolean } = {},
) {
  return async (interaction: ChatInputCommandInteraction, ...args: Args): Promise<void> => {
    try {
      const admin = opts.strict
        ? await requireRgAdminStrict(interaction.user.id)
        : await requireRgAdmin(interaction.user.id);
      await handler(admin, interaction, ...args);
    } catch (err) {
      const msg = err instanceof NotAdminError ? err.message : "Erreur d'authentification RG";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `🚫 ${msg}` });
      } else {
        await interaction.reply({
          content: `🚫 ${msg}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  };
}
