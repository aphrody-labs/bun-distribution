import { sql } from "./db";

/**
 * Insert a row into `admin_logs` mirroring the website's `logAdminAction()`.
 * `details.via = 'discord-bot'` so audits are attributable across channels.
 */
export async function logAdminAction(opts: {
  adminId: string;
  discordId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const details = {
    via: "discord-bot",
    discord_id: opts.discordId,
    ...opts.details,
  };
  try {
    // Pas de `JSON.stringify(details)` : Bun.SQL encode déjà en JSON une
    // valeur liée à un paramètre `::jsonb` — la stringifier double l'encodage.
    await sql`
      INSERT INTO admin_audit_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (${opts.adminId}, ${opts.action}, ${opts.targetType ?? "unknown"}, ${opts.targetId ?? null}, ${details}::jsonb, NOW())
    `;
  } catch (err) {
    console.error("[audit] failed to log:", err);
  }
}
