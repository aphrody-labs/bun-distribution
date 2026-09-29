import {
	BodyParams,
	Context,
	Controller,
	Delete,
	Get,
	Patch,
	PathParams,
	Post,
	QueryParams,
	Res,
	UseBefore,
} from "@tsed/common";
import { BadRequest, Forbidden, Unauthorized } from "@tsed/exceptions";
import type { Response } from "express";

import { CookieAuthorize } from "@/api/middlewares";
import type { UserDTO } from "@/services";
import { AuditLogService, Database } from "@/services";
import { BaseController } from "@/utils/classes";
import { UserRole } from "@/utils/enums";
import { resolveDependenciesSync } from "@/utils/functions";
import { env } from "@/env";

interface ColumnMeta {
	name: string;
	dataType: string;
	nullable: boolean;
	default: string | null;
	isPrimaryKey: boolean;
}

/**
 * Éditeur de base de données générique pour le dashboard admin — "agir direct
 * sur Supabase avec une UI friendly", réservé SuperAdmin.
 *
 * Sécurité :
 *  - table/colonnes TOUJOURS revalidées contre information_schema avant
 *    d'être interpolées dans le SQL (jamais un identifiant client brut) ;
 *  - valeurs TOUJOURS paramétrées (`?`) ;
 *  - update/delete refusés si la table n'a pas de clé primaire détectable ;
 *  - `/query` est en lecture seule (SELECT/WITH, une seule instruction) ;
 *  - chaque écriture est tracée dans AuditLog.
 */
@Controller("/admin/db")
@UseBefore(CookieAuthorize)
export class AdminDatabaseController extends BaseController {
	private db: Database;
	private auditLog: AuditLogService;

	// Jamais éditable depuis cet outil générique : casserait silencieusement le
	// hash-chain d'audit, ou modifierait l'état de migration du schéma.
	private static readonly PROTECTED_TABLES = new Set([
		"audit_log",
		"mikro_orm_migrations",
		"oauth_csrf",
		"user_connection",
	]);

	constructor() {
		super();
		[this.db, this.auditLog] = resolveDependenciesSync([Database, AuditLogService]);
	}

	private requireSuperAdmin(ctx: Context): UserDTO {
		const user = ctx.get("user") as UserDTO | undefined;
		if (!user) throw new Unauthorized("Non authentifié");
		if ((user.role ?? 0) < UserRole.SuperAdministrator) {
			throw new Forbidden("Réservé aux super-administrateurs");
		}
		return user;
	}

	private quoteIdent(name: string): string {
		// name vient toujours d'information_schema (jamais interpolé brut depuis
		// le client) — l'échappement est une défense en profondeur.
		return `"${name.replace(/"/g, '""')}"`;
	}

