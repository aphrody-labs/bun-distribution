// SPDX-License-Identifier: Apache-2.0
/**
 * a2a.ts — Hub et Protocole Standard Agent-to-Agent (A2A) pour Shenron & Aphrody.
 *
 * Conforme à la spécification officielle Agent2Agent (A2A) v1 / a2a-js (JSON-RPC 2.0).
 * Unifie la communication bidirectionnelle entre Codex, agycli, Claude, les workers
 * locaux (OCR, modèles), le RAG Shenron et la flotte des sous-agents.
 *
 * Doctrine Honest Delivery (aucune réponse codée en dur) :
 * - `rag` : recherche RÉELLE via l'API publique ; FAIT seulement si des passages sourcés reviennent.
 * - `ocr` / `translation` (demande de statut) : état MESURÉ (PostgreSQL, systemd, results.db,
 *   heartbeat worker) ; FAIT seulement si tout est mesuré ET qu'un worker vivant est prouvé.
 * - Ordres de travail (codex, agycli, claude, local_model, subagents, ordre OCR) : la tâche reste
 *   `submitted` / `working` en INCOMPLET jusqu'à ce qu'un pair poste un résultat
 *   (`tasks/update`, `message/send` avec `taskId`, ou enveloppe reçue par l'API de coordination avec `re`).
 * - `broadcast` : `completed` au sens « déposé dans N boîtes », jamais FAIT pour le travail sous-jacent.
 * - Alertes dans le salon Discord #bot-admin (1548677623935139901).
 */

import {
	appendRemoteEnvelope,
	aphrodyA2aStoreEnabled,
	createRemoteTask,
	getRemoteTask,
	listRemoteEnvelopes,
	listRemoteTasks,
	putRemoteTask,
} from "./a2a-remote";
import {
	defaultA2AProbes,
	resolveCoordDir,
	type A2AProbes,
	type DatabooksPipelineSnapshot,
	type HeartbeatState,
	type OcrResultsDbState,
	type UnitState,
} from "./a2a-probes";

export * from "./a2a-probes";

export const A2A_PROTOCOL_VERSION = "1.0.0";
export const SHENRON_A2A_AGENT_ID = "shenron-dragonball";
export const DISCORD_BO_ADMIN_CHANNEL = "1548677623935139901";

/** Discord message posted by the hub (same shape as `sendAdminLabMessage` options). */
export interface AdminNotification {
	channelId: string;
	embeds: Array<Record<string, unknown>>;
}

/**
 * Transport for the #bot-admin alerts, injected by the host application
 * (bot or site `admin-lab` module) through {@link ShenronA2AHub.configure}.
 */
export type AdminNotifier = (message: AdminNotification) => Promise<unknown>;

/** Runtime wiring of the hub; `null` clears a previously configured value. */
export interface A2AHubConfig {
	notifier?: AdminNotifier | null;
	coordDir?: string | null;
}

const hubConfig: { notifier: AdminNotifier | null; coordDir: string | null } = {
	notifier: null,
	coordDir: null,
};
let missingNotifierWarned = false;

// ============================================================================
// 1. Types Standardisés du Protocole A2A (JSON-RPC 2.0 & Discriminated Unions)
// ============================================================================

import { COORD_ENVELOPE_KINDS, type CoordEnvelope, type CoordEnvelopeKind } from "./coord.generated";

export type A2ARole = "user" | "agent" | "system";

export type A2AEnvelopeKind = CoordEnvelopeKind;
export const A2A_ENVELOPE_KINDS: readonly A2AEnvelopeKind[] = COORD_ENVELOPE_KINDS;

/**
 * Enveloppe standard du protocole A2A coord (compatible ai.json v1 & a2a-ui).
 * `verdict`, `artifacts` et `taskId` sont optionnels : un pair qui répond à un ordre
 * (champ `re` = id de l'enveloppe d'origine) les renseigne pour clore la tâche.
 */
export interface A2AEnvelope extends Omit<CoordEnvelope, "channel_hint"> {
	// Legacy peers may provide additional transport names.
	channel_hint?: string[];
	taskId?: string;
	verdict?: HonestDeliveryVerdict;
	artifacts?: A2AArtifact[];
}

export type A2ATarget =
	| "codex"
	| "agycli"
	| "claude"
	| "local_model"
	| "rag"
	| "subagents"
	| "ocr"
	| "translation"
	| "broadcast";

export const A2A_TARGETS: readonly A2ATarget[] = [
	"codex",
	"agycli",
	"claude",
	"local_model",
	"rag",
	"subagents",
	"ocr",
	"translation",
	"broadcast",
];

export type A2ATaskStatus =
	| "submitted"
	| "working"
	| "input_required"
	| "completed"
	| "failed"
	| "canceled";

export type HonestDeliveryVerdict = "FAIT" | "INCOMPLET" | "NON_FAIT";

const VERDICTS: readonly HonestDeliveryVerdict[] = new Set(["FAIT", "INCOMPLET", "NON_FAIT"]);
const TERMINAL_STATUSES: readonly A2ATaskStatus[] = new Set(["completed", "failed", "canceled"]);

export interface A2ATextPart {
	type: "text";
	text: string;
}

export interface A2ADataPart {
	type: "data";
	data: Record<string, unknown>;
}

export interface A2AFilePart {
	type: "file";
	file: {
		name: string;
		mimeType?: string;
		uri?: string;
		bytesBase64?: string;
	};
}

export type A2APart = A2ATextPart | A2ADataPart | A2AFilePart;

export interface A2AMessage {
	role: A2ARole;
	parts: A2APart[];
	contextId?: string;
	taskId?: string;
	metadata?: {
		sourceAgent?: string;
		targetAgent?: A2ATarget;
		yolo?: boolean;
		timestamp?: string;
		[key: string]: unknown;
	};
}

export interface A2AArtifact {
	name: string;
	type: "json" | "markdown" | "code" | "file";
	uri?: string;
	data?: unknown;
	content?: string;
}

export interface A2ATask {
	id: string;
	target: A2ATarget;
	status: A2ATaskStatus;
	verdict?: HonestDeliveryVerdict;
	description: string;
	createdAt: string;
	updatedAt: string;
	history: A2AMessage[];
	artifacts: A2AArtifact[];
	metadata: Record<string, unknown>;
	resultMarkdown?: string;
	resultData?: Record<string, unknown>;
}

export interface A2AAgentSkill {
	id: string;
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
}

export interface A2AAgentCard {
	name: string;
	description: string;
	version: string;
	url: string;
	capabilities: {
		streaming: boolean;
		pushNotifications: boolean;
		yoloMode: boolean;
	};
	supportedTargets: A2ATarget[];
	skills: A2AAgentSkill[];
}

export interface JSONRPCRequest<T = unknown> {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params: T;
}

