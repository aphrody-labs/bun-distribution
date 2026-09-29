import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { BadRequest, NotFound, Unauthorized } from "@tsed/exceptions";
import type { Generated } from "kysely";

import { Service } from "@/decorators";
import { PlayerNoteCategory, PlayerNoteSeverity, UserRole } from "@/utils/enums";

import { PlayerNoteDocsSync } from "./PlayerNoteDocsSync";

interface PlayerNoteDatabase {
	player_note: PlayerNoteTable;
	user: UserTable;
	event: EventTable;
}
interface PlayerNoteTable {
	id: Generated<string>; target_id: string; author_id: string | null; tournament_id: number | null;
	category: PlayerNoteCategory; severity: PlayerNoteSeverity; content: string; resolved: Generated<boolean>;
	resolved_at: Date | null; resolved_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>;
}
interface UserTable {
	id: string; role: number; username: string | null; display_name: string; avatar: string | null;
}
interface EventTable { id: Generated<number>; name: string; }
type NoteRow = Omit<PlayerNoteTable, "id" | "created_at" | "updated_at"> & { id: string; created_at: Date; updated_at: Date };
type UserRow = { id: string; username: string | null; displayName: string; avatar: string | null };

export interface PlayerNoteRecord extends NoteRow {
	target: UserRow | null;
	author: UserRow | null;
	tournament: { id: number; name: string } | null;
	resolvedBy: UserRow | null;
	docsUrl?: string | null;
}

export interface PlayerNoteFilters {
	targetId?: string;
	tournamentId?: number;
	category?: PlayerNoteCategory;
	severity?: PlayerNoteSeverity;
	resolved?: boolean;
	search?: string;
	page: number;
	pageSize: number;
}

export interface CreatePlayerNoteInput {
	targetId: string;
	authorId: string;
	tournamentId?: number | null;
	category?: PlayerNoteCategory;
	severity?: PlayerNoteSeverity;
	content: string;
}

const MAX_CONTENT = 2000;
const db = createAchilleaSql<PlayerNoteDatabase>();

/** Métier des notes staff, indépendant de Discord et de l'ORM historique. */
@Service()
export class PlayerNoteService {
	constructor(private docsSync: PlayerNoteDocsSync) {}

	private async isStaff(userId: string): Promise<boolean> {
		const actor = await db.selectFrom("user").select(["role"]).where("id", "=", userId).executeTakeFirst();
		return (actor?.role ?? 0) >= UserRole.Moderator;
	}

	async assertCanAccess(userId: string, tournamentId?: number | null): Promise<{ isStaff: boolean }> {
		if (await this.isStaff(userId)) return { isStaff: true };
		if (tournamentId) {
			const { TournamentsService } = await import("./TournamentsService");
			const { resolveDependency } = await import("@/utils/functions");
			const tournaments = await resolveDependency(TournamentsService);
			await tournaments.isTournamentOrganizer(userId, tournamentId);
			return { isStaff: false };
		}
		throw new Unauthorized("Réservé au staff et aux organisateurs du tournoi concerné.");
	}

	async create(input: CreatePlayerNoteInput): Promise<PlayerNoteRecord> {
		const content = (input.content ?? "").trim();
		if (content.length < 3) throw new BadRequest("La note doit contenir au moins 3 caractères.");
		const target = await db.selectFrom("user").selectAll().where("id", "=", input.targetId).executeTakeFirst();
		if (!target) throw new NotFound("Joueur introuvable.");
		if (input.tournamentId) {
			const tournament = await db.selectFrom("event").select("id").where("id", "=", input.tournamentId).executeTakeFirst();
			if (!tournament) throw new NotFound("Tournoi introuvable.");
		}
		const inserted = await db.insertInto("player_note").values({
			target_id: input.targetId,
			author_id: input.authorId,
			tournament_id: input.tournamentId ?? null,
			category: input.category ?? PlayerNoteCategory.OTHER,
			severity: input.severity ?? PlayerNoteSeverity.INFO,
			content: content.slice(0, MAX_CONTENT),
			resolved: false,
			resolved_at: null,
			resolved_by: null,
		}).returningAll().executeTakeFirstOrThrow();
		const note = await this.findOrFail(inserted.id);
		note.docsUrl = await this.docsSync.appendNote(note);
		return note;
	}