	private async assertTable(table: string): Promise<void> {
		if (AdminDatabaseController.PROTECTED_TABLES.has(table)) {
			throw new BadRequest(`Table "${table}" protégée, non éditable depuis cet outil.`);
		}
		const conn = this.db.em.getConnection();
		const rows = (await conn.execute(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ?`,
			[table]
		)) as unknown[];
		if (rows.length === 0) throw new BadRequest(`Table "${table}" introuvable.`);
	}

	private async getColumns(table: string): Promise<ColumnMeta[]> {
		const conn = this.db.em.getConnection();
		const cols = (await conn.execute(
			`SELECT column_name, data_type, is_nullable, column_default
			 FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = ?
			 ORDER BY ordinal_position`,
			[table]
		)) as Array<{
			column_name: string;
			data_type: string;
			is_nullable: string;
			column_default: string | null;
		}>;
		const pkRows = (await conn.execute(
			`SELECT kcu.column_name
			 FROM information_schema.table_constraints tc
			 JOIN information_schema.key_column_usage kcu
			   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
			 WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ?`,
			[table]
		)) as Array<{ column_name: string }>;
		const pkSet = new Set(pkRows.map((r) => r.column_name));
		return cols.map((c) => ({
			name: c.column_name,
			dataType: c.data_type,
			nullable: c.is_nullable === "YES",
			default: c.column_default,
			isPrimaryKey: pkSet.has(c.column_name),
		}));
	}

	/** Ne garde que les clés qui sont de vraies colonnes de la table (whitelist). */
	private filterKnownColumns(
		values: Record<string, unknown>,
		columns: ColumnMeta[]
	): Record<string, unknown> {
		const names = new Set(columns.map((c) => c.name));
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(values ?? {})) {
			if (names.has(k)) out[k] = v;
		}
		return out;
	}

	@Get("/tables")
	async listTables(@Context() ctx: Context, @Res() res: Response) {
		this.requireSuperAdmin(ctx);
		const conn = this.db.em.getConnection();
		const tables = (await conn.execute(
			`SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS estimate
			 FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relkind = 'r'
			 ORDER BY c.relname`
		)) as Array<{ name: string; estimate: string }>;
		return res.json({
			data: tables.map((t) => ({
				name: t.name,
				estimatedRows: Number(t.estimate),
				protected: AdminDatabaseController.PROTECTED_TABLES.has(t.name),
			})),
		});
	}

	@Get("/tables/:table/columns")
	async columns(@PathParams("table") table: string, @Context() ctx: Context, @Res() res: Response) {
		this.requireSuperAdmin(ctx);
		await this.assertTable(table);
		return res.json({ data: await this.getColumns(table) });
	}

	@Get("/tables/:table/rows")
	async rows(
		@PathParams("table") table: string,
		@Context() ctx: Context,
		@Res() res: Response,
		@QueryParams("page") page = 1,
		@QueryParams("limit") limit = 25,
		@QueryParams("sort") sort?: string,
		@QueryParams("order") order?: string
	) {
		this.requireSuperAdmin(ctx);
		await this.assertTable(table);
		const columns = await this.getColumns(table);
		const lim = Math.min(200, Math.max(1, Number(limit) || 25));
		const pg = Math.max(1, Number(page) || 1);
		const offset = (pg - 1) * lim;

		const sortCol = columns.find((c) => c.name === sort)?.name;
		const orderBy = sortCol
			? `ORDER BY ${this.quoteIdent(sortCol)} ${order === "desc" ? "DESC" : "ASC"}`
			: "";

		const conn = this.db.em.getConnection();
		const [dataRows, countRows] = await Promise.all([
			conn.execute(`SELECT * FROM ${this.quoteIdent(table)} ${orderBy} LIMIT ? OFFSET ?`, [
				lim,
				offset,
			]),
			conn.execute(`SELECT COUNT(*)::int AS total FROM ${this.quoteIdent(table)}`),
		]);
		const total = (countRows as Array<{ total: number }>)[0]?.total ?? 0;

		return res.json({
			data: dataRows,
			columns,
			meta: { page: pg, limit: lim, total, pageCount: Math.ceil(total / lim) },
		});
	}

	@Post("/tables/:table/rows")
	async insertRow(
		@PathParams("table") table: string,
		@BodyParams("values") values: Record<string, unknown>,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = this.requireSuperAdmin(ctx);
		await this.assertTable(table);
		const columns = await this.getColumns(table);
		const safe = this.filterKnownColumns(values ?? {}, columns);
		const keys = Object.keys(safe);
		if (keys.length === 0) throw new BadRequest("Aucune valeur valide fournie.");

		const conn = this.db.em.getConnection();
		const colSql = keys.map((k) => this.quoteIdent(k)).join(", ");
		const placeholders = keys.map(() => "?").join(", ");
		const sql = `INSERT INTO ${this.quoteIdent(table)} (${colSql}) VALUES (${placeholders}) RETURNING *`;
		const inserted = (await conn.execute(
			sql,
			keys.map((k) => safe[k])
		)) as Record<string, unknown>[];

		await this.auditLog.log({
			actor_id: user.id,
			action: "admin_db.insert",
			target_type: table,
			target_id: null,
			payload: { values: safe },
		});

		return res.json({ success: true, row: inserted[0] ?? null });
	}

	@Patch("/tables/:table/rows")
	async updateRow(
		@PathParams("table") table: string,
		@BodyParams("pk") pk: Record<string, unknown>,
		@BodyParams("values") values: Record<string, unknown>,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = this.requireSuperAdmin(ctx);
		await this.assertTable(table);
		const columns = await this.getColumns(table);
		const pkColumns = columns.filter((c) => c.isPrimaryKey);
		if (pkColumns.length === 0) {
			throw new BadRequest("Table sans clé primaire détectable — édition refusée par sécurité.");
		}
		const safePk = this.filterKnownColumns(pk ?? {}, pkColumns);
		if (Object.keys(safePk).length !== pkColumns.length) {
			throw new BadRequest("Clé primaire incomplète.");
		}
		const safeValues = this.filterKnownColumns(values ?? {}, columns);
		// N'édite jamais la clé primaire elle-même via ce chemin (sécurité + simplicité).
		for (const c of pkColumns) delete safeValues[c.name];
		const keys = Object.keys(safeValues);
		if (keys.length === 0) throw new BadRequest("Aucune valeur à modifier.");

		const conn = this.db.em.getConnection();
		const setClause = keys.map((k) => `${this.quoteIdent(k)} = ?`).join(", ");
		const pkKeys = Object.keys(safePk);
		const whereClause = pkKeys.map((k) => `${this.quoteIdent(k)} = ?`).join(" AND ");
		const sql = `UPDATE ${this.quoteIdent(table)} SET ${setClause} WHERE ${whereClause} RETURNING *`;
		const params = [...keys.map((k) => safeValues[k]), ...pkKeys.map((k) => safePk[k])];
		const updated = (await conn.execute(sql, params)) as Record<string, unknown>[];
		if (updated.length === 0) throw new BadRequest("Ligne introuvable.");

		await this.auditLog.log({
			actor_id: user.id,
			action: "admin_db.update",
			target_type: table,
			target_id: JSON.stringify(safePk),
			payload: { pk: safePk, values: safeValues },
		});

		return res.json({ success: true, row: updated[0] });
	}

	@Delete("/tables/:table/rows")
	async deleteRow(
		@PathParams("table") table: string,
		@BodyParams("pk") pk: Record<string, unknown>,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = this.requireSuperAdmin(ctx);
		await this.assertTable(table);
		const columns = await this.getColumns(table);
		const pkColumns = columns.filter((c) => c.isPrimaryKey);
		if (pkColumns.length === 0) {
			throw new BadRequest(
				"Table sans clé primaire détectable — suppression refusée par sécurité."
			);
		}
		const safePk = this.filterKnownColumns(pk ?? {}, pkColumns);
		if (Object.keys(safePk).length !== pkColumns.length) {
			throw new BadRequest("Clé primaire incomplète.");
		}

		const conn = this.db.em.getConnection();
		const pkKeys = Object.keys(safePk);
		const whereClause = pkKeys.map((k) => `${this.quoteIdent(k)} = ?`).join(" AND ");
		const sql = `DELETE FROM ${this.quoteIdent(table)} WHERE ${whereClause} RETURNING *`;
		const deleted = (await conn.execute(
			sql,
			pkKeys.map((k) => safePk[k])
		)) as Record<string, unknown>[];
		if (deleted.length === 0) throw new BadRequest("Ligne introuvable.");

		await this.auditLog.log({
			actor_id: user.id,
			action: "admin_db.delete",
			target_type: table,
			target_id: JSON.stringify(safePk),
			payload: { pk: safePk },
		});

		return res.json({ success: true });
	}

	/** Console SQL en lecture seule (SELECT/WITH, une seule instruction). */
	@Post("/query")
	async query(@BodyParams("sql") sql: string, @Context() ctx: Context, @Res() res: Response) {
		const user = this.requireSuperAdmin(ctx);
		if (env.isProduction) {
			throw new Forbidden("La console SQL libre est désactivée en production");
		}
		if (!sql || typeof sql !== "string") throw new BadRequest("Requête vide.");
		const trimmed = sql.trim().replace(/;+\s*$/, "");
		if (trimmed.includes(";")) {
			throw new BadRequest("Une seule instruction à la fois (pas de `;` en milieu de requête).");
		}
		if (!/^select\s/i.test(trimmed) && !/^with\s/i.test(trimmed)) {
			throw new BadRequest("Lecture seule : la requête doit commencer par SELECT ou WITH.");
		}

		const conn = this.db.em.getConnection();
		const started = Date.now();
		const data = (await conn.execute(trimmed)) as Record<string, unknown>[];

		await this.auditLog.log({
			actor_id: user.id,
			action: "admin_db.query",
			target_type: "sql",
			target_id: null,
			payload: { sql: trimmed, rowCount: data.length },
		});

		return res.json({ data, rowCount: data.length, durationMs: Date.now() - started });
	}
}
