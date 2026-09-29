import type { CrudInterface, DataTypes, OmitId, Table } from "brackets-manager";
import type { Id } from "brackets-model";
import { sql, type RawBuilder } from "kysely";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

type BracketDatabase = Record<string, never>;
const db = createAchilleaSql<BracketDatabase>();

/**
 * Adaptateur CRUD brackets-manager sur la base unifiée.
 *
 * Les noms de tables/colonnes viennent du contrat brackets-manager et sont validés
 * avant insertion dans un fragment SQL ; toutes les valeurs restent des paramètres
 * Kysely. Aucun EntityManager/MikroORM ne traverse cette frontière.
 */
export class KyselyBracketAdapter implements CrudInterface {
	constructor(private readonly tablePrefix = "bm_") {}

	private tableName(table: Table): string {
		const name = `${this.tablePrefix}${String(table)}`;
		if (!/^bm_[a-z][a-z0-9_]*$/u.test(name)) throw new Error(`Invalid bracket table: ${name}`);
		return name;
	}

	private identifier(name: string): RawBuilder<unknown> {
		if (!/^[a-z][a-z0-9_]*$/u.test(name)) throw new Error(`Invalid bracket column: ${name}`);
		return sql.raw(`"${name}"`);
	}

	private columns(names: string[]) {
		return sql.join(names.map((name) => this.identifier(name)), sql`, `);
	}

	private values(row: Record<string, unknown>, names: string[]) {
		return sql`(${sql.join(names.map((name) => sql`${row[name]}`), sql`, `)})`;
	}

	async insert<T extends Table>(table: T, value: OmitId<DataTypes[T]> | OmitId<DataTypes[T]>[]): Promise<any> {
		const rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
		if (!rows.length) return true;
		const names = Object.keys(rows[0]);
		const statement = sql`INSERT INTO ${sql.raw(`"${this.tableName(table)}"`)} (${this.columns(names)}) VALUES ${sql.join(rows.map((row) => this.values(row, names)), sql`, `)}${Array.isArray(value) ? sql`` : sql` RETURNING "id"`}`;
		const result = await statement.execute(db);
		return Array.isArray(value) ? true : (result.rows as Array<{ id?: number }>)[0]?.id ?? null;
	}

	async select<T extends Table>(table: T, filter?: Id | Partial<DataTypes[T]>): Promise<any> {
		const tableSql = sql.raw(`"${this.tableName(table)}"`);
		const whereEntries: Array<[string, unknown]> = filter === undefined ? [] : typeof filter === "object" ? Object.entries(filter as object).filter(([, value]) => value !== undefined) : [["id", filter]];
		const where = whereEntries.length ? sql` WHERE ${sql.join(whereEntries.map(([column, value]) => sql`${this.identifier(column)} = ${value}`), sql` AND `)}` : sql``;
		const result = await sql`SELECT * FROM ${tableSql}${where} ORDER BY "id" ASC`.execute(db);
		const rows = result.rows as DataTypes[T][];
		return typeof filter === "number" || typeof filter === "string" ? rows[0] ?? null : rows;
	}

	async update<T extends Table>(table: T, filter: Id | Partial<DataTypes[T]>, value?: Partial<DataTypes[T]>): Promise<boolean> {
		if (!value) return false;
		const sets = Object.entries(value as object).filter(([, entry]) => entry !== undefined);
		if (!sets.length) return false;
		const whereEntries: Array<[string, unknown]> = typeof filter === "object" ? Object.entries(filter as object).filter(([, entry]) => entry !== undefined) : [["id", filter]];
		const where = whereEntries.length ? sql` WHERE ${sql.join(whereEntries.map(([column, entry]) => sql`${this.identifier(column)} = ${entry}`), sql` AND `)}` : sql``;
		const result = await sql`UPDATE ${sql.raw(`"${this.tableName(table)}"`)} SET ${sql.join(sets.map(([column, entry]) => sql`${this.identifier(column)} = ${entry}`), sql`, `)}${where}`.execute(db);
		return Number(result.numAffectedRows ?? 0) > 0;
	}

	async delete<T extends Table>(table: T, filter?: Partial<DataTypes[T]>): Promise<boolean> {
		const entries = filter ? Object.entries(filter as object).filter(([, value]) => value !== undefined) : [];
		const where = entries.length ? sql` WHERE ${sql.join(entries.map(([column, value]) => sql`${this.identifier(column)} = ${value}`), sql` AND `)}` : sql``;
		await sql`DELETE FROM ${sql.raw(`"${this.tableName(table)}"`)}${where}`.execute(db);
		return true;
	}
}
