import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, ShoppingBag, Trash2, X, Search, Power, PowerOff } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../lib/api";
import { RoleSelect, RoleBadge } from "../components/RoleSelect";
import { RolePicker } from "../components/RolePicker";

interface ShopItem {
	key: string;
	type: "card" | "badge" | "color" | "title";
	name: string;
	description: string | null;
	price: number;
	roleId: string | null;
	meta: string | null;
	enabled: boolean;
}

const TYPE_META: Record<ShopItem["type"], { emoji: string; label: string; color: string }> = {
	card: { emoji: "🎴", label: "Carte profil", color: "text-amber-400" },
	badge: { emoji: "🏅", label: "Badge", color: "text-fuchsia-400" },
	color: { emoji: "🎨", label: "Couleur (rôle)", color: "text-blue-400" },
	title: { emoji: "👑", label: "Titre", color: "text-purple-400" },
};

export function Shop() {
	const qc = useQueryClient();
	const [editing, setEditing] = useState<ShopItem | null>(null);
	const [creating, setCreating] = useState(false);
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<string>("");

	const items = useQuery({
		queryKey: ["shop", "items"],
		queryFn: () => api.get<{ rows: ShopItem[]; total: number }>("/database/shop_items?limit=500"),
	});

	const remove = useMutation({
		mutationFn: (key: string) => api.delete(`/database/shop_items/${encodeURIComponent(key)}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["shop"] }),
	});

	const filtered = useMemo(() => {
		const rows = items.data?.rows ?? [];
		return rows.filter((r) => {
			if (typeFilter && r.type !== typeFilter) return false;
			if (search) {
				const s = search.toLowerCase();
				if (!r.key.toLowerCase().includes(s) && !r.name.toLowerCase().includes(s)) return false;
			}
			return true;
		});
	}, [items.data, search, typeFilter]);

	const stats = useMemo(() => {
		const rows = items.data?.rows ?? [];
		return {
			total: rows.length,
			enabled: rows.filter((r) => r.enabled).length,
			byType: rows.reduce(
				(acc, r) => {
					acc[r.type] = (acc[r.type] ?? 0) + 1;
					return acc;
				},
				{} as Record<string, number>
			),
		};
	}, [items.data]);

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<ShoppingBag className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Shop</h2>
					<span className="ml-2 text-xs text-zinc-500">
						{stats.total} item(s) · {stats.enabled} actif(s)
					</span>
					<button
						type="button"
						className="ml-auto btn btn-primary"
						onClick={() => setCreating(true)}
					>
						<Plus className="h-3 w-3" /> Créer
					</button>
				</div>
				<div className="mt-3 grid gap-2 sm:grid-cols-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
						<input
							className="input w-full pl-8"
							placeholder="Filtrer par nom / clé"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>
					<select
						className="input"
						value={typeFilter}
						onChange={(e) => setTypeFilter(e.target.value)}
					>
						<option value="">— Tous types —</option>
						{Object.entries(TYPE_META).map(([t, m]) => (
							<option key={t} value={t}>
								{m.emoji} {m.label} ({stats.byType[t] ?? 0})
							</option>
						))}
					</select>
					<div className="flex items-center gap-2 text-xs text-zinc-500">
						{filtered.length} résultat(s)
					</div>
				</div>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{filtered.map((item) => (
					<div key={item.key} className={`card ${item.enabled ? "" : "opacity-60"}`}>
						<div className="flex items-start gap-2">
							<span className={`text-2xl ${TYPE_META[item.type].color}`}>
								{TYPE_META[item.type].emoji}
							</span>
							<div className="flex-1 min-w-0">
								<h3 className="truncate font-semibold">{item.name}</h3>
								<code className="block truncate text-[10px] text-zinc-500">{item.key}</code>
							</div>
							{!item.enabled && <span className="badge badge-error">OFF</span>}
						</div>
						{item.description && (
							<p className="mt-2 line-clamp-2 text-xs text-zinc-400">{item.description}</p>
						)}
						<div className="mt-3 flex items-center gap-2">
							<span className="badge badge-warning">💰 {item.price.toLocaleString("fr-FR")} z</span>
							{item.roleId && <RoleBadge roleId={item.roleId} />}
						</div>
						<div className="mt-3 flex items-center gap-1 border-t border-zinc-800 pt-3">
							<button
								type="button"
								className="btn btn-ghost flex-1"
								onClick={() => setEditing(item)}
							>
								Modifier
							</button>
							<button
								type="button"
								className="btn btn-ghost px-2 text-red-400"
								onClick={() => {
									if (confirm(`Supprimer ${item.key} ?`)) remove.mutate(item.key);
								}}
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</div>
					</div>
				))}
				{filtered.length === 0 && !items.isLoading && (
					<div className="col-span-full card text-center text-zinc-500">
						Aucun item ne correspond aux filtres.
					</div>
				)}
			</div>

			{(editing || creating) && (
				<ShopItemEditor
					item={editing}
					onClose={() => {
						setEditing(null);
						setCreating(false);
					}}
					onSaved={() => qc.invalidateQueries({ queryKey: ["shop"] })}
				/>
			)}
		</div>
	);
}

function ShopItemEditor({
	item,
	onClose,
	onSaved,
}: {
	item: ShopItem | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const isCreate = !item;
	const [draft, setDraft] = useState<ShopItem>(
		item ?? {
			key: "",
			type: "title",
			name: "",
			description: "",
			price: 100,
			roleId: null,
			meta: null,
			enabled: true,
		}
	);
	const [error, setError] = useState<string | null>(null);

	const save = useMutation({
		mutationFn: async (payload: ShopItem) => {
			if (isCreate) {
				return api.post("/database/shop_items", payload);
			}
			return api.put(`/database/shop_items/${encodeURIComponent(payload.key)}`, payload);
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
		if (!draft.key || !draft.name) {
			setError("Clé et nom requis.");
			return;
		}
		if (!/^[a-z0-9_-]+$/.test(draft.key)) {
			setError("Clé doit être [a-z0-9_-]+ (slug).");
			return;
		}
		if (draft.meta) {
			try {
				JSON.parse(draft.meta);
			} catch {
				setError("Meta doit être du JSON valide.");
				return;
			}
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
						{isCreate ? "Créer un item shop" : `Modifier ${draft.key}`}
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
						<label className="block text-xs text-zinc-500">Clé (slug)</label>
						<input
							className="input w-full font-mono text-xs"
							value={draft.key}
							onChange={(e) => setDraft({ ...draft, key: e.target.value })}
							disabled={!isCreate}
							placeholder="goku_card"
						/>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">Type</label>
						<select
							className="input w-full"
							value={draft.type}
							onChange={(e) => setDraft({ ...draft, type: e.target.value as ShopItem["type"] })}
						>
							{Object.entries(TYPE_META).map(([t, m]) => (
								<option key={t} value={t}>
									{m.emoji} {m.label}
								</option>
							))}
						</select>
					</div>
					<div className="sm:col-span-2">
						<label className="block text-xs text-zinc-500">Nom (affiché en boutique)</label>
						<input
							className="input w-full"
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
							placeholder="Goku Saiyan"
						/>
					</div>
					<div className="sm:col-span-2">
						<label className="block text-xs text-zinc-500">Description (optionnel)</label>
						<textarea
							className="input w-full"
							rows={2}
							value={draft.description ?? ""}
							onChange={(e) => setDraft({ ...draft, description: e.target.value })}
						/>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">Prix (zenis)</label>
						<input
							className="input w-full"
							type="number"
							min={0}
							value={draft.price}
							onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) || 0 })}
						/>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">Activé</label>
						<button
							type="button"
							className={`btn ${draft.enabled ? "btn-primary" : "btn-ghost"} w-full`}
							onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
						>
							{draft.enabled ? (
								<>
									<Power className="h-3 w-3" /> Visible boutique
								</>
							) : (
								<>
									<PowerOff className="h-3 w-3" /> Masqué
								</>
							)}
						</button>
					</div>
					{draft.type === "color" && (
						<div className="sm:col-span-2">
							<label className="block text-xs text-zinc-500">
								Rôle attribué à l'achat (couleurs uniquement)
							</label>
							<RolePicker
								value={draft.roleId ?? ""}
								onChange={(v) => setDraft({ ...draft, roleId: v || null })}
							/>
						</div>
					)}
					<div className="sm:col-span-2">
						<label className="block text-xs text-zinc-500">
							Meta (JSON optionnel — image url, propriétés custom)
						</label>
						<textarea
							className="input w-full font-mono text-xs"
							rows={3}
							value={draft.meta ?? ""}
							onChange={(e) => setDraft({ ...draft, meta: e.target.value || null })}
							placeholder='{"image": "https://..."}'
						/>
					</div>
				</div>
				<div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
					<button type="submit" className="btn btn-primary" disabled={save.isPending}>
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
