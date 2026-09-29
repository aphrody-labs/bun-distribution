import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Trash2, Edit, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api";

interface TableSpec {
	name: string;
	pk: string;
	readonly: boolean;
	mutableColumns: string[];
	description: string | null;
}

interface Props {
	table: string;
	navigate: (path: string) => void;
}

export function TableView({ table, navigate }: Props) {
	const [page, setPage] = useState(0);
	const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
	const limit = 25;
	const offset = page * limit;
	const qc = useQueryClient();

	const tableSpec = useQuery({
		queryKey: ["db", "tables"],
		queryFn: () => api.get<{ tables: TableSpec[] }>("/database/tables"),
	});
	const spec = tableSpec.data?.tables.find((t) => t.name === table);

	const rows = useQuery({
		queryKey: ["db", table, page],
		queryFn: () =>
			api.get<{ rows: Record<string, unknown>[]; total: number }>(
				`/database/${table}?limit=${limit}&offset=${offset}`
			),
		enabled: !!table,
	});

	const update = useMutation({
		mutationFn: (data: { id: unknown; body: Record<string, unknown> }) =>
			api.put(`/database/${table}/${encodeURIComponent(String(data.id))}`, data.body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["db", table] });
			setEditing(null);
		},
	});

	const remove = useMutation({
		mutationFn: (id: unknown) => api.delete(`/database/${table}/${encodeURIComponent(String(id))}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["db", table] }),
	});

	const cols = rows.data?.rows[0] ? Object.keys(rows.data.rows[0]) : [];
	const total = rows.data?.total ?? 0;
	const totalPages = Math.ceil(total / limit);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<button type="button" onClick={() => navigate("/database")} className="btn btn-ghost">
					<ArrowLeft className="h-4 w-4" />
				</button>
				<div>
					<h2 className="text-lg font-semibold">
						<code className="font-mono">{table}</code>
					</h2>
					{spec && <p className="text-xs text-zinc-400">{spec.description ?? "—"}</p>}
				</div>
				<div className="ml-auto text-sm text-zinc-400">
					{total} ligne{total > 1 ? "s" : ""} · page {page + 1} sur {Math.max(1, totalPages)}
				</div>
			</div>

			<div className="card overflow-x-auto p-0">
				<table className="w-full text-sm">
					<thead className="border-b border-zinc-800 bg-zinc-900/40">
						<tr>
							{cols.map((c) => (
								<th
									key={c}
									className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-400"
								>
									{c}
								</th>
							))}
							<th className="w-24 px-3 py-2" />
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-800">
						{rows.data?.rows.map((row, i) => (
							<tr key={i} className="hover:bg-zinc-900/30">
								{cols.map((c) => (
									<td key={c} className="max-w-xs truncate px-3 py-2 font-mono text-xs">
										{renderCell(row[c])}
									</td>
								))}
								<td className="px-3 py-2 text-right">
									{!spec?.readonly && (
										<div className="flex justify-end gap-1">
											<button
												type="button"
												onClick={() => setEditing(row)}
												className="btn btn-ghost px-2"
											>
												<Edit className="h-3 w-3" />
											</button>
											<button
												type="button"
												onClick={() => {
													if (!spec) return;
													if (confirm(`Supprimer la ligne ${row[spec.pk]} ?`))
														remove.mutate(row[spec.pk]);
												}}
												className="btn btn-ghost px-2 text-red-400"
											>
												<Trash2 className="h-3 w-3" />
											</button>
										</div>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="flex items-center justify-between">
				<button
					type="button"
					onClick={() => setPage((p) => Math.max(0, p - 1))}
					disabled={page === 0}
					className="btn btn-ghost"
				>
					Page précédente
				</button>
				<button
					type="button"
					onClick={() => setPage((p) => p + 1)}
					disabled={offset + limit >= total}
					className="btn btn-ghost"
				>
					Page suivante
				</button>
			</div>

			{editing && spec && (
				<EditModal
					row={editing}
					spec={spec}
					onClose={() => setEditing(null)}
					onSave={(body) => {
						const id = editing[spec.pk];
						update.mutate({ id, body });
					}}
					saving={update.isPending}
				/>
			)}
		</div>
	);
}

function renderCell(v: unknown): ReactNode {
	if (v === null || v === undefined) return "—";
	if (typeof v === "boolean") return v ? "Oui" : "Non";
	if (typeof v === "object") return JSON.stringify(v);
	const s = String(v);
	// Détection asset image : path .png/.webp/.jpg(.eg)/.gif sous ./assets/ ou /assets/
	if (/^\.?\/?assets\/.+\.(png|jpe?g|webp|gif)$/i.test(s)) {
		const url = "/" + s.replace(/^\.?\//, "");
		return (
			<a href={url} target="_blank" rel="noreferrer" className="inline-block">
				<img src={url} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" />
			</a>
		);
	}
	// URL externe http(s) → affichage en lien tronqué
	if (/^https?:\/\//.test(s)) {
		return (
			<a href={s} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
				{s.length > 40 ? `${s.slice(0, 40)}…` : s}
			</a>
		);
	}
	return s;
}

interface EditProps {
	row: Record<string, unknown>;
	spec: TableSpec;
	onClose: () => void;
	onSave: (body: Record<string, unknown>) => void;
	saving: boolean;
}

function EditModal({ row, spec, onClose, onSave, saving }: EditProps) {
	const [draft, setDraft] = useState<Record<string, string>>(() =>
		Object.fromEntries(spec.mutableColumns.map((c) => [c, row[c] != null ? String(row[c]) : ""]))
	);

	const submit = () => {
		const body: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(draft)) {
			if (v === "") continue;
			const original = row[k];
			if (typeof original === "number") body[k] = Number(v);
			else if (typeof original === "boolean") body[k] = v === "true" || v === "1";
			else body[k] = v;
		}
		onSave(body);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
			<div className="card w-full max-w-2xl max-h-[80vh] overflow-y-auto">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-lg font-semibold">
						Modifier la ligne · <code>{String(row[spec.pk])}</code>
					</h3>
					<button type="button" onClick={onClose} className="btn btn-ghost px-2">
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="space-y-3">
					{spec.mutableColumns.map((c) => (
						<div key={c}>
							<label className="mb-1 block text-xs font-medium text-zinc-400">{c}</label>
							<input
								className="input font-mono text-sm"
								value={draft[c] ?? ""}
								onChange={(e) => setDraft({ ...draft, [c]: e.target.value })}
								placeholder={String(row[c] ?? "")}
							/>
						</div>
					))}
				</div>

				<div className="mt-4 flex justify-end gap-2">
					<button type="button" onClick={onClose} className="btn btn-ghost">
						Annuler
					</button>
					<button type="button" onClick={submit} disabled={saving} className="btn btn-primary">
						<Save className="h-3 w-3" />{" "}
						{saving ? "Enregistrement…" : "Enregistrer les modifications"}
					</button>
				</div>
			</div>
		</div>
	);
}
