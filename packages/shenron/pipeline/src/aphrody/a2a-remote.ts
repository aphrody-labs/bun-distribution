// SPDX-License-Identifier: Apache-2.0
/** Thin client for Aphrody's namespaced durable A2A task and mailbox API. */

import type { A2AEnvelope, A2ATask, A2ATarget } from "./a2a";

const AGENT = "shenron-dragonball";

function configuredBase(): string | undefined {
	const value = process.env.APHRODY_A2A_COORD_API?.trim();
	return value ? value.replace(/\/+$/, "") : undefined;
}

export function aphrodyA2aStoreEnabled(): boolean {
	return Boolean(configuredBase());
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const base = configuredBase();
	if (!base) throw new Error("APHRODY_A2A_COORD_API is not configured");
	const headers = new Headers(init?.headers);
	headers.set("Accept", "application/json");
	if (init?.body !== undefined) headers.set("Content-Type", "application/json");
	const token = process.env.APHRODY_A2A_COORD_TOKEN?.trim();
	if (token) headers.set("Authorization", `Bearer ${token}`);
	const response = await fetch(`${base}/coord/${AGENT}/${path}`, { ...init, headers, cache: "no-store" });
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const detail = typeof payload?.error === "string" ? payload.error : response.statusText;
		throw new Error(`Aphrody A2A store ${response.status}: ${detail}`);
	}
	return payload as T;
}

export async function createRemoteTask(task: A2ATask): Promise<void> {
	await request<A2ATask>("tasks", { method: "POST", body: JSON.stringify(task) });
}

export async function putRemoteTask(task: A2ATask): Promise<void> {
	await request<A2ATask>(`tasks/${encodeURIComponent(task.id)}`, { method: "PUT", body: JSON.stringify(task) });
}

export async function getRemoteTask(taskId: string): Promise<A2ATask | undefined> {
	try {
		return await request<A2ATask>(`tasks/${encodeURIComponent(taskId)}`);
	} catch (error) {
		if (error instanceof Error && error.message.includes("Aphrody A2A store 404")) return undefined;
		throw error;
	}
}

export async function listRemoteTasks(target?: A2ATarget): Promise<A2ATask[]> {
	const query = target ? `?target=${encodeURIComponent(target)}` : "";
	const result = await request<{ tasks: A2ATask[] }>(`tasks${query}`);
	return result.tasks ?? [];
}

export async function appendRemoteEnvelope(envelope: A2AEnvelope): Promise<void> {
	await request("envelopes", { method: "POST", body: JSON.stringify(envelope) });
}

export async function listRemoteEnvelopes(limit = 100): Promise<A2AEnvelope[]> {
	const result = await request<{ envelopes: A2AEnvelope[] }>(`envelopes?limit=${Math.max(1, Math.min(5000, limit))}`);
	return result.envelopes ?? [];
}