	async list(filters: PlayerNoteFilters): Promise<{ items: PlayerNoteRecord[]; total: number }> {
		let query = this.baseQuery();
		query = this.applyFilters(query, filters);
		const countQuery = this.applyFilters(db.selectFrom("player_note as note"), filters);
		const [rows, count] = await Promise.all([
			query.orderBy("note.created_at", "desc").limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize).execute(),
			(countQuery as any).select(({ fn }: any) => fn.countAll().as("count")).executeTakeFirst(),
		]);
		return { items: rows.map(toRecord), total: Number(count?.count ?? 0) };
	}

	async update(noteId: string, actorId: string, patch: { content?: string; category?: PlayerNoteCategory; severity?: PlayerNoteSeverity }): Promise<PlayerNoteRecord> {
		const note = await this.findOrFail(noteId);
		const actor = await db.selectFrom("user").select(["role"]).where("id", "=", actorId).executeTakeFirst();
		if (note.author_id !== actorId && (actor?.role ?? 0) < UserRole.Administrator)
			throw new Unauthorized("Seul l'auteur de la note ou un administrateur peut la modifier.");
		const values: { content?: string; category?: PlayerNoteCategory; severity?: PlayerNoteSeverity; updated_at?: Date } = {};
		if (patch.content !== undefined) {
			const content = patch.content.trim();
			if (content.length < 3) throw new BadRequest("La note doit contenir au moins 3 caractères.");
			values.content = content.slice(0, MAX_CONTENT);
		}
		if (patch.category) values.category = patch.category;
		if (patch.severity) values.severity = patch.severity;
		if (Object.keys(values).length) values.updated_at = new Date();
		await db.updateTable("player_note").set(values).where("id", "=", noteId).execute();
		return this.findOrFail(noteId);
	}

	async setResolved(noteId: string, actorId: string, resolved: boolean): Promise<PlayerNoteRecord> {
		await this.findOrFail(noteId);
		await db.updateTable("player_note").set({
			resolved, resolved_at: resolved ? new Date() : null, resolved_by: resolved ? actorId : null, updated_at: new Date(),
		}).where("id", "=", noteId).execute();
		const note = await this.findOrFail(noteId);
		await this.docsSync.appendResolution(note, resolved);
		return note;
	}

	async remove(noteId: string, actorId: string): Promise<void> {
		const note = await this.findOrFail(noteId);
		const actor = await db.selectFrom("user").select(["role"]).where("id", "=", actorId).executeTakeFirst();
		if (note.author_id !== actorId && (actor?.role ?? 0) < UserRole.Administrator)
			throw new Unauthorized("Seul l'auteur de la note ou un administrateur peut la supprimer.");
		await db.deleteFrom("player_note").where("id", "=", noteId).execute();
	}

	async summaryForUser(userId: string) {
		const rows = await db.selectFrom("player_note").select(["severity", "resolved"]).where("target_id", "=", userId).execute();
		const bySeverity = { [PlayerNoteSeverity.INFO]: 0, [PlayerNoteSeverity.WARNING]: 0, [PlayerNoteSeverity.SERIOUS]: 0 };
		for (const row of rows) bySeverity[row.severity as PlayerNoteSeverity] = (bySeverity[row.severity as PlayerNoteSeverity] ?? 0) + 1;
		return { total: rows.length, open: rows.filter((row) => !row.resolved).length, bySeverity };
	}

	private baseQuery() {
		return db.selectFrom("player_note as note")
			.leftJoin("user as target", "target.id", "note.target_id")
			.leftJoin("user as author", "author.id", "note.author_id")
			.leftJoin("user as resolvedBy", "resolvedBy.id", "note.resolved_by")
			.leftJoin("event as tournament", "tournament.id", "note.tournament_id")
			.selectAll("note")
			.select([
				"target.id as target_id", "target.username as target_username", "target.display_name as target_display_name", "target.avatar as target_avatar",
				"author.id as author_id_join", "author.username as author_username", "author.display_name as author_display_name", "author.avatar as author_avatar",
				"resolvedBy.id as resolved_by_id_join", "resolvedBy.username as resolved_by_username", "resolvedBy.display_name as resolved_by_display_name", "resolvedBy.avatar as resolved_by_avatar",
				"tournament.id as tournament_id_join", "tournament.name as tournament_name",
			]);
	}

	private applyFilters(query: any, filters: PlayerNoteFilters): any {
		if (filters.targetId) query = query.where("note.target_id", "=", filters.targetId);
		if (filters.tournamentId) query = query.where("note.tournament_id", "=", filters.tournamentId);
		if (filters.category) query = query.where("note.category", "=", filters.category);
		if (filters.severity) query = query.where("note.severity", "=", filters.severity);
		if (filters.resolved !== undefined) query = query.where("note.resolved", "=", filters.resolved);
		if (filters.search?.trim()) query = query.where("note.content", "ilike", `%${filters.search.trim()}%`);
		return query;
	}

	private async findOrFail(noteId: string): Promise<PlayerNoteRecord> {
		const rows = await this.baseQuery().where("note.id", "=", noteId).execute();
		if (!rows[0]) throw new NotFound("Note introuvable.");
		return toRecord(rows[0]);
	}

	toDTO(note: PlayerNoteRecord) {
		const person = (user: UserRow | null) => user ? { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar } : null;
		return {
			id: note.id, target: person(note.target), author: person(note.author),
			tournament: note.tournament, category: note.category, severity: note.severity,
			content: note.content, resolved: note.resolved, resolvedAt: note.resolved_at,
			resolvedBy: person(note.resolvedBy), createdAt: note.created_at, updatedAt: note.updated_at,
			docsUrl: note.docsUrl ?? null,
		};
	}
}

function toRecord(row: any): PlayerNoteRecord {
	return {
		...row,
		target: row.target_id ? { id: row.target_id, username: row.target_username, displayName: row.target_display_name, avatar: row.target_avatar } : null,
		author: row.author_id_join ? { id: row.author_id_join, username: row.author_username, displayName: row.author_display_name, avatar: row.author_avatar } : null,
		resolvedBy: row.resolved_by_id_join ? { id: row.resolved_by_id_join, username: row.resolved_by_username, displayName: row.resolved_by_display_name, avatar: row.resolved_by_avatar } : null,
		tournament: row.tournament_id_join ? { id: row.tournament_id_join, name: row.tournament_name } : null,
	};
}