export interface JSONRPCSuccessResponse<T = unknown> {
	jsonrpc: "2.0";
	id: string | number;
	result: T;
}

export interface JSONRPCErrorResponse {
	jsonrpc: "2.0";
	id: string | number | null;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export type JSONRPCResponse<T = unknown> = JSONRPCSuccessResponse<T> | JSONRPCErrorResponse;

function newEnvelopeId(): string {
	return `env-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================================
// 2. Cache mémoire des tâches (source durable : Aphrody A2A Coord API)
// ============================================================================

/**
 * Le cache accélère la requête courante seulement. Les écritures durables passent
 * par `a2a-remote.ts`, qui cible l'espace Shenron isolé dans Aphrody.
 */
class TaskStore {
	private tasks = new Map<string, A2ATask>();

	create(target: A2ATarget, description: string, metadata: Record<string, unknown> = {}): A2ATask {
		const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const now = new Date().toISOString();
		const task: A2ATask = {
			id,
			target,
			status: "submitted",
			description,
			createdAt: now,
			updatedAt: now,
			history: [],
			artifacts: [],
			metadata: {
				...metadata,
				protocol: "A2A",
				version: A2A_PROTOCOL_VERSION,
				yolo: true,
			},
		};
		this.tasks.set(id, task);
		return task;
	}

	get(id: string): A2ATask | undefined {
		return this.tasks.get(id);
	}

	hydrate(task: A2ATask): A2ATask {
		const current = this.tasks.get(task.id);
		if (!current || task.updatedAt >= current.updatedAt) this.tasks.set(task.id, task);
		return this.tasks.get(task.id)!;
	}

	/** Recherche une tâche par l'id de son enveloppe d'origine (`metadata.envelopeId`). */
	findByEnvelopeId(envelopeId: string): A2ATask | undefined {
		return this.list().find((t) => t.metadata?.envelopeId === envelopeId || (t as any).envelopeId === envelopeId);
	}

	list(targetFilter?: A2ATarget): A2ATask[] {
		const all = Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return targetFilter ? all.filter((t) => t.target === targetFilter) : all;
	}

	update(id: string, patch: Partial<A2ATask>): A2ATask | undefined {
		const task = this.tasks.get(id) ?? this.get(id);
		if (!task) return undefined;
		// `updatedAt` strictement croissant : deux écritures dans la même milliseconde
		// ne doivent pas laisser l'instantané le plus ancien gagner à la relecture.
		const now = new Date().toISOString();
		const updatedAt = now > task.updatedAt ? now : new Date(Date.parse(task.updatedAt) + 1).toISOString();
		Object.assign(task, patch, { updatedAt });
		this.tasks.set(id, task);
		return task;
	}
}

export const a2aTaskStore = new TaskStore();

// ============================================================================
// 2b. Cache mémoire des enveloppes (source durable : Aphrody A2A Coord API)
// ============================================================================

class CoordMailboxStore {
	private memoryEnvelopes: A2AEnvelope[] = [];

	/** Répertoire lu par la sonde heartbeat ; `A2A_COORD_DIR` peut changer (tests et hôtes). */
	get coordDir(): string {
		return hubConfig.coordDir ?? resolveCoordDir();
	}

	/** Cache l'enveloppe dans la requête courante ; la source distante est écrite par l'adaptateur. */
	append(env: A2AEnvelope): string | null {
		this.memoryEnvelopes.push(env);
		return null;
	}

	list(limit = 100): A2AEnvelope[] {
		return [...this.memoryEnvelopes].sort((a, b) => (b.ts || "").localeCompare(a.ts || "")).slice(0, limit);
	}

	merge(envelopes: A2AEnvelope[]) {
		const seen = new Set(this.memoryEnvelopes.map((envelope) => envelope.id));
		for (const envelope of envelopes) {
			if (!seen.has(envelope.id)) this.memoryEnvelopes.push(envelope);
		}
	}
}

export const coordMailboxStore = new CoordMailboxStore();

function requireDurableStoreInProduction(): void {
	if (!aphrodyA2aStoreEnabled() && process.env.NODE_ENV === "production") {
		throw new Error("APHRODY_A2A_COORD_API is required for durable Shenron A2A in production");
	}
}

async function storeEnvelope(envelope: A2AEnvelope): Promise<string> {
	coordMailboxStore.append(envelope);
	if (aphrodyA2aStoreEnabled()) {
		await appendRemoteEnvelope(envelope);
		return `aphrody-a2a://${SHENRON_A2A_AGENT_ID}/envelopes/${encodeURIComponent(envelope.id)}`;
	}
	requireDurableStoreInProduction();
	return `memory://${SHENRON_A2A_AGENT_ID}/envelopes/${encodeURIComponent(envelope.id)}`;
}

async function loadTask(taskId: string): Promise<A2ATask | undefined> {
	if (aphrodyA2aStoreEnabled()) {
		const remote = await getRemoteTask(taskId);
		if (remote) return a2aTaskStore.hydrate(remote);
	}
	requireDurableStoreInProduction();
	return a2aTaskStore.get(taskId);
}

async function loadTasks(target?: A2ATarget): Promise<A2ATask[]> {
	if (aphrodyA2aStoreEnabled()) {
		const remote = await listRemoteTasks(target);
		return remote.map((task) => a2aTaskStore.hydrate(task));
	}
	requireDurableStoreInProduction();
	return a2aTaskStore.list(target);
}

async function persistTask(task: A2ATask, create = false): Promise<void> {
	if (!aphrodyA2aStoreEnabled()) {
		requireDurableStoreInProduction();
		return;
	}
	if (create) await createRemoteTask(task);
	else await putRemoteTask(task);
}

async function loadEnvelopes(limit: number): Promise<A2AEnvelope[]> {
	if (!aphrodyA2aStoreEnabled()) {
		requireDurableStoreInProduction();
		return coordMailboxStore.list(limit);
	}
	const remote = await listRemoteEnvelopes(limit);
	coordMailboxStore.merge(remote);
	return coordMailboxStore.list(limit);
}

// ============================================================================
// 3. Mesures d'état (OCR / traduction) et rendu
// ============================================================================

/** Unités systemd qui portent la chaîne databooks sur le VPS. */
export const PIPELINE_UNITS = ["shenron-traduction.service", "shenron-canon-ingest.service"];

const STATUS_WORDS =
	/(statut|status|état|etat|santé|sante|health|avancement|progress|où en est|ou en est|diagnostic|supervision|monitor)/iu;
const ACTION_WORDS =
	/(trait|lance|process|transcri|tradui|translat|ocrise|exécute|execute|relis|relire|ingère|ingere|ingest|scanne|run\b|start)/iu;

