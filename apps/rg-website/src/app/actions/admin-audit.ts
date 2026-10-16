"use server";

import { getServerSession, requireAdmin } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";

export interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
  user: {
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface GetAuditLogOptions {
  limit?: number;
  entityType?: string;
  userId?: string;
}

export interface ExportAuditLogOptions {
  from?: string;
  to?: string;
}

type AuditRow = Omit<AuditLogEntry, "user"> & {
  user_id: string | null;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

async function fetchAuditRows(
  options: {
    limit?: number;
    entityType?: string;
    userId?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<AuditRow[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(`${sql} $${values.length}`);
  };
  if (options.entityType) add("a.entity_type =", options.entityType);
  if (options.userId) add("a.user_id =", options.userId);
  if (options.from) add("a.created_at >=", options.from);
  if (options.to) add("a.created_at <=", options.to);
  const limit = Math.max(1, Math.min(options.limit ?? 5000, 5000));
  values.push(limit);
  const { rows } = await getPgPool().query<AuditRow>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, a.user_id,
			p.username, p.full_name, p.avatar_url
		 FROM admin_audit_log a LEFT JOIN profiles p ON p.id = a.user_id
		 ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
		 ORDER BY a.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

/**
 * Insère une entrée dans le journal d'audit.
 * Nécessite d'être authentifié.
 */
export async function logAuditAction(
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Non authentifié");
  }

  try {
    await getPgPool().query(
      `INSERT INTO admin_audit_log (action, created_at, details, entity_id, entity_type, user_id)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
      [action, new Date().toISOString(), details ?? null, entityId, entityType, session.user.id],
    );
  } catch (error) {
    console.error("logAuditAction error:", error);
    // On ne remonte pas l'erreur pour ne pas bloquer l'action principale
  }
}

/**
 * Retourne les entrées du journal d'audit (admin uniquement).
 * Peut être filtré par type d'entité ou par utilisateur.
 * La limite par défaut est 50.
 */
export async function getAuditLog(options: GetAuditLogOptions = {}): Promise<AuditLogEntry[]> {
  await requireAdmin();

  const { limit = 50, entityType, userId } = options;

  try {
    return (await fetchAuditRows({ entityType, limit, userId })).map(row => ({
      action: row.action,
      created_at: row.created_at,
      details: row.details,
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      id: row.id,
      user: row.user_id
        ? { id: row.user_id, username: row.username, full_name: row.full_name, avatar_url: row.avatar_url }
        : null,
    }));
  } catch (error) {
    console.error("getAuditLog error:", error);
    return [];
  }
}

/**
 * Exporte les entrées du journal d'audit au format CSV (admin uniquement).
 * Peut être filtré par plage de dates (from/to au format ISO 8601).
 * Retourne une chaîne CSV prête à être téléchargée.
 */
export async function exportAuditLogCSV(options: ExportAuditLogOptions = {}): Promise<string> {
  await requireAdmin();

  const { from, to } = options;

  const rows = await fetchAuditRows({ from, to });

  // En-têtes CSV
  const headers = ["id", "date", "action", "entity_type", "entity_id", "user_id", "username", "full_name", "details"];

  const escapeCSV = (value: string | null | undefined): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const str = String(value);
    // Encadrer de guillemets si la valeur contient une virgule, un guillemet ou un saut de ligne
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replaceAll('"', '""')}"`;
    }
    return str;
  };

  const csvLines: string[] = [headers.join(",")];

  for (const row of rows) {
    const line = [
      escapeCSV(row.id),
      escapeCSV(row.created_at),
      escapeCSV(row.action),
      escapeCSV(row.entity_type),
      escapeCSV(row.entity_id),
      escapeCSV(row.user_id),
      escapeCSV(row.username),
      escapeCSV(row.full_name),
      escapeCSV(row.details ? JSON.stringify(row.details) : null),
    ].join(",");
    csvLines.push(line);
  }

  return csvLines.join("\n");
}
