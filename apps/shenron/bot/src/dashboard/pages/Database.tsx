import { useQuery } from "@tanstack/react-query";
import { Database as DbIcon, Lock } from "lucide-react";
import { api } from "../lib/api";

interface TableSpec {
	name: string;
	pk: string;
	readonly: boolean;
	mutableColumns: string[];
	description: string | null;
}

interface Props {
	navigate: (path: string) => void;
}

export function Database({ navigate }: Props) {
	const { data, isLoading } = useQuery({
		queryKey: ["db", "tables"],
		queryFn: () => api.get<{ tables: TableSpec[] }>("/database/tables"),
	});

	if (isLoading) return <div className="text-zinc-500">Chargement en cours…</div>;

	return (
		<div className="space-y-4">
			<div className="card">
				<h2 className="text-lg font-semibold">Tables de la base</h2>
				<p className="mt-1 text-sm text-zinc-400">
					16 tables exposées avec liste blanche <code>mutableColumns</code> par sécurité.
				</p>
			</div>

			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
				{data?.tables.map((t) => (
					<button
						key={t.name}
						type="button"
						onClick={() => navigate(`/database/${t.name}`)}
						className="card cursor-pointer text-left transition-colors hover:border-brand-500/50 hover:bg-zinc-900/60"
					>
						<div className="mb-2 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<DbIcon className="h-4 w-4 text-brand-400" />
								<code className="font-mono text-sm font-semibold">{t.name}</code>
							</div>
							{t.readonly && <Lock className="h-3 w-3 text-zinc-500" />}
						</div>
						{t.description && <p className="text-xs text-zinc-400">{t.description}</p>}
						<div className="mt-3 flex gap-2 text-xs">
							<span className="badge">Clé : {t.pk}</span>
							{!t.readonly && (
								<span className="badge badge-success">
									{t.mutableColumns.length} colonne{t.mutableColumns.length > 1 ? "s" : ""}{" "}
									modifiable{t.mutableColumns.length > 1 ? "s" : ""}
								</span>
							)}
							{t.readonly && <span className="badge">lecture seule</span>}
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
