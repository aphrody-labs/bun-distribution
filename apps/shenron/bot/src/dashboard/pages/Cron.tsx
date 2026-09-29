import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Clock, Save, Pencil } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { formatDuration, formatRelative } from "../lib/utils";

interface CronJob {
	name: string;
	description: string | null;
	intervalMs: number;
	lastRunAt: number | null;
	lastDurationMs: number | null;
	runCount: number;
	lastError: string | null;
	nextRunAt: number | null;
}

export function Cron() {
	const qc = useQueryClient();
	const { data, isLoading } = useQuery({
		queryKey: ["cron"],
		queryFn: () => api.get<{ jobs: CronJob[] }>("/cron"),
		refetchInterval: 5_000,
	});

	const trigger = useMutation({
		mutationFn: (name: string) => api.post(`/cron/${name}/trigger`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
	});

	const updateInterval = useMutation({
		mutationFn: ({ name, intervalMs }: { name: string; intervalMs: number }) =>
			api.post(`/cron/${name}/interval`, { intervalMs }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
	});

	if (isLoading) return <div className="text-zinc-500">Chargement en cours…</div>;

	return (
		<div className="space-y-4">
			<div className="card">
				<h2 className="text-lg font-semibold">Tâches planifiées</h2>
				<p className="mt-1 text-sm text-zinc-400">
					Tâches périodiques enregistrées dans <code>CronRegistry</code>. Actualisation automatique
					toutes les 5 secondes. La cadence (intervalle) est éditable inline et persistée dans{" "}
					<code>cron.&lt;name&gt;.interval_ms</code>.
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				{data?.jobs.map((job) => (
					<div key={job.name} className="card">
						<div className="mb-3 flex items-start justify-between gap-3">
							<div>
								<h3 className="font-mono text-sm font-semibold text-brand-400">{job.name}</h3>
								{job.description && <p className="mt-1 text-xs text-zinc-400">{job.description}</p>}
							</div>
							<button
								type="button"
								onClick={() => trigger.mutate(job.name)}
								disabled={trigger.isPending}
								className="btn btn-primary"
							>
								<Play className="h-3 w-3" />
								Exécuter
							</button>
						</div>

						<dl className="grid grid-cols-2 gap-2 text-xs">
							<div>
								<dt className="text-zinc-500">Intervalle</dt>
								<dd className="font-medium">
									<IntervalEditor
										job={job}
										onSave={(intervalMs) => updateInterval.mutate({ name: job.name, intervalMs })}
										saving={updateInterval.isPending}
									/>
								</dd>
							</div>
							<div>
								<dt className="text-zinc-500">Exécutions</dt>
								<dd className="font-medium">{job.runCount}</dd>
							</div>
							<div>
								<dt className="text-zinc-500">Dernière exécution</dt>
								<dd className="font-medium">
									{formatRelative(job.lastRunAt)}
									{job.lastDurationMs != null && (
										<span className="text-zinc-500"> ({job.lastDurationMs} ms)</span>
									)}
								</dd>
							</div>
							<div>
								<dt className="text-zinc-500">Prochaine</dt>
								<dd className="flex items-center gap-1 font-medium">
									<Clock className="h-3 w-3" />
									{formatRelative(job.nextRunAt)}
								</dd>
							</div>
						</dl>

						{job.lastError && (
							<div className="mt-3 rounded border border-red-800 bg-red-900/20 p-2 text-xs text-red-400">
								Erreur : {job.lastError}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function IntervalEditor({
	job,
	onSave,
	saving,
}: {
	job: CronJob;
	onSave: (intervalMs: number) => void;
	saving: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(String(Math.round(job.intervalMs / 1000)));

	if (!editing) {
		return (
			<span className="inline-flex items-center gap-1">
				{formatDuration(job.intervalMs)}
				<button
					type="button"
					onClick={() => {
						setValue(String(Math.round(job.intervalMs / 1000)));
						setEditing(true);
					}}
					className="btn btn-ghost px-1 py-0 text-xs"
					title="Éditer la cadence"
				>
					<Pencil className="h-3 w-3" />
				</button>
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1">
			<input
				type="number"
				min={1}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				className="input w-20 px-1 py-0 text-xs"
			/>
			<span className="text-zinc-500">s</span>
			<button
				type="button"
				onClick={() => {
					const sec = Number.parseInt(value, 10);
					if (!Number.isFinite(sec) || sec < 1) return;
					onSave(sec * 1000);
					setEditing(false);
				}}
				disabled={saving}
				className="btn btn-primary px-1 py-0 text-xs"
				title="Enregistrer"
			>
				<Save className="h-3 w-3" />
			</button>
			<button
				type="button"
				onClick={() => setEditing(false)}
				className="btn btn-ghost px-1 py-0 text-xs"
			>
				✕
			</button>
		</span>
	);
}
