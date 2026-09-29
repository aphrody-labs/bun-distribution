import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Plus, Save, Sparkles, TestTube, Trash2, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../lib/api";

interface AchievementTrigger {
	code: string;
	description: string | null;
	pattern: string;
	flags: string | null;
	enabled: boolean;
}

/**
 * Page de gestion des achievement_triggers — patterns regex qui débloquent
 * un succès quand un message du joueur matche.
 *
 * Inclut un **regex tester** côté client : tape un pattern + flags + sample
 * et voit si ça match (et avec quels groups). Pas d'appel serveur.
 */
export function Triggers() {
	const qc = useQueryClient();
	const [editing, setEditing] = useState<AchievementTrigger | null>(null);
	const [creating, setCreating] = useState(false);

	const triggers = useQuery({
		queryKey: ["triggers", "list"],
		queryFn: () =>
			api.get<{ rows: AchievementTrigger[]; total: number }>(
				"/database/achievement_triggers?limit=200"
			),
	});

	const remove = useMutation({
		mutationFn: (code: string) =>
			api.delete(`/database/achievement_triggers/${encodeURIComponent(code)}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["triggers"] }),
	});

	const refresh = useMutation({
		mutationFn: () => api.post("/services/achievements/refresh"),
	});

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<Sparkles className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Triggers de succès</h2>
					<span className="ml-2 text-xs text-zinc-500">{triggers.data?.total ?? 0} pattern(s)</span>
					<button
						type="button"
						className="ml-auto btn btn-ghost"
						disabled={refresh.isPending}
						onClick={() => refresh.mutate()}
						title="Recharger le cache regex côté bot"
					>
						♻︎ Refresh cache
					</button>
					<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
						<Plus className="h-3 w-3" /> Créer
					</button>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Quand un message d'un joueur matche un de ces patterns, le succès <code>code</code> est
					attribué (idempotent). Recharge le cache après modification.
				</p>
			</div>

			<RegexTester />

			<div className="space-y-2">
				{triggers.data?.rows.map((t) => (
					<TriggerCard
						key={t.code}
						trigger={t}
						onEdit={() => setEditing(t)}
						onDelete={() => {
							if (confirm(`Supprimer ${t.code} ?`)) remove.mutate(t.code);
						}}
					/>
				))}
				{triggers.data?.rows.length === 0 && (
					<div className="card text-center text-zinc-500">Aucun trigger. Crée le premier !</div>
				)}
			</div>

			{(editing || creating) && (
				<TriggerEditor
					trigger={editing}
					onClose={() => {
						setEditing(null);
						setCreating(false);
					}}
					onSaved={() => {
						qc.invalidateQueries({ queryKey: ["triggers"] });
						refresh.mutate();
					}}
				/>
			)}
		</div>
	);
}

function TriggerCard({
	trigger,
	onEdit,
	onDelete,
}: {
	trigger: AchievementTrigger;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const valid = useMemo(() => {
		try {
			new RegExp(trigger.pattern, trigger.flags ?? "i");
			return true;
		} catch {
			return false;
		}
	}, [trigger.pattern, trigger.flags]);

	return (
		<div className={`card ${trigger.enabled ? "" : "opacity-60"}`}>
			<div className="flex items-start gap-3">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<code className="text-sm font-semibold text-brand-300">{trigger.code}</code>
						{!trigger.enabled && <span className="badge badge-error">OFF</span>}
						{!valid && <span className="badge badge-error">REGEX INVALIDE</span>}
					</div>
					{trigger.description && (
						<p className="mt-1 text-xs text-zinc-400">{trigger.description}</p>
					)}
					<div className="mt-2 flex items-center gap-2">
						<code className="rounded bg-zinc-900 px-2 py-1 font-mono text-[11px]">
							/{trigger.pattern}/{trigger.flags ?? ""}
						</code>
					</div>
				</div>
				<div className="flex shrink-0 gap-1">
					<button type="button" className="btn btn-ghost" onClick={onEdit}>
						Modifier
					</button>
					<button type="button" className="btn btn-ghost px-2 text-red-400" onClick={onDelete}>
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			</div>
		</div>
	);
}

function TriggerEditor({
	trigger,
	onClose,
	onSaved,
}: {
	trigger: AchievementTrigger | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const isCreate = !trigger;
	const [draft, setDraft] = useState<AchievementTrigger>(
		trigger ?? {
			code: "",
			description: "",
			pattern: "",
			flags: "i",
			enabled: true,
		}
	);
	const [error, setError] = useState<string | null>(null);

	const regexValid = useMemo(() => {
		try {
			new RegExp(draft.pattern, draft.flags ?? "i");
			return true;
		} catch (e) {
			return (e as Error).message;
		}
	}, [draft.pattern, draft.flags]);

	const save = useMutation({
		mutationFn: async (payload: AchievementTrigger) => {
			if (isCreate) {
				return api.post("/database/achievement_triggers", payload);
			}
			return api.put(`/database/achievement_triggers/${encodeURIComponent(payload.code)}`, payload);
		},
		onSuccess: () => {
			onSaved();
			onClose();
		},
		onError: (err) => setError((err as Error).message),
	});

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!draft.code || !draft.pattern) {
			setError("Code et pattern requis.");
			return;
		}
		if (regexValid !== true) {
			setError(`Regex invalide : ${regexValid}`);
			return;
		}
		save.mutate(draft);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
			<form
				onSubmit={submit}
				className="card w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto"
			>
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-semibold">
						{isCreate ? "Créer un trigger" : `Modifier ${draft.code}`}
					</h3>
					<button type="button" onClick={onClose} className="ml-auto btn btn-ghost px-2">
						<X className="h-3 w-3" />
					</button>
				</div>
				{error && (
					<div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
						{error}
					</div>
				)}
				<div className="grid gap-2 sm:grid-cols-2">
					<div>
						<label className="block text-xs text-zinc-500">Code succès</label>
						<input
							className="input w-full font-mono text-xs"
							value={draft.code}
							onChange={(e) => setDraft({ ...draft, code: e.target.value })}
							disabled={!isCreate}
							placeholder="KAMEHAMEHA_FAN"
						/>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">Activé</label>
						<button
							type="button"
							className={`btn ${draft.enabled ? "btn-primary" : "btn-ghost"} w-full`}
							onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
						>
							{draft.enabled ? "ON" : "OFF"}
						</button>
					</div>
					<div className="sm:col-span-2">
						<label className="block text-xs text-zinc-500">Description</label>
						<input
							className="input w-full"
							value={draft.description ?? ""}
							onChange={(e) => setDraft({ ...draft, description: e.target.value })}
						/>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">Pattern (regex)</label>
						<input
							className="input w-full font-mono text-xs"
							value={draft.pattern}
							onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
							placeholder="kameham(é|e)ha"
						/>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">Flags</label>
						<input
							className="input w-full font-mono text-xs"
							value={draft.flags ?? ""}
							onChange={(e) => setDraft({ ...draft, flags: e.target.value })}
							placeholder="i"
						/>
					</div>
				</div>
				{regexValid === true ? (
					<p className="text-xs text-emerald-400">
						<Check className="inline h-3 w-3" /> Regex valide
					</p>
				) : (
					<p className="text-xs text-red-400">
						<AlertCircle className="inline h-3 w-3" /> {regexValid}
					</p>
				)}
				<div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
					<button
						type="submit"
						className="btn btn-primary"
						disabled={save.isPending || regexValid !== true}
					>
						<Save className="h-3 w-3" /> {isCreate ? "Créer" : "Enregistrer"}
					</button>
					<button type="button" className="btn btn-ghost" onClick={onClose}>
						Annuler
					</button>
				</div>
			</form>
		</div>
	);
}

/**
 * Tester regex live (pas d'appel serveur — `new RegExp` côté navigateur).
 */
function RegexTester() {
	const [pattern, setPattern] = useState("kameham(é|e)ha");
	const [flags, setFlags] = useState("i");
	const [sample, setSample] = useState("Goku lance un Kamehameha sur Cell !");

	const result = useMemo(() => {
		try {
			const rx = new RegExp(pattern, flags);
			const m = rx.exec(sample);
			if (!m) return { ok: true, matched: false };
			return {
				ok: true,
				matched: true,
				match: m[0],
				index: m.index,
				groups: m.slice(1),
				named: m.groups ?? null,
			};
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}, [pattern, flags, sample]);

	return (
		<div className="card">
			<div className="flex items-center gap-2">
				<TestTube className="h-5 w-5 text-brand-400" />
				<h3 className="font-semibold">Regex tester</h3>
			</div>
			<p className="mt-1 text-xs text-zinc-500">
				Évalué côté navigateur (<code>new RegExp</code>) — JS et le moteur du bot partagent la même
				syntaxe.
			</p>
			<div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px]">
				<input
					className="input w-full font-mono text-xs"
					value={pattern}
					onChange={(e) => setPattern(e.target.value)}
					placeholder="pattern"
				/>
				<input
					className="input w-full font-mono text-xs"
					value={flags}
					onChange={(e) => setFlags(e.target.value)}
					placeholder="flags (gimsuy)"
				/>
			</div>
			<textarea
				className="input mt-2 w-full"
				rows={2}
				value={sample}
				onChange={(e) => setSample(e.target.value)}
				placeholder="Phrase à tester"
			/>
			<div className="mt-2 text-xs">
				{result.ok === false ? (
					<span className="text-red-400">
						<AlertCircle className="inline h-3 w-3" /> {result.error}
					</span>
				) : result.matched ? (
					<div className="space-y-1 text-emerald-400">
						<div>
							<Check className="inline h-3 w-3" /> Match : <code>{result.match}</code> à l'index{" "}
							<code>{result.index}</code>
						</div>
						{result.groups && result.groups.length > 0 && (
							<div className="text-zinc-300">
								Groupes :{" "}
								{result.groups.map((g, i) => (
									<code key={i} className="ml-1 rounded bg-zinc-800 px-1">
										{g ?? "—"}
									</code>
								))}
							</div>
						)}
					</div>
				) : (
					<span className="text-zinc-500">Pas de match.</span>
				)}
			</div>
		</div>
	);
}
