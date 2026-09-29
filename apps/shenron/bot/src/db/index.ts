import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { singleton } from "tsyringe";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "~/lib/env";
import * as schema from "./schema";

export type DB = BunSQLiteDatabase<typeof schema>;

@singleton()
export class DatabaseService {
	readonly sqlite: Database;
	readonly db: DB;

	constructor() {
		const targetPath = env.DATABASE_PATH;
		mkdirSync(dirname(targetPath), { recursive: true });
		this.sqlite = new Database(targetPath, { create: true });
		this.configureSqlite();
		this.db = drizzle(this.sqlite, { schema });
	}

	static forPath(customPath: string): DatabaseService {
		const instance = Object.create(DatabaseService.prototype) as DatabaseService;
		if (customPath !== ":memory:") mkdirSync(dirname(customPath), { recursive: true });
		(instance as any).sqlite = new Database(customPath, { create: true });
		(instance as any).configureSqlite();
		(instance as any).db = drizzle((instance as any).sqlite, { schema });
		return instance;
	}

	static forReadOnlyPath(customPath: string): DatabaseService {
		const instance = Object.create(DatabaseService.prototype) as DatabaseService;
		(instance as any).sqlite = new Database(customPath, { readonly: true, create: false });
		(instance as any).db = drizzle((instance as any).sqlite);
		return instance;
	}

	private configureSqlite() {
		// Concurrence + durabilité raisonnable
		this.sqlite.exec("PRAGMA journal_mode = WAL");
		this.sqlite.exec("PRAGMA synchronous = NORMAL");
		this.sqlite.exec("PRAGMA foreign_keys = ON");
		this.sqlite.exec("PRAGMA busy_timeout = 5000");
		// Performance reads (leaderboard ORDER BY xp, action_logs filtres, RAG kNN)
		// - cache_size négatif = KiB (-131072 = 128 MiB, partagé via WAL across readers)
		// - temp_store=MEMORY évite les spills disque sur ORDER BY/GROUP BY
		// - mmap_size=512MiB → page reads zero-copy (cap RAM systemd relevé à 2.5G ⇒ OK,
		//   la base fait ~200-400 Mo ; mmap couvre quasi tout le fichier sans I/O)
		// Le VPS a 11 Go et ~8 Go libres : on exploite la RAM pour éviter les I/O disque.
		this.sqlite.exec("PRAGMA cache_size = -131072");
		this.sqlite.exec("PRAGMA temp_store = MEMORY");
		this.sqlite.exec("PRAGMA mmap_size = 536870912");

		// Table de feedback et entraînement direct RAG & APIs (création idempotente)
		this.sqlite.exec(`
			CREATE TABLE IF NOT EXISTS rag_training_feedback (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				user_tag TEXT,
				type TEXT NOT NULL DEFAULT 'rag',
				query TEXT NOT NULL,
				rating INTEGER,
				status TEXT NOT NULL DEFAULT 'pending',
				expected TEXT,
				comment TEXT,
				target_id TEXT,
				created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
			);
			CREATE INDEX IF NOT EXISTS idx_rag_feedback_user ON rag_training_feedback(user_id);
			CREATE INDEX IF NOT EXISTS idx_rag_feedback_type ON rag_training_feedback(type);
			CREATE INDEX IF NOT EXISTS idx_rag_feedback_status ON rag_training_feedback(status);
			CREATE INDEX IF NOT EXISTS idx_rag_feedback_created ON rag_training_feedback(created_at);

			-- Table des signalements admin (site, bot, wiki, canon, databooks)
			CREATE TABLE IF NOT EXISTS admin_reports (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				user_tag TEXT,
				category TEXT NOT NULL DEFAULT 'other',
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				severity TEXT NOT NULL DEFAULT 'minor',
				status TEXT NOT NULL DEFAULT 'open',
				resolution_notes TEXT,
				created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
				resolved_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_admin_reports_category ON admin_reports(category);
			CREATE INDEX IF NOT EXISTS idx_admin_reports_status ON admin_reports(status);
			CREATE INDEX IF NOT EXISTS idx_admin_reports_severity ON admin_reports(severity);
			CREATE INDEX IF NOT EXISTS idx_admin_reports_created ON admin_reports(created_at);

			-- Table des objectifs de session et roadmap fixés par les admins
			CREATE TABLE IF NOT EXISTS admin_goals (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				user_tag TEXT,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				priority TEXT NOT NULL DEFAULT 'p1',
				status TEXT NOT NULL DEFAULT 'pending',
				target_session TEXT DEFAULT 'next_session',
				assigned_to TEXT DEFAULT 'all_agents',
				notes TEXT,
				created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
				completed_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_admin_goals_priority ON admin_goals(priority);
			CREATE INDEX IF NOT EXISTS idx_admin_goals_status ON admin_goals(status);
			CREATE INDEX IF NOT EXISTS idx_admin_goals_target ON admin_goals(target_session);
			CREATE INDEX IF NOT EXISTS idx_admin_goals_created ON admin_goals(created_at);

			-- Table d'historique des évaluations du RAG (surveillance des dérives)
			CREATE TABLE IF NOT EXISTS rag_eval_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				recall_1 REAL NOT NULL,
				recall_3 REAL NOT NULL,
				recall_5 REAL NOT NULL,
				recall_10 REAL NOT NULL,
				mrr REAL NOT NULL,
				ndcg REAL NOT NULL,
				duration_ms INTEGER NOT NULL,
				cases_count INTEGER NOT NULL,
				sidecar_online INTEGER NOT NULL DEFAULT 0,
				misses_count INTEGER NOT NULL DEFAULT 0,
				misses_json TEXT,
				created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
			);
			CREATE INDEX IF NOT EXISTS idx_rag_eval_created ON rag_eval_history(created_at);
			CREATE INDEX IF NOT EXISTS idx_rag_eval_recall5 ON rag_eval_history(recall_5);

			-- Table d'archivage des messages du salon admin lab
			CREATE TABLE IF NOT EXISTS admin_lab_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				message_id TEXT NOT NULL UNIQUE,
				user_id TEXT NOT NULL,
				user_tag TEXT,
				content TEXT NOT NULL,
				has_attachments INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
			);
			CREATE INDEX IF NOT EXISTS idx_lab_messages_user ON admin_lab_messages(user_id);
			CREATE INDEX IF NOT EXISTS idx_lab_messages_created ON admin_lab_messages(created_at);
		`);
	}

	close() {
		this.sqlite.close();
	}

	runRaw(sql: string) {
		this.sqlite.exec(sql);
	}
}