/** Une demande `ocr`/`translation` est une question de statut, ou un ordre de travail. */
export function isStatusRequest(instruction: string, data: Record<string, unknown> = {}): boolean {
	if (data.mode === "status") return true;
	if (data.mode === "order") return false;
	return STATUS_WORDS.test(instruction) && !ACTION_WORDS.test(instruction);
}

export interface PipelineStatusReport {
	measuredAt: string;
	databooks: DatabooksPipelineSnapshot;
	units: UnitState[];
	ocrResultsDb: OcrResultsDbState;
	ocrWorkerHeartbeat: HeartbeatState;
	gaps: string[];
	blockers: string[];
	verdict: HonestDeliveryVerdict;
}

/** Mesure l'état OCR + traduction ; le verdict ne vaut FAIT que sans aucun manque. */
export async function measurePipelineStatus(probes: A2AProbes): Promise<PipelineStatusReport> {
	const [databooks, units, ocrResultsDb, ocrWorkerHeartbeat] = await Promise.all([
		probes.databooksPipeline(),
		probes.systemdUnits(PIPELINE_UNITS),
		probes.ocrResultsDb(),
		probes.ocrHeartbeat(coordMailboxStore.coordDir),
	]);

	const gaps: string[] = [];
	const blockers: string[] = [];

	if (!databooks.measured) blockers.push(`compteurs databooks non mesurés — ${databooks.error}`);

	for (const u of units) {
		if (u.state === "unknown") gaps.push(`état systemd inconnu pour ${u.unit}${u.error ? ` (${u.error})` : ""}`);
		else if (u.state === "not-found") gaps.push(`unité ${u.unit} absente de cet hôte`);
	}
	const traduction = units.find((u) => u.unit === "shenron-traduction.service");
	if (traduction && traduction.state !== "active" && traduction.state !== "unknown") {
		gaps.push(
			`worker de traduction arrêté : ${traduction.unit} ${traduction.state}/${traduction.subState ?? "?"}${traduction.since ? ` depuis ${traduction.since}` : ""}`
		);
	}

	if (ocrWorkerHeartbeat.state === "none") {
		gaps.push(
			`aucun worker OCR prouvé vivant : aucun heartbeat OCR/GPU dans .coord (seuil ${ocrWorkerHeartbeat.maxAgeMinutes} min)`
		);
	} else if (ocrWorkerHeartbeat.state === "stale") {
		gaps.push(
			`worker OCR non prouvé vivant : dernier heartbeat ${ocrWorkerHeartbeat.peer} il y a ${ocrWorkerHeartbeat.ageMinutes} min (seuil ${ocrWorkerHeartbeat.maxAgeMinutes} min)`
		);
	}

	if (ocrResultsDb.state === "corrupt") {
		gaps.push(
			`results.db corrompu (${ocrResultsDb.path}) : ${(ocrResultsDb.messages ?? [ocrResultsDb.error ?? "?"]).join(" ; ")}`
		);
	} else if (ocrResultsDb.state === "absent") {
		gaps.push(`results.db absent (${ocrResultsDb.path})`);
	} else if (ocrResultsDb.state === "unknown") {
		gaps.push(`santé de results.db inconnue : ${ocrResultsDb.error ?? "non vérifiable"}`);
	}

	const verdict: HonestDeliveryVerdict =
		blockers.length > 0 ? "NON_FAIT" : gaps.length > 0 ? "INCOMPLET" : "FAIT";

	return {
		measuredAt: new Date().toISOString(),
		databooks,
		units,
		ocrResultsDb,
		ocrWorkerHeartbeat,
		gaps,
		blockers,
		verdict,
	};
}

const fr = (n: number) => n.toLocaleString("fr-FR");

export function renderPipelineStatusMarkdown(report: PipelineStatusReport): string {
	const lines: string[] = [`### État mesuré OCR & traduction (A2A) — ${report.verdict}`, ""];
	const d = report.databooks;
	if (d.measured) {
		lines.push(
			`**Databooks (PostgreSQL, mesuré ${d.measuredAt})**`,
			`- Planches : ${fr(d.pagesTotal)} — avec texte japonais : ${fr(d.withText)} — traduites (text_fr) : ${fr(d.withTextFr)}`,
			`- En attente d'OCR : ${fr(d.pendingOcr)} — en attente de traduction : ${fr(d.pendingTranslation)}`,
			`- Dernière traduction déposée : ${d.latestTextFrAt ?? "inconnue"}`,
			`- Par auteur : ${d.writers
				.slice(0, 8)
				.map((w) => `${w.writer} ${fr(w.pages)}${w.latestAt ? ` (dernier ${w.latestAt})` : ""}`)
				.join(" ; ")}`,
			""
		);
	} else {
		lines.push(`**Databooks** : non mesuré — ${d.error}`, "");
	}
	lines.push(
		`**Services systemd** : ${report.units
			.map((u) => `${u.unit} = ${u.state}${u.subState ? `/${u.subState}` : ""}${u.since ? ` (depuis ${u.since})` : ""}`)
			.join(" ; ")}`
	);
	const r = report.ocrResultsDb;
	lines.push(
		`**results.db** : ${r.state}${r.bytes != null ? ` (${fr(r.bytes)} octets)` : ""}${r.pagesByStatus ? ` — pages par statut : ${JSON.stringify(r.pagesByStatus)}` : ""}${r.error ? ` — ${r.error}` : ""}`
	);
	const h = report.ocrWorkerHeartbeat;
	lines.push(
		`**Worker OCR / GPU** : ${h.state === "alive" ? `vivant (heartbeat ${h.peer} il y a ${h.ageMinutes} min)` : h.state === "stale" ? `non prouvé (dernier heartbeat ${h.peer} il y a ${h.ageMinutes} min)` : "non prouvé (aucun heartbeat) — aucun état GPU n'est affirmé"}`
	);
	if (report.blockers.length) lines.push("", "**Bloqueurs**", ...report.blockers.map((b) => `- ${b}`));
	if (report.gaps.length) lines.push("", "**Manques**", ...report.gaps.map((g) => `- ${g}`));
	return lines.join("\n");
}

// ============================================================================
// 4. Dispatcher & Moteur d'Exécution A2A
// ============================================================================

export interface A2ASendResult {
	task: A2ATask;
	responseMarkdown: string;
	responseData: Record<string, unknown>;
	verdict: HonestDeliveryVerdict;
	responseEnvelope?: A2AEnvelope;
}

export interface A2ATaskUpdateParams {
	taskId: string;
	sourceAgent?: string;
	status?: A2ATaskStatus;
	verdict?: HonestDeliveryVerdict;
	text?: string;
	data?: Record<string, unknown>;
	artifacts?: A2AArtifact[];
	/** Identifiant d'une enveloppe déjà reçue et stockée par l'adaptateur de coordination. */
	envelopeId?: string;
}

export type A2ATaskUpdateResult =
	| { ok: true; task: A2ATask }
	| { ok: false; code: number; message: string };

