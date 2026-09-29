/**
 * Admin write endpoints used by the site's IA cockpit (/admin/ia).
 *
 * The bot owns these runtime tables (SQLite, mirrored into PostgreSQL `bot.*`)
 * and the gold set file. The site reads the mirror and sends its writes here
 * instead of opening `bot.db`. Every route is mounted behind `admin()`.
 *
 *   POST /api/admin/goals                   { title, description?, userId, userTag? }
 *   POST /api/admin/goals/:id/complete      { notes? }
 *   POST /api/training/feedback/:id/status  { status }
 *   POST /api/training/gold                 { q, expect[], userId?, userTag? }
 *   POST /api/training/eval                 { samples? }
 */
import type { AdminReportGoalService } from "~/services/AdminReportGoalService";
import type { EvalMetrics, TrainingService } from "~/services/TrainingService";

import {
	FEEDBACK_STATUSES,
	GOAL_PRIORITIES,
	type FeedbackStatus,
} from "@shenron/db/constants";

// Source unique des statuts et priorités : `@shenron/db/constants` (mêmes noms qu'avant).
export {   type FeedbackStatus };
/** Same representativeness rule as `TrainingService.evaluateRag`. */
const MIN_PERSISTED_SAMPLES = 10;

export interface IaCockpitDeps {
	goals: Pick<AdminReportGoalService, "createGoal" | "completeGoal">;
	training: Pick<TrainingService, "addGoldCase" | "evaluateRag" | "recordEvalSnapshot">;
	/** Returns false when no feedback row has this id. */
	setFeedbackStatus: (id: number, status: FeedbackStatus) => Promise<boolean>;
}

function fail(error: string, status = 400): Response {
	return Response.json({ ok: false, error }, { status });
}

function record(body: unknown): Record<string, unknown> {
	return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= max ? trimmed : null;
}

function parseId(raw: string | undefined): number | null {
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function createGoalRoute(deps: IaCockpitDeps, body: unknown): Promise<Response> {
	const input = record(body);
	const title = text(input.title, 200);
	const userId = text(input.userId, 64);
	if (!title) return fail("title requis (1 à 200 caractères)");
	if (!userId) return fail("userId requis");
	const description = input.description === undefined ? title : text(input.description, 4000);
	if (!description) return fail("description invalide (1 à 4000 caractères)");
	const priority = input.priority === undefined ? undefined : input.priority;
	if (priority !== undefined && !GOAL_PRIORITIES.includes(priority as (typeof GOAL_PRIORITIES)[number])) {
		return fail("priority doit valoir p0, p1, p2 ou p3");
	}
	const goal = await deps.goals.createGoal({
		userId,
		userTag: text(input.userTag, 100) ?? undefined,
		title,
		description,
		priority: priority as (typeof GOAL_PRIORITIES)[number] | undefined,
		targetSession: text(input.targetSession, 64) ?? undefined,
	});
	return Response.json({ ok: true, goal }, { status: 201 });
}

export async function completeGoalRoute(deps: IaCockpitDeps, rawId: string | undefined, body: unknown): Promise<Response> {
	const id = parseId(rawId);
	if (!id) return fail("id invalide");
	const notes = record(body).notes;
	if (notes !== undefined && notes !== null && typeof notes !== "string") return fail("notes invalides");
	const goal = await deps.goals.completeGoal(id, text(notes, 4000) ?? undefined);
	if (!goal) return fail(`Objectif #${id} introuvable`, 404);
	return Response.json({ ok: true, id });
}

export async function feedbackStatusRoute(deps: IaCockpitDeps, rawId: string | undefined, body: unknown): Promise<Response> {
	const id = parseId(rawId);
	if (!id) return fail("id invalide");
	const status = record(body).status;
	if (!FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
		return fail(`status doit valoir ${FEEDBACK_STATUSES.join(", ")}`);
	}
	if (!(await deps.setFeedbackStatus(id, status as FeedbackStatus))) return fail(`Retour #${id} introuvable`, 404);
	return Response.json({ ok: true, id, status });
}

export async function addGoldCaseRoute(deps: IaCockpitDeps, body: unknown): Promise<Response> {
	const input = record(body);
	const q = text(input.q, 500);
	const expect = Array.isArray(input.expect)
		? input.expect.map((value) => text(value, 300)).filter((value): value is string => value !== null)
		: [];
	if (!q || expect.length === 0) return fail("q et expect[] requis");
	const added = await deps.training.addGoldCase(
		q,
		expect,
		text(input.userId, 64) ?? "system",
		text(input.userTag, 100) ?? "admin"
	);
	if (!added) return fail("Cas doré refusé");
	return Response.json({ ok: true, q, expect }, { status: 201 });
}

/**
 * Runs the bot's own measure on its index. The snapshot is written explicitly
 * so `persisted` is true only once `rag_eval_history` accepted it.
 */
export async function evaluateRagRoute(deps: IaCockpitDeps, body: unknown): Promise<Response> {
	const raw = record(body).samples;
	const samples = raw === undefined || raw === null || raw === 0 ? 0 : Number(raw);
	if (!Number.isSafeInteger(samples) || samples < 0 || samples > 1_000) return fail("samples doit être un entier entre 0 et 1000");
	const metrics: EvalMetrics = await deps.training.evaluateRag(samples || undefined, { persist: false });
	if (metrics.cases === 0) return fail("Jeu doré vide ou illisible", 503);
	let persisted = false;
	let persistError: string | null = null;
	if (samples === 0 || samples >= MIN_PERSISTED_SAMPLES) {
		try {
			await deps.training.recordEvalSnapshot(metrics);
			persisted = true;
		} catch (error) {
			persistError = error instanceof Error ? error.message : String(error);
		}
	}
	return Response.json({ ok: true, metrics, persisted, persistError });
}
