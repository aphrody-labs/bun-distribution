import { createPostgresClient } from "@rosegriffon/db/service";

const db = createPostgresClient();

export async function logAudit(
  userId: string,
  action: string,
  details?: Record<string, any>,
  meta?: { ipAddress?: string; userAgent?: string },
) {
  try {
    await db.from("audit_logs").insert({
      action,
      details: details || {},
      ip_address: meta?.ipAddress || null,
      user_agent: meta?.userAgent || null,
      user_id: userId,
    });
  } catch (error) {
    console.error("[Audit] Failed to log:", action, error);
  }
}