function isArtifact(a: unknown): a is A2AArtifact {
	if (!a || typeof a !== "object") return false;
	const x = a as Record<string, unknown>;
	return (
		typeof x.name === "string" &&
		["json", "markdown", "code", "file"].includes(x.type as string) &&
		(x.uri !== undefined || x.data !== undefined || (typeof x.content === "string" && x.content.length > 0))
	);
}

function verdictFromText(text: string | undefined): HonestDeliveryVerdict | undefined {
	const m = /^\s*(?:[#>*_\s-]*)(FAIT|INCOMPLET|NON_FAIT)\b/.exec(text ?? "");
	return m ? (m[1] as HonestDeliveryVerdict) : undefined;
}

export class ShenronA2AHub {
	private static probes: A2AProbes = defaultA2AProbes;

	/** Remplace tout ou partie des sondes (tests, runtime sans PostgreSQL…). */
	static setProbes(overrides: Partial<A2AProbes>): void {
		this.probes = { ...defaultA2AProbes, ...overrides };
	}

	static resetProbes(): void {
		this.probes = defaultA2AProbes;
	}

	/**
	 * Injects the #bot-admin notifier and/or a heartbeat probe directory override
	 * (takes precedence over `A2A_COORD_DIR`). Omitted keys are left unchanged,
	 * `null` resets a key to its default.
	 */
	static configure(config: A2AHubConfig): void {
		if (config.notifier !== undefined) {
			hubConfig.notifier = config.notifier;
			missingNotifierWarned = false;
		}
		if (config.coordDir !== undefined) {
			hubConfig.coordDir = config.coordDir?.trim() || null;
		}
	}

	/**
	 * Retourne l'AgentCard officielle A2A de Shenron.
	 */
	static getAgentCard(baseUrl = "https://dragonballfr.com"): A2AAgentCard {
		return {
			name: SHENRON_A2A_AGENT_ID,
			description:
				"Hub A2A Dragon Ball : RAG sourcé réel, état mesuré OCR/traduction, et boîte d'ordres pour Codex, agycli, Claude, workers locaux et sous-agents (résultat seulement quand le pair le poste).",
			version: A2A_PROTOCOL_VERSION,
			url: `${baseUrl}/api/a2a`,
			capabilities: {
				streaming: false,
				pushNotifications: false,
				yoloMode: true,
			},
			supportedTargets: [...A2A_TARGETS],
			skills: [
				{
					id: "rag_query",
					name: "RAG Canonique",
					description:
						"Recherche hybride réelle sur l'index Shenron : passages, titres et URL absolues. FAIT seulement si au moins un passage revient.",
				},
				{
					id: "ocr_dispatch",
					name: "État OCR & traduction",
					description:
						"Statut mesuré (bot.db_databooks, systemd, results.db, heartbeat worker) ; un ordre OCR reste en attente jusqu'au résultat d'un worker.",
				},
				{
					id: "subagent_task",
					name: "Délégation d'ordres",
					description:
						"Dépôt d'un ordre dans la boîte Aphrody A2A namespacée pour un agent ou des sous-agents ; tâche submitted/INCOMPLET jusqu'au résultat du pair.",
				},
				{
					id: "model_infer",
					name: "Ordre pour worker local",
					description:
						"Dépôt d'un ordre pour un modèle local ; aucun modèle ni état VRAM n'est affirmé sans résultat du worker.",
				},
				{
					id: "task_update",
					name: "Clôture par un pair",
					description:
						"tasks/update, message/send avec taskId, ou enveloppe via l'API namespacée avec re : statut + verdict (FAIT exige au moins un artefact).",
				},
			],
		};
	}

	/**
	 * Notifie le salon Discord #bot-admin (#bo-admin) via webhook ou bot bot.
	 */
	static async notifyDiscordBoAdmin(
		title: string,
		text: string,
		kind: "brand" | "success" | "error" = "brand",
		fields?: Array<{ name: string; value: string; inline?: boolean }>
	) {
		const color = kind === "success" ? 0x22c55e : kind === "error" ? 0xef4444 : 0xf59e0b;
		const embed = {
			color,
			title: `[A2A] ${title}`,
			description: text,
			fields: fields ?? [],
			footer: { text: "Shenron A2A Unified Protocol" },
			timestamp: new Date().toISOString(),
		};

		const notifier = hubConfig.notifier;
		if (!notifier) {
			if (!missingNotifierWarned) {
				missingNotifierWarned = true;
				console.warn("[A2A] Aucun notificateur #bot-admin configuré (ShenronA2AHub.configure) : alertes Discord ignorées.");
			}
			return;
		}
		try {
			await notifier({
				channelId: DISCORD_BO_ADMIN_CHANNEL,
				embeds: [embed],
			});
		} catch (e: any) {
			console.warn(`[A2A] Alerte Discord non critique : ${e?.message ?? e}`);
		}
	}

	/**
	 * Envoie un message A2A avec acheminement vers la cible appropriée.
	 */
	static async sendMessage(params: {
		target: A2ATarget;
		sourceAgent?: string;
		instruction: string;
		data?: Record<string, unknown>;
		yolo?: boolean;
		contextId?: string;
	}): Promise<A2ASendResult> {
		const {
			target,
			sourceAgent = "unspecified",
			instruction,
			data = {},
			yolo = true,
			contextId,
		} = params;

		if (!A2A_TARGETS.includes(target)) {
			throw new Error(`Cible A2A inconnue : ${String(target)}`);
		}

		// 1. Enveloppe entrante (format ai.json v1 / a2a-ui)
		const incomingEnv: A2AEnvelope = {
			v: 1,
			ts: new Date().toISOString(),
			id: newEnvelopeId(),
			from: sourceAgent,
			to: target,
			kind: "ask",
			topic: instruction.slice(0, 80),
			body: instruction,
			channel_hint: ["file_jsonl", "http_jsonrpc"],
		};

		// 2. Création de la tâche A2A (liée à son enveloppe pour la clôture par `re`)
		const task = a2aTaskStore.create(target, instruction, {
			sourceAgent,
			contextId,
			yolo,
			inputData: data,
			envelopeId: incomingEnv.id,
		});
		await persistTask(task, true);
		incomingEnv.taskId = task.id;
		const mailboxUri = await storeEnvelope(incomingEnv);

		task.history.push({
			role: "user",
			parts: [
				{ type: "text", text: instruction },
				{ type: "data", data },
			],
			contextId,
			taskId: task.id,
			metadata: { sourceAgent, targetAgent: target, yolo, timestamp: new Date().toISOString() },
		});

		let responseMarkdown = "";
		let responseData: Record<string, unknown> = {};
		let verdict: HonestDeliveryVerdict = "INCOMPLET";
		let status: A2ATaskStatus = "submitted";
		let hubArtifacts = false;

		try {
			switch (target) {
				case "rag": {
					const query = typeof data.query === "string" && data.query.trim() ? data.query : instruction;
					const rag = await this.probes.ragContext(query, {
						limit: typeof data.limit === "number" ? data.limit : undefined,
						maxChars: typeof data.maxChars === "number" ? data.maxChars : undefined,
					});
					if (!rag.ok) {
						status = "failed";
						verdict = "NON_FAIT";
						responseMarkdown = `### Résultat RAG (A2A) — NON_FAIT\n\n**Requête :** ${query}\n\n**Bloqueur :** recherche RAG impossible — ${rag.error}`;
						responseData = { query, hits: 0, endpoint: rag.endpoint, blockers: [`API RAG : ${rag.error}`] };
					} else if (rag.sources.length === 0) {
						status = "completed";
						verdict = "INCOMPLET";
						responseMarkdown = `### Résultat RAG (A2A) — INCOMPLET\n\n**Requête :** ${query}\n\n**Manque :** aucun passage trouvé dans l'index (mode ${rag.mode}).`;
						responseData = {
							query,
							mode: rag.mode,
							hits: 0,
							sources: [],
							endpoint: rag.endpoint,
							gaps: ["aucun passage trouvé pour cette requête"],
						};
						hubArtifacts = true;
					} else {
						status = "completed";
						verdict = "FAIT";
						responseMarkdown = [
							`### Résultat RAG (A2A) — FAIT`,
							"",
							`**Requête :** ${query} — **mode :** ${rag.mode} — **passages :** ${rag.sources.length}`,
							"",
							"**Sources**",
							...rag.sources.map((s) => `${s.n}. [${s.title}](${s.url})${s.kind ? ` — ${s.kind}` : ""}`),
							"",
							"**Passages**",
							"",
							rag.context,
						].join("\n");
						responseData = {
							query,
							mode: rag.mode,
							hits: rag.sources.length,
							sources: rag.sources,
							context: rag.context,
							endpoint: rag.endpoint,
						};
						hubArtifacts = true;
					}
					break;
				}

				case "ocr":
				case "translation": {
					const report = await measurePipelineStatus(this.probes);
					const statusMd = renderPipelineStatusMarkdown(report);
					if (isStatusRequest(instruction, data)) {
						status = report.verdict === "NON_FAIT" ? "failed" : "completed";
						verdict = report.verdict;
						responseMarkdown = statusMd;
						responseData = { kind: "status", ...report };
						hubArtifacts = true;
					} else {
						// Ordre de travail : le hub ne traite AUCUN scan ; il attend un worker.
						status = "submitted";
						verdict = "INCOMPLET";
						const gap = `en attente d'un worker ${target} : aucun accusé ni résultat reçu`;
						responseMarkdown = [
							`### Ordre ${target.toUpperCase()} déposé (A2A) — INCOMPLET`,
							"",
							`**Ordre :** ${instruction}`,
							`**Enveloppe :** \`${incomingEnv.id}\` — **tâche :** \`${task.id}\``,
							"",
							`Aucun traitement n'a été effectué par le hub. La tâche reste \`submitted\` jusqu'à ce qu'un worker poste un résultat (tasks/update, message/send avec taskId, ou enveloppe via l'API de coordination avec re=${incomingEnv.id}).`,
							"",
							statusMd,
						].join("\n");
						responseData = {
							kind: "work_order",
							awaiting: target,
							envelopeId: incomingEnv.id,
							mailboxUri,
							mailboxFile: mailboxUri, // Compatibility key; the value is an Aphrody coordination URI.
							gaps: [gap, ...report.gaps],
							blockers: report.blockers,
							pipeline: report,
						};
					}
					break;
				}

				case "codex":
				case "claude":
				case "agycli":
				case "local_model":
				case "subagents": {
					if (!mailboxUri) {
						status = "failed";
						verdict = "NON_FAIT";
						responseMarkdown = `### Ordre pour ${target.toUpperCase()} (A2A) — NON_FAIT\n\n**Bloqueur :** l'adaptateur n'a retourné aucune URI d'enveloppe.`;
						responseData = { kind: "work_order", awaiting: target, blockers: ["URI de boîte A2A absente"] };
						break;
					}
					status = "submitted";
					verdict = "INCOMPLET";
					responseMarkdown = [
						`### Ordre pour ${target.toUpperCase()} déposé (A2A) — INCOMPLET`,
						"",
						`**Ordre :** ${instruction}`,
						`**Enveloppe :** \`${incomingEnv.id}\` — **tâche :** \`${task.id}\``,
						"",
						`Aucune exécution n'est présumée. La tâche reste \`submitted\` jusqu'à ce que ${target} poste un résultat avec artefacts (tasks/update, message/send avec taskId, ou enveloppe via l'API de coordination avec re=${incomingEnv.id}).`,
					].join("\n");
					responseData = {
						kind: "work_order",
						awaiting: target,
						envelopeId: incomingEnv.id,
						mailboxUri,
						mailboxFile: mailboxUri, // Compatibility key; the value is an Aphrody coordination URI.
						gaps: [`en attente du résultat de ${target}`],
					};
					break;
				}

				case "broadcast": {
					if (!mailboxUri) {
						status = "failed";
						verdict = "NON_FAIT";
						responseMarkdown = `### Diffusion A2A — NON_FAIT\n\n**Bloqueur :** l'adaptateur n'a retourné aucune URI d'enveloppe.`;
						responseData = { kind: "broadcast", deliveredMailboxes: 0, blockers: ["URI de boîte A2A absente"] };
						break;
					}
					status = "completed";
					verdict = "INCOMPLET";
					responseMarkdown = [
						`### Diffusion A2A — déposée dans 1 boîte`,
						"",
						instruction,
						"",
						`Enveloppe \`${incomingEnv.id}\` déposée via \`${mailboxUri}\`. Seul le dépôt est accompli : aucun destinataire n'a accusé réception et aucun travail n'est présumé fait.`,
					].join("\n");
					responseData = {
						kind: "broadcast",
						deliveredMailboxes: 1,
						mailboxUris: [mailboxUri],
						mailboxFiles: [mailboxUri], // Compatibility key; values are coordination URIs.
						envelopeId: incomingEnv.id,
						acknowledgements: 0,
						gaps: ["dépôt seulement : aucun accusé de réception des destinataires"],
					};
					break;
				}
			}
		} catch (err: any) {
			status = "failed";
			verdict = "NON_FAIT";
			const errorMsg = err?.message ?? String(err);
			responseMarkdown = `### Erreur A2A — NON_FAIT\n\nÉchec sur la cible **${target}** : ${errorMsg}`;
			responseData = { error: errorMsg, blockers: [errorMsg] };
		}

		task.status = status;
		task.verdict = verdict;
		task.resultMarkdown = responseMarkdown;
		task.resultData = responseData;
		if (hubArtifacts) {
			task.artifacts.push(
				{ name: "result.json", type: "json", data: responseData },
				{ name: "result.md", type: "markdown", content: responseMarkdown }
			);
		}
		task.history.push({
			role: "agent",
			parts: [
				{ type: "text", text: responseMarkdown },
				{ type: "data", data: responseData },
			],
			taskId: task.id,
			contextId,
			metadata: { sourceAgent: SHENRON_A2A_AGENT_ID, targetAgent: target, timestamp: new Date().toISOString() },
		});

		const pending = !TERMINAL_STATUSES.has(status);
		const responseEnvelope: A2AEnvelope = {
			v: 1,
			ts: new Date().toISOString(),
			id: newEnvelopeId(),
			from: SHENRON_A2A_AGENT_ID,
			to: sourceAgent,
			kind: status === "failed" ? "error" : pending ? "ack" : "fact",
			topic: `Re: ${instruction.slice(0, 70)}`,
			body: responseMarkdown,
			re: incomingEnv.id,
			taskId: task.id,
			verdict,
			channel_hint: ["file_jsonl", "http_jsonrpc"],
		};
		await storeEnvelope(responseEnvelope);
		const savedTask = a2aTaskStore.update(task.id, task);
		if (savedTask) await persistTask(savedTask);

		await this.notifyDiscordBoAdmin(
			`${target.toUpperCase()} — ${status} [${verdict}]`,
			`**Tâche :** \`${task.id}\` | **Source :** \`${sourceAgent}\`\n**Instruction :** ${instruction.slice(0, 200)}\n\n${responseMarkdown.slice(0, 500)}`,
			verdict === "FAIT" ? "success" : verdict === "NON_FAIT" ? "error" : "brand",
			[
				{ name: "Statut", value: status, inline: true },
				{ name: "Verdict", value: verdict, inline: true },
			]
		);

		return { task, responseMarkdown, responseData, verdict, responseEnvelope };
	}

	/**
	 * Mise à jour d'une tâche par le pair qui l'exécute (A2A : continuation d'une tâche).
	 * - FAIT exige au moins un artefact vérifiable (uri, data ou contenu) → `completed`.
	 * - NON_FAIT exige le bloqueur nommé (texte) → `failed`.
	 * - INCOMPLET exige le manque nommé (texte) → `working` (ou le statut non terminal fourni, ou `completed`).
	 * - Sans verdict : simple progression (`working` / `input_required`).
	 */
	static async updateTask(params: A2ATaskUpdateParams): Promise<A2ATaskUpdateResult> {
		const task = await loadTask(params.taskId);
		if (!task) return { ok: false, code: -32004, message: `Task not found: ${params.taskId}` };
		if (TERMINAL_STATUSES.has(task.status)) {
			return {
				ok: false,
				code: -32002,
				message: `Task ${task.id} is already ${task.status} (${task.verdict ?? "sans verdict"})`,
			};
		}

		const { verdict, text, data } = params;
		const sourceAgent = params.sourceAgent ?? "peer";
		if (verdict !== undefined && !VERDICTS.has(verdict)) {
			return { ok: false, code: -32602, message: `Verdict invalide : ${String(verdict)}` };
		}
		const artifacts = (params.artifacts ?? []).filter(isArtifact);
		if (params.artifacts && artifacts.length !== params.artifacts.length) {
			return {
				ok: false,
				code: -32602,
				message: "Artefact invalide : name, type (json|markdown|code|file) et uri/data/content requis",
			};
		}
		if (verdict === "FAIT" && artifacts.length === 0) {
			return { ok: false, code: -32602, message: "FAIT exige au moins un artefact (Honest Delivery)" };
		}
		if ((verdict === "INCOMPLET" || verdict === "NON_FAIT") && !text?.trim()) {
			return {
				ok: false,
				code: -32602,
				message: `${verdict} exige le ${verdict === "NON_FAIT" ? "bloqueur" : "manque"} nommé (texte)`,
			};
		}

		let status: A2ATaskStatus;
		if (verdict === "FAIT") status = "completed";
		else if (verdict === "NON_FAIT") status = "failed";
		else if (verdict === "INCOMPLET") {
			status =
				params.status && ["working", "input_required", "completed"].includes(params.status)
					? params.status
					: "working";
		} else {
			if (params.status && TERMINAL_STATUSES.has(params.status)) {
				return {
					ok: false,
					code: -32602,
					message: `Le statut ${params.status} exige un verdict (FAIT, INCOMPLET ou NON_FAIT)`,
				};
			}
			status = params.status ?? "working";
		}

		const parts: A2APart[] = [];
		if (text) parts.push({ type: "text", text });
		if (data) parts.push({ type: "data", data });
		task.history.push({
			role: "agent",
			parts,
			taskId: task.id,
			metadata: {
				sourceAgent,
				targetAgent: task.target,
				timestamp: new Date().toISOString(),
				verdict,
				status,
				envelopeId: params.envelopeId,
			},
		});
		task.artifacts.push(...artifacts);
		task.status = status;
		if (verdict) {
			task.verdict = verdict;
			task.resultMarkdown = text;
			task.resultData = { ...data, completedBy: sourceAgent, artifactCount: artifacts.length };
		}
		const applied = new Set((task.metadata.appliedEnvelopes as string[] | undefined) ?? []);
		if (params.envelopeId) applied.add(params.envelopeId);

		// Trace in the configured coordination API when this update did not arrive as an envelope.
		if (!params.envelopeId) {
			const env: A2AEnvelope = {
				v: 1,
				ts: new Date().toISOString(),
				id: newEnvelopeId(),
				from: sourceAgent,
				to: SHENRON_A2A_AGENT_ID,
				kind: verdict === "NON_FAIT" ? "error" : verdict ? "fact" : "ack",
				topic: `Task ${task.id} ${status}`,
				body: text ?? `Statut ${status}`,
				re: task.metadata.envelopeId as string | undefined,
				taskId: task.id,
				verdict,
				artifacts: artifacts.length ? artifacts : undefined,
				channel_hint: ["file_jsonl", "http_jsonrpc"],
			};
			await storeEnvelope(env);
			applied.add(env.id);
		}
		task.metadata.appliedEnvelopes = [...applied];
		const savedTask = a2aTaskStore.update(task.id, task);
		if (savedTask) await persistTask(savedTask);

		if (verdict) {
			await this.notifyDiscordBoAdmin(
				`${task.target.toUpperCase()} — ${status} [${verdict}] par ${sourceAgent}`,
				`**Tâche :** \`${task.id}\`\n**Artefacts :** ${artifacts.length}\n\n${(text ?? "").slice(0, 500)}`,
				verdict === "FAIT" ? "success" : verdict === "NON_FAIT" ? "error" : "brand"
			);
		}
		return { ok: true, task };
	}

	/** Convertit une enveloppe de réponse d'un pair en mise à jour de tâche. */
	private static async applyPeerEnvelope(task: A2ATask, env: A2AEnvelope): Promise<A2ATaskUpdateResult> {
		const artifacts = Array.isArray(env.artifacts) ? env.artifacts : undefined;
		let verdict: HonestDeliveryVerdict | undefined =
			env.kind === "error"
				? "NON_FAIT"
				: env.kind === "fact"
					? (env.verdict ?? verdictFromText(env.body))
					: undefined;
		let text = env.body || env.topic;
		if (verdict === "FAIT" && !(artifacts ?? []).some(isArtifact)) {
			verdict = "INCOMPLET";
			text = `FAIT déclaré sans artefact vérifiable — rétrogradé en INCOMPLET.\n\n${text}`;
		}
		return this.updateTask({
			taskId: task.id,
			sourceAgent: env.from,
			verdict,
			status: verdict ? undefined : "working",
			text,
			artifacts: verdict === "FAIT" ? artifacts?.filter(isArtifact) : undefined,
			envelopeId: env.id,
		});
	}

	/**
	 * Applique les réponses reçues par l'API de coordination (champ `re` = enveloppe d'origine)
	 * qui n'ont pas encore été prises en compte.
	 */
	static async reconcileTask(task: A2ATask): Promise<A2ATask> {
		const envelopeId = task.metadata?.envelopeId;
		if (typeof envelopeId !== "string" || TERMINAL_STATUSES.has(task.status)) return task;
		const applied = new Set((task.metadata.appliedEnvelopes as string[] | undefined) ?? []);
		const replies = (await loadEnvelopes(5000))
			.filter(
				(e) =>
					(e.re === envelopeId || e.taskId === task.id) &&
					e.from !== SHENRON_A2A_AGENT_ID &&
					e.id !== envelopeId &&
					!applied.has(e.id) &&
					e.kind !== "ask" &&
					e.kind !== "ping"
			)
			.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
		let current = task;
		for (const env of replies) {
			if (TERMINAL_STATUSES.has(current.status)) break;
			const res = await this.applyPeerEnvelope(current, env);
			if (res.ok) current = res.task;
		}
		return current;
	}

	/** Tâche à jour depuis Aphrody puis réconciliée avec les enveloppes de réponse. */
	static async getTask(taskId: string): Promise<A2ATask | undefined> {
		const task = await loadTask(taskId);
		return task ? this.reconcileTask(task) : undefined;
	}

	static async listTasks(target?: A2ATarget): Promise<A2ATask[]> {
		const tasks = await loadTasks(target);
		return Promise.all(tasks.map((t) => this.reconcileTask(t)));
	}

	/**
	 * Liste les enveloppes A2A (compatible a2a-ui & monitoring).
	 */
	static listEnvelopes(limit = 100): A2AEnvelope[] {
		return coordMailboxStore.list(limit);
	}

	static async listStoredEnvelopes(limit = 100): Promise<A2AEnvelope[]> {
		return loadEnvelopes(limit);
	}

	/**
	 * Traite une enveloppe A2A entrante (endpoint /msg or JSON-RPC adapter).
	 * Une réponse de pair (`re` ou `taskId` liés à une tâche) met la tâche à jour au lieu
	 * de créer un nouvel ordre.
	 */
	static async handleMsgEnvelope(payload: any): Promise<A2AEnvelope> {
		const from = payload?.from || "anonymous";
		const to = payload?.to || "broadcast";
		const topic = payload?.topic || payload?.subject || "Message A2A";
		const body = payload?.body || payload?.text || "";
		const rawKind = payload?.kind ?? payload?.type ?? "ask";
		if (!(A2A_ENVELOPE_KINDS as readonly string[]).includes(rawKind)) {
			const errEnv: A2AEnvelope = {
				v: 1,
				ts: new Date().toISOString(),
				id: newEnvelopeId(),
				from: SHENRON_A2A_AGENT_ID,
				to: from,
				kind: "error",
				topic: "Invalid envelope kind",
				body: `kind must be one of ${A2A_ENVELOPE_KINDS.join("|")} (got ${JSON.stringify(rawKind)}).`,
				re: typeof payload?.id === "string" ? payload.id : undefined,
				channel_hint: ["file_jsonl", "http_jsonrpc"],
			};
			await storeEnvelope(errEnv);
			return errEnv;
		}
		const kind = rawKind as A2AEnvelopeKind;

		const incomingEnv: A2AEnvelope = {
			v: payload?.v ?? 1,
			ts: payload?.ts ?? new Date().toISOString(),
			id: payload?.id ?? newEnvelopeId(),
			from,
			to,
			kind,
			topic,
			body,
			re: payload?.re,
			taskId: payload?.taskId,
			verdict: payload?.verdict,
			artifacts: payload?.artifacts,
			channel_hint: payload?.channel_hint ?? ["file_jsonl", "http_jsonrpc"],
		};

		await storeEnvelope(incomingEnv);

		const ackTo = async (topicText: string, text: string, ackKind: A2AEnvelopeKind = "ack", extra: Partial<A2AEnvelope> = {}) => {
			const ackEnv: A2AEnvelope = {
				v: 1,
				ts: new Date().toISOString(),
				id: newEnvelopeId(),
				from: SHENRON_A2A_AGENT_ID,
				to: from,
				kind: ackKind,
				topic: topicText,
				body: text,
				re: incomingEnv.id,
				channel_hint: ["file_jsonl", "http_jsonrpc"],
				...extra,
			};
			await storeEnvelope(ackEnv);
			return ackEnv;
		};

		if (kind === "ping") {
			return ackTo(`Pong: ${topic}`, `Shenron A2A hub v${A2A_PROTOCOL_VERSION} : ping de ${from} reçu et accusé.`);
		}

		// Erreur critique hors tâche : escalade #bot-admin, pas de nouvel ordre.
		if (kind === "error" && !incomingEnv.re && !incomingEnv.taskId) {
			await this.notifyDiscordBoAdmin(`Erreur critique de ${from}`, `**${topic}**
${body}`.slice(0, 4000), "error");
			return ackTo(`Ack: ${topic}`, `Erreur de ${from} enregistrée et remontée sur #bot-admin.`);
		}

		// Réponse d'un pair à un ordre existant → mise à jour de la tâche.
		if (incomingEnv.re || incomingEnv.taskId) {
			const task = incomingEnv.taskId
				? await loadTask(incomingEnv.taskId)
				: incomingEnv.re
					? (await loadTasks()).find((candidate) => candidate.metadata?.envelopeId === incomingEnv.re)
					: undefined;
			if (!task) {
				return ackTo(
					`Re: ${topic}`,
					`Enveloppe enregistrée ; aucune tâche liée à re=${incomingEnv.re ?? "-"} / taskId=${incomingEnv.taskId ?? "-"}.`
				);
			}
			if (kind === "ask") {
				return ackTo(`Re: ${topic}`, `Enveloppe enregistrée sur la tâche ${task.id} (question, statut inchangé).`, "ack", {
					taskId: task.id,
				});
			}
			const res = await this.applyPeerEnvelope(task, incomingEnv);
			if (!res.ok) {
				return ackTo(`Refus: ${topic}`, `Mise à jour refusée (${res.code}) : ${res.message}`, "error", {
					taskId: task.id,
				});
			}
			return ackTo(
				`Task ${res.task.id}: ${res.task.status}`,
				`Tâche ${res.task.id} → ${res.task.status}${res.task.verdict ? ` [${res.task.verdict}]` : ""}.`,
				"ack",
				{ taskId: res.task.id, verdict: res.task.verdict }
			);
		}

		const target = (A2A_TARGETS as readonly string[]).includes(to) ? (to as A2ATarget) : "broadcast";
		const result = await this.sendMessage({
			target,
			sourceAgent: from,
			instruction: body || topic,
			yolo: true,
		});
		return result.responseEnvelope as A2AEnvelope;
	}

	private static rpcTaskUpdateResponse(id: string | number, res: A2ATaskUpdateResult): JSONRPCResponse {
		if (!res.ok) return { jsonrpc: "2.0", id, error: { code: res.code, message: res.message } };
		const t = res.task;
		return {
			jsonrpc: "2.0",
			id,
			result: {
				taskId: t.id,
				status: t.status,
				verdict: t.verdict,
				response: {
					role: "agent",
					parts: [
						{ type: "text", text: t.resultMarkdown ?? `Statut ${t.status}` },
						{ type: "data", data: t.resultData ?? {} },
					],
				},
				task: t,
			},
		};
	}

	/**
	 * Traite une requête JSON-RPC 2.0 A2A standard.
	 */
	static async handleJsonRpc(body: unknown): Promise<JSONRPCResponse> {
		if (!body || typeof body !== "object") {
			return {
				jsonrpc: "2.0",
				id: null,
				error: { code: -32600, message: "Invalid Request" },
			};
		}

		const req = body as Partial<JSONRPCRequest>;
		const id = req.id ?? null;

		if (req.jsonrpc !== "2.0" || !req.method) {
			return {
				jsonrpc: "2.0",
				id,
				error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
			};
		}

		try {
			switch (req.method) {
				case "agent/card":
				case "agent/getCard": {
					const card = this.getAgentCard();
					return { jsonrpc: "2.0", id: id!, result: card };
				}

				case "message/send": {
					const params = req.params as any;
					const message = params?.message;
					const textParts: string[] = (message?.parts ?? [])
						.filter((p: any) => (p.type ?? p.kind) === "text")
						.map((p: any) => p.text);
					const instruction = textParts.join("\n") || params?.instruction || "";
					const data =
						message?.parts?.find((p: any) => (p.type ?? p.kind) === "data")?.data ?? params?.data ?? {};
					const sourceAgent = message?.metadata?.sourceAgent ?? params?.sourceAgent ?? "a2a-client";

					// Continuation A2A : un message portant taskId est la réponse d'un pair.
					const taskId: string | undefined = message?.taskId ?? params?.taskId;
					if (taskId) {
						const res = await this.updateTask({
							taskId,
							sourceAgent,
							status: message?.metadata?.status ?? params?.status,
							verdict: message?.metadata?.verdict ?? params?.verdict,
							text: instruction || undefined,
							data: Object.keys(data).length ? data : undefined,
							artifacts: params?.artifacts ?? message?.metadata?.artifacts,
						});
						return this.rpcTaskUpdateResponse(id!, res);
					}

					const target: A2ATarget = params?.target ?? message?.metadata?.targetAgent ?? "broadcast";
					if (!A2A_TARGETS.includes(target)) {
						return {
							jsonrpc: "2.0",
							id: id!,
							error: { code: -32602, message: `Unknown target: ${String(target)}` },
						};
					}

					const result = await this.sendMessage({
						target,
						sourceAgent,
						instruction,
						data,
						yolo: params?.yolo ?? true,
						contextId: message?.contextId,
					});

					return {
						jsonrpc: "2.0",
						id: id!,
						result: {
							taskId: result.task.id,
							status: result.task.status,
							verdict: result.verdict,
							response: {
								role: "agent",
								parts: [
									{ type: "text", text: result.responseMarkdown },
									{ type: "data", data: result.responseData },
								],
							},
						},
					};
				}

				case "tasks/update": {
					const params = req.params as any;
					const taskId = params?.taskId ?? params?.id;
					if (!taskId) {
						return { jsonrpc: "2.0", id: id!, error: { code: -32602, message: "Missing taskId parameter" } };
					}
					const res = await this.updateTask({
						taskId,
						sourceAgent: params?.sourceAgent,
						status: params?.status,
						verdict: params?.verdict,
						text: params?.text ?? params?.message,
						data: params?.data,
						artifacts: params?.artifacts,
					});
					return this.rpcTaskUpdateResponse(id!, res);
				}

				case "envelope/send":
				case "msg/send": {
					const params = req.params as any;
					const env = await this.handleMsgEnvelope(params);
					return { jsonrpc: "2.0", id: id!, result: env };
				}

				case "envelopes/list":
				case "mailbox/list": {
					const params = req.params as { limit?: number };
					const envelopes = await this.listStoredEnvelopes(params?.limit ?? 100);
					return { jsonrpc: "2.0", id: id!, result: { envelopes, total: envelopes.length } };
				}

				case "tasks/get": {
					const params = req.params as { id?: string; taskId?: string };
					const taskId = params?.id ?? params?.taskId;
					if (!taskId) {
						return {
							jsonrpc: "2.0",
							id: id!,
							error: { code: -32602, message: "Missing taskId parameter" },
						};
					}
					const task = await this.getTask(taskId);
					if (!task) {
						return {
							jsonrpc: "2.0",
							id: id!,
							error: { code: -32004, message: `Task not found: ${taskId}` },
						};
					}
					return { jsonrpc: "2.0", id: id!, result: task };
				}

				case "tasks/list": {
					const params = req.params as { target?: A2ATarget };
					const list = await this.listTasks(params?.target);
					return { jsonrpc: "2.0", id: id!, result: { tasks: list, total: list.length } };
				}

				default:
					return {
						jsonrpc: "2.0",
						id: id!,
						error: { code: -32601, message: `Method not found: ${req.method}` },
					};
			}
		} catch (err: any) {
			return {
				jsonrpc: "2.0",
				id: id!,
				error: { code: -32603, message: "Internal error", data: err?.message ?? String(err) },
			};
		}
	}
}
