import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Crown, Plus, Save, Trash2, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { RoleSelect, RoleBadge } from "../components/RoleSelect";

/**
 * Éditeur visuel pour la hiérarchie staff (`moderation.hierarchy` setting).
 *
 * Les niveaux sont ordonnés du plus haut (index 0 — admin) au plus bas. Un
 * staff ne peut sanctionner qu'un membre dont le niveau effectif est
 * **strictement plus grand**. Les membres sans rôle staff = `Infinity`
 * (sanctionnables par tous).
 */
export function Hierarchy() {
	const qc = useQueryClient();

	const hierarchy = useQuery({
		queryKey: ["moderation", "hierarchy"],
		queryFn: () => api.get<{ levels: string[][]; raw: string }>("/moderation/hierarchy"),
	});

	const save = useMutation({
		mutationFn: (levels: string[][]) =>
			api.put<{ ok: boolean }>("/moderation/hierarchy", { levels }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["moderation", "hierarchy"] }),
	});

	const [draft, setDraft] = useState<string[][]>([]);
	const [dirty, setDirty] = useState(false);
	useEffect(() => {
		if (hierarchy.data) {
			setDraft(hierarchy.data.levels ?? []);
			setDirty(false);
		}
	}, [hierarchy.data]);

	const addLevel = () => {
		setDraft((d) => [...d, []]);
		setDirty(true);
	};
	const removeLevel = (idx: number) => {
		setDraft((d) => d.filter((_, i) => i !== idx));
		setDirty(true);
	};
	const moveLevel = (idx: number, delta: -1 | 1) => {
		const target = idx + delta;
		if (target < 0 || target >= draft.length) return;
		const copy = [...draft];
		[copy[idx], copy[target]] = [copy[target]!, copy[idx]!];
		setDraft(copy);
		setDirty(true);
	};
	const addRole = (idx: number, roleId: string) => {
		if (!roleId) return;
		if (draft.some((lvl) => lvl.includes(roleId))) return; // unique
		setDraft((d) => d.map((lvl, i) => (i === idx ? [...lvl, roleId] : lvl)));
		setDirty(true);
	};
	const removeRole = (idx: number, roleId: string) => {
		setDraft((d) => d.map((lvl, i) => (i === idx ? lvl.filter((r) => r !== roleId) : lvl)));
		setDirty(true);
	};

	const reset = () => {
		setDraft(hierarchy.data?.levels ?? []);
		setDirty(false);
	};

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<Crown className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Hiérarchie staff</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Niveaux du plus haut (index <code>0</code>) au plus bas. Un staff sanctionne uniquement
					les membres de niveau <em>strictement plus grand</em>. Les owners et bot-dev bypassent
					toujours.
				</p>
				<div className="mt-3 flex items-center gap-2">
					<button type="button" className="btn btn-ghost" onClick={addLevel}>
						<Plus className="h-3 w-3" /> Ajouter un niveau
					</button>
					<button
						type="button"
						className="btn btn-primary"
						disabled={!dirty || save.isPending}
						onClick={() => save.mutate(draft)}
					>
						<Save className="h-3 w-3" /> Enregistrer
					</button>
					{dirty && (
						<button type="button" className="btn btn-ghost text-zinc-400" onClick={reset}>
							Annuler
						</button>
					)}
					{save.isSuccess && !dirty && (
						<span className="text-xs text-emerald-400">✓ enregistré</span>
					)}
					{save.isError && (
						<span className="text-xs text-red-400">
							<AlertTriangle className="inline h-3 w-3" /> {(save.error as Error)?.message}
						</span>
					)}
				</div>
			</div>

			{draft.length === 0 ? (
				<div className="card text-center text-zinc-500">
					Aucun niveau défini · les sanctions sont libres tant que la guard <code>ModOnly</code>{" "}
					passe.
				</div>
			) : (
				<div className="space-y-3">
					{draft.map((lvl, idx) => (
						<LevelCard
							key={idx}
							index={idx}
							roles={lvl}
							total={draft.length}
							onAddRole={(r) => addRole(idx, r)}
							onRemoveRole={(r) => removeRole(idx, r)}
							onMove={(d) => moveLevel(idx, d)}
							onRemove={() => removeLevel(idx)}
						/>
					))}
				</div>
			)}

			{hierarchy.data?.raw && (
				<details className="card">
					<summary className="cursor-pointer text-xs text-zinc-500">
						JSON brut (ce qui est stocké dans <code>moderation.hierarchy</code>)
					</summary>
					<pre className="mt-2 overflow-auto rounded bg-zinc-950 p-3 text-xs">
						{JSON.stringify(draft, null, 2)}
					</pre>
				</details>
			)}
		</div>
	);
}

function LevelCard({
	index,
	roles,
	total,
	onAddRole,
	onRemoveRole,
	onMove,
	onRemove,
}: {
	index: number;
	roles: string[];
	total: number;
	onAddRole: (r: string) => void;
	onRemoveRole: (r: string) => void;
	onMove: (delta: -1 | 1) => void;
	onRemove: () => void;
}) {
	const [pick, setPick] = useState("");
	const labelHint = index === 0 ? "(top — admin)" : index === total - 1 ? "(bas)" : "";
	return (
		<div className="card">
			<div className="flex items-center gap-2">
				<span className="rounded bg-brand-500/20 px-2 py-1 text-sm font-semibold text-brand-300">
					niveau {index}
				</span>
				<span className="text-xs text-zinc-500">{labelHint}</span>
				<div className="ml-auto flex items-center gap-1">
					<button
						type="button"
						className="btn btn-ghost px-2"
						disabled={index === 0}
						onClick={() => onMove(-1)}
						title="Monter"
					>
						<ArrowUp className="h-3 w-3" />
					</button>
					<button
						type="button"
						className="btn btn-ghost px-2"
						disabled={index === total - 1}
						onClick={() => onMove(1)}
						title="Descendre"
					>
						<ArrowDown className="h-3 w-3" />
					</button>
					<button
						type="button"
						className="btn btn-ghost px-2 text-red-400"
						onClick={onRemove}
						title="Supprimer le niveau"
					>
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			</div>
			<div className="mt-3 flex flex-wrap gap-2">
				{roles.length === 0 && <span className="text-xs italic text-zinc-500">aucun rôle</span>}
				{roles.map((r) => (
					<span
						key={r}
						className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
					>
						<RoleBadge roleId={r} />
						<button
							type="button"
							onClick={() => onRemoveRole(r)}
							className="ml-1 text-red-400 hover:text-red-300"
						>
							×
						</button>
					</span>
				))}
			</div>
			<div className="mt-3 flex items-center gap-2">
				<RoleSelect value={pick} onChange={setPick} className="flex-1" />
				<button
					type="button"
					className="btn btn-primary"
					disabled={!pick}
					onClick={() => {
						onAddRole(pick);
						setPick("");
					}}
				>
					Ajouter le rôle
				</button>
			</div>
		</div>
	);
}
