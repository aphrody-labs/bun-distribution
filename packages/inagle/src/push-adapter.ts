import { ownedPostgresUrl } from "./core/data-source.js";

/**
 * @file push-adapter.ts
 * @description Couche d'accès données partagée pour le flux de push Inagle →
 * PostgreSQL. Extraite de cli-push.ts pour que les pushers de catégories
 * (scripts/push-*.ts) puissent réutiliser le MÊME adaptateur direct sans
 * dupliquer le câblage, et sans import circulaire avec
 * cli-push.ts (qui importe ces pushers).
 *
 * Tout upsert est idempotent (ON CONFLICT). Aucune valeur fabriquée ici : ce
 * module ne fait QUE persister des lignes déjà construites depuis le dump réel.
 */

import { createPgPool } from "@rosegriffon/db/pg";

// === Interface ===

export interface DataAdapter {
  upsert(table: string, records: any[], onConflict?: string): Promise<{ error: any }>;
  insert(table: string, records: any[]): Promise<{ error: any }>;
  deleteAllExcept(table: string, column: string, value: any): Promise<{ error: any }>;
  // Lit toutes les lignes (colonnes choisies) — sert à préserver les colonnes
  // curatées hors-pipeline (sheet_data, zukan_order) à travers un delete+reinsert.
  fetchAll(table: string, columns: string): Promise<any[]>;
  close(): Promise<void>;
}

// === Helpers communs ===

export function dedup(records: any[], key = "id") {
  const map = new Map();
  for (const r of records) {
    const k = r[key] || r.id;
    if (k) map.set(k, r);
  }
  return Array.from(map.values());
}

// === Adapters ===

export class PostgresAdapter implements DataAdapter {
  private pool: ReturnType<typeof createPgPool>;
  constructor(connectionString: string) {
    this.pool = createPgPool(connectionString, { applicationName: "inagle-push" });
  }

  async upsert(table: string, records: any[], onConflict = "id") {
    if (records.length === 0) return { error: null };

    // Chunking for Postgres max params (65535)
    // Let's safe limit to 50 rows per insert if many columns
    const CHUNK_SIZE = 50;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const err = await this._upsertBatch(table, chunk, onConflict);
      if (err) return { error: err };
    }
    return { error: null };
  }

  private async _upsertBatch(table: string, records: any[], onConflict: string) {
    const keys = Object.keys(records[0]);
    let paramIndex = 1;
    const values: any[] = [];
    const rows: string[] = [];

    for (const r of records) {
      const rowParams: string[] = [];
      for (const k of keys) {
        rowParams.push(`$${paramIndex++}`);
        let val = r[k];
        if (typeof val === "object" && val !== null) val = JSON.stringify(val);
        values.push(val);
      }
      rows.push(`(${rowParams.join(", ")})`);
    }

    const updateSet = keys.map((k) => `"${k}" = EXCLUDED."${k}"`).join(", ");

    const conflictCols = onConflict
      .split(",")
      .map((c) => `"${c.trim()}"`)
      .join(", ");
    const query = `
            INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")})
            VALUES ${rows.join(", ")}
            ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}
        `;

    try {
      await this.pool.query(query, values);
      return null;
    } catch (e: any) {
      console.error(`[PostgresAdapter] Error in upsert: ${e.message}`, e);
      return e;
    }
  }

  async insert(table: string, records: any[]) {
    // Simple insert without conflict handling (or could fail)
    // For treasures, we deleted before, so simple insert is fine.
    return this.upsert(table, records, "id"); // treasures has id
  }

  async deleteAllExcept(table: string, column: string, value: any) {
    try {
      await this.pool.query(`DELETE FROM "${table}" WHERE "${column}" != $1`, [value]);
      return { error: null };
    } catch (e: any) {
      return { error: e };
    }
  }

  async fetchAll(table: string, columns: string) {
    try {
      const cols = columns
        .split(",")
        .map((c) => `"${c.trim()}"`)
        .join(", ");
      const res = await this.pool.query(`SELECT ${cols} FROM "${table}"`);
      return res.rows;
    } catch {
      return [];
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function createPostgresAdapter(): DataAdapter {
  const connectionString = ownedPostgresUrl();
  console.log("🔌 Using direct PostgreSQL Adapter");
  return new PostgresAdapter(connectionString);
}
