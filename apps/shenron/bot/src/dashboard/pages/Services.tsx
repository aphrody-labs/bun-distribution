import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Play, ChevronDown } from "lucide-react";
import { api } from "../lib/api";

interface ServiceAction {
	service: string;
	action: string;
	description: string;
}

export function Services() {
	const { data, isLoading } = useQuery({
		queryKey: ["services"],
		queryFn: () => api.get<{ actions: ServiceAction[] }>("/services"),
	});

	if (isLoading) return <div className="text-zinc-500">Chargement en cours…</div>;

	// Group by service
	const grouped = (data?.actions ?? []).reduce<Record<string, ServiceAction[]>>((acc, a) => {
		(acc[a.service] ??= []).push(a);
		return acc;
	}, {});

	return (
		<div className="space-y-4">
			<div className="card">
				<h2 className="text-lg font-semibold">Services internes</h2>
				<p className="mt-1 text-sm text-zinc-400">
					Liste blanche d'actions exposées par les services <code>@singleton()</code> du bot. Saisir
					le corps de requête au format JSON.
				</p>
			</div>

			{Object.entries(grouped).map(([svc, actions]) => (
				<div key={svc} className="card">
					<h3 className="mb-3 font-mono text-sm font-semibold uppercase tracking-wide text-brand-400">
						{svc}
					</h3>
					<div className="space-y-3">
						{actions.map((a) => (
							<ActionRow key={`${a.service}-${a.action}`} action={a} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function ActionRow({ action }: { action: ServiceAction }) {
	const [open, setOpen] = useState(false);
	const [body, setBody] = useState("{}");
	const [result, setResult] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: async () => {
			const parsed = JSON.parse(body || "{}");
			return api.post(`/services/${action.service}/${action.action}`, parsed);
		},
		onSuccess: (data) => setResult(JSON.stringify(data, null, 2)),
		onError: (err) => setResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
	});

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setResult(null);
		mutation.mutate();
	};

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-zinc-900/50"
			>
				<ChevronDown
					className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
				/>
				<div className="flex-1">
					<code className="text-sm font-medium">{action.action}</code>
					<p className="mt-0.5 text-xs text-zinc-400">{action.description}</p>
				</div>
			</button>

			{open && (
				<form onSubmit={submit} className="space-y-2 border-t border-zinc-800 p-3">
					<label className="block text-xs text-zinc-400">Corps de requête (JSON)</label>
					<textarea
						className="input font-mono text-xs"
						rows={3}
						value={body}
						onChange={(e) => setBody(e.target.value)}
					/>
					<button type="submit" disabled={mutation.isPending} className="btn btn-primary">
						<Play className="h-3 w-3" /> {mutation.isPending ? "Exécution…" : "Exécuter l'action"}
					</button>
					{result && (
						<pre className="mt-2 overflow-x-auto rounded bg-zinc-950 p-2 text-xs">{result}</pre>
					)}
				</form>
			)}
		</div>
	);
}
