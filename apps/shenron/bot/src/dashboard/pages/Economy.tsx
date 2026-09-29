import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Coins,
	TrendingUp,
	Users,
	Gift,
	Trophy,
	History,
	Send,
	Edit,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

interface EconomyStats {
	zeni: {
		total: number;
		avg: number;
		max: number;
		users: number;
		rich: number;
		zero: number;
	};
	fusions: number;
	inventoryItems: number;
	shopItemsActive: number;
}
interface UserRow {
	id: string;
	zeni: number;
	xp: number;
	displayName?: string | null;
}
interface TransactionRow {
	id: number;
	userId: string | null;
	moderatorId: string | null;
	action: string;
	reason: string | null;
	meta: string | null;
	createdAt: string;
}

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
	SHOP_PURCHASE: { label: "🛒 Achat shop", color: "text-blue-400" },
	LEVEL_UP: { label: "🚀 Level up", color: "text-emerald-400" },
	ZENI_ADMIN_GIVE: { label: "➕ Don admin", color: "text-yellow-400" },
	ZENI_ADMIN_REMOVE: { label: "➖ Retrait admin", color: "text-red-400" },
	ZENI_ADMIN_SET: { label: "✏️ Set admin", color: "text-purple-400" },
	ZENI_ADMIN_BULK: { label: "📤 Distribution masse", color: "text-cyan-400" },
};

export function Economy() {
	const qc = useQueryClient();

	const stats = useQuery({
		queryKey: ["economy", "stats"],
		queryFn: () => api.get<EconomyStats>("/economy/stats"),
		refetchInterval: 30_000,
	});

	const top = useQuery({
		queryKey: ["economy", "top"],
		queryFn: () => api.get<{ rows: UserRow[] }>("/economy/leaderboard?limit=20"),
	});

	const txs = useQuery({
		queryKey: ["economy", "txs"],
		queryFn: () => api.get<{ rows: TransactionRow[] }>("/economy/transactions?limit=50"),
	});

	const settings = useQuery({
		queryKey: ["settings", "all"],
		queryFn: () =>
			api.get<{ rows: { key: string; value: string }[] }>("/database/guild_settings?limit=200"),
		staleTime: 30_000,
	});
	const channels = useQuery({
		queryKey: ["discord", "channels"],
		queryFn: () =>
			api.get<{ channels: { id: string; name: string; type: number }[] }>("/discord/channels"),
		staleTime: 30_000,
	});

	const channelZeniId = settings.data?.rows.find((r) => r.key === "channel.zeni")?.value;
	const channelZeniName = channels.data?.channels.find((c) => c.id === channelZeniId)?.name;

	const setSetting = useMutation({
		mutationFn: ({ key, value }: { key: string; value: string }) =>
			api.post("/services/settings/set", { key, value }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
	});
	const unsetSetting = useMutation({
		mutationFn: (key: string) => api.post("/services/settings/unset", { key }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
	});

	const give = useMutation({
		mutationFn: (body: {
			mode: "user" | "role" | "all";
			userId?: string;
			roleId?: string;
			amount: number;
		}) => api.post<{ ok: boolean; applied?: number }>("/economy/give", body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["economy"] });
		},
	});
	const setBalance = useMutation({
		mutationFn: (body: { userId: string; amount: number }) => api.post("/economy/set", body),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["economy"] }),
	});

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<Coins className="h-5 w-5 text-amber-400" />
					<h2 className="text-lg font-semibold">Économie</h2>
					<button
						type="button"
						onClick={() => qc.invalidateQueries({ queryKey: ["economy"] })}
						className="btn btn-ghost ml-auto px-2"
						title="Rafraîchir"
					>
						<RefreshCw className="h-3 w-3" />
					</button>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Vue d'ensemble du système économique : circulation, top zenis, transactions, et opérations
					admin (distribution masse, set direct, salon des récompenses).
				</p>
			</div>

			{/* ── Salon des récompenses zeni ──────────────────────────── */}
			<div className="card">
				<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
					<Gift className="h-4 w-4" />
					Salon des récompenses zeni
				</h3>
				<p className="mb-3 text-xs text-zinc-500">
					Cible des notifications de récompense zeni : <code>daily_quest</code>,{" "}
					<code>zeni_drop</code> (drop aléatoire sur message), <code>zeni_game_win</code> (victoire
					à un jeu). Templates éditables sur <code>/messages</code>.
				</p>
				<div className="flex items-center gap-2">
					<select
						className="input flex-1"
						value={channelZeniId ?? ""}
						onChange={(e) => {
							const v = e.target.value;
							if (!v) unsetSetting.mutate("channel.zeni");
							else setSetting.mutate({ key: "channel.zeni", value: v });
						}}
					>
						<option value="">— Aucun (pas de notif) —</option>
						{channels.data?.channels
							.filter((c) => c.type === 0)
							.map((c) => (
								<option key={c.id} value={c.id}>
									#{c.name}
								</option>
							))}
					</select>
					{channelZeniName && <span className="badge badge-success">→ #{channelZeniName}</span>}
				</div>
			</div>

			{/* ── Stats globales ──────────────────────────────────────── */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					icon={Coins}
					label="Zeni en circulation"
					value={fmtNum(stats.data?.zeni.total)}
					sub={`Max : ${fmtNum(stats.data?.zeni.max)} z`}
					color="text-amber-400"
				/>
				<StatCard
					icon={Users}
					label="Utilisateurs"
					value={fmtNum(stats.data?.zeni.users)}
					sub={`${stats.data?.zeni.rich ?? 0} riches · ${stats.data?.zeni.zero ?? 0} à 0`}
					color="text-blue-400"
				/>
				<StatCard
					icon={TrendingUp}
					label="Solde moyen"
					value={fmtNum(Math.round(stats.data?.zeni.avg ?? 0))}
					sub="Moyenne par membre"
					color="text-emerald-400"
				/>
				<StatCard
					icon={Trophy}
					label="Items inventaire"
					value={fmtNum(stats.data?.inventoryItems)}
					sub={`${stats.data?.fusions ?? 0} fusions · ${stats.data?.shopItemsActive ?? 0} shop`}
					color="text-purple-400"
				/>
			</div>

			{/* ── Top zenis ────────────────────────────────────────────── */}
			<div className="card">
				<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
					<Trophy className="h-4 w-4" />
					Top 20 zenis
				</h3>
				{top.isLoading && <div className="text-zinc-500">Chargement…</div>}
				<div className="space-y-1">
					{top.data?.rows.map((u, i) => (
						<div key={u.id} className="flex items-center gap-3 rounded p-2 hover:bg-zinc-800/40">
							<span className="w-8 text-right font-mono text-sm text-zinc-500">#{i + 1}</span>
							<code className="flex-1 truncate text-xs text-zinc-300">{u.id}</code>
							<span className="font-mono text-sm font-semibold text-amber-400">
								{u.zeni.toLocaleString("fr-FR")} z
							</span>
							<EditBalanceButton
								userId={u.id}
								current={u.zeni}
								onSave={(amount) => setBalance.mutate({ userId: u.id, amount })}
							/>
						</div>
					))}
				</div>
			</div>

			{/* ── Bulk operations ──────────────────────────────────────── */}
			<div className="card">
				<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
					<Send className="h-4 w-4" />
					Distribution masse
				</h3>
				<BulkGiveForm onSubmit={(body) => give.mutate(body)} pending={give.isPending} />
				{give.data && (
					<p className="mt-2 text-xs text-emerald-400">
						✓ Appliqué sur {give.data.applied ?? 0} membre(s).
					</p>
				)}
				{give.error && (
					<p className="mt-2 text-xs text-red-400">
						✗ {give.error instanceof Error ? give.error.message : String(give.error)}
					</p>
				)}
			</div>

			{/* ── Transactions log ─────────────────────────────────────── */}
			<div className="card">
				<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
					<History className="h-4 w-4" />
					Transactions récentes
				</h3>
				{txs.isLoading && <div className="text-zinc-500">Chargement…</div>}
				{txs.data?.rows.length === 0 && <p className="text-zinc-500">Aucune transaction.</p>}
				<div className="space-y-1 max-h-[500px] overflow-y-auto">
					{txs.data?.rows.map((t) => {
						const meta = ACTION_LABEL[t.action] ?? {
							label: t.action,
							color: "text-zinc-400",
						};
						return (
							<div key={t.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-xs">
								<div className="flex items-center gap-2">
									<span className={`font-medium ${meta.color}`}>{meta.label}</span>
									{t.userId && <code className="text-zinc-400">{t.userId}</code>}
									<span className="ml-auto text-zinc-500">
										{new Date(t.createdAt).toLocaleString("fr-FR")}
									</span>
								</div>
								{t.meta && <pre className="mt-1 overflow-x-auto text-zinc-500">{t.meta}</pre>}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function StatCard({
	icon: Icon,
	label,
	value,
	sub,
	color,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	sub: string;
	color: string;
}) {
	return (
		<div className="card">
			<div className="flex items-start justify-between gap-2">
				<div>
					<p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
					<p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
					<p className="mt-1 text-xs text-zinc-500">{sub}</p>
				</div>
				<Icon className={`h-5 w-5 ${color}`} />
			</div>
		</div>
	);
}

function EditBalanceButton({
	userId,
	current,
	onSave,
}: {
	userId: string;
	current: number;
	onSave: (amount: number) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [val, setVal] = useState(String(current));
	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => {
					setVal(String(current));
					setEditing(true);
				}}
				className="btn btn-ghost px-1 py-0 text-xs"
				title={`Set zenis pour ${userId}`}
			>
				<Edit className="h-3 w-3" />
			</button>
		);
	}
	return (
		<div className="flex items-center gap-1">
			<input
				type="number"
				min={0}
				value={val}
				onChange={(e) => setVal(e.target.value)}
				className="input w-24 px-1 py-0 text-xs"
			/>
			<button
				type="button"
				onClick={() => {
					const n = Number.parseInt(val, 10);
					if (!Number.isFinite(n) || n < 0) return;
					onSave(n);
					setEditing(false);
				}}
				className="btn btn-primary px-1 py-0 text-xs"
			>
				✓
			</button>
			<button
				type="button"
				onClick={() => setEditing(false)}
				className="btn btn-ghost px-1 py-0 text-xs"
			>
				✕
			</button>
		</div>
	);
}

function BulkGiveForm({
	onSubmit,
	pending,
}: {
	onSubmit: (body: {
		mode: "user" | "role" | "all";
		userId?: string;
		roleId?: string;
		amount: number;
	}) => void;
	pending: boolean;
}) {
	const [mode, setMode] = useState<"user" | "role" | "all">("user");
	const [userId, setUserId] = useState("");
	const [roleId, setRoleId] = useState("");
	const [amount, setAmount] = useState("100");

	return (
		<div className="space-y-3">
			<div className="flex gap-2">
				{(["user", "role", "all"] as const).map((m) => (
					<button
						key={m}
						type="button"
						onClick={() => setMode(m)}
						className={`btn ${mode === m ? "btn-primary" : "btn-ghost"}`}
					>
						{m === "user" ? "1 membre" : m === "role" ? "1 rôle" : "Tous"}
					</button>
				))}
			</div>
			<div className="grid gap-2 sm:grid-cols-3">
				{mode === "user" && (
					<input
						type="text"
						value={userId}
						onChange={(e) => setUserId(e.target.value)}
						placeholder="User ID Discord"
						className="input"
					/>
				)}
				{mode === "role" && (
					<input
						type="text"
						value={roleId}
						onChange={(e) => setRoleId(e.target.value)}
						placeholder="Role ID Discord"
						className="input"
					/>
				)}
				<input
					type="number"
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
					placeholder="Montant (négatif = retrait)"
					className="input"
				/>
				<button
					type="button"
					onClick={() => {
						const n = Number.parseInt(amount, 10);
						if (!Number.isFinite(n) || n === 0) return;
						const confirmation =
							mode === "all"
								? `Distribuer ${n} z à TOUS les membres en DB ?`
								: mode === "role"
									? `Distribuer ${n} z à tous les membres avec le rôle ${roleId} ?`
									: `Donner ${n} z à ${userId} ?`;
						if (!confirm(confirmation)) return;
						onSubmit({ mode, userId, roleId, amount: n });
					}}
					disabled={pending || !amount}
					className="btn btn-primary"
				>
					<Send className="h-3 w-3" />
					{pending ? "Envoi…" : "Distribuer"}
				</button>
			</div>
			<p className="text-xs text-zinc-500">
				Montant négatif = retrait. Mode "all" itère sur tous les users en DB. Mode "role" fetch tous
				les membres du serveur (peut prendre quelques secondes). Toutes les opérations sont loguées
				en <code>action_logs</code> avec source "dashboard".
			</p>
		</div>
	);
}

function fmtNum(n: number | undefined): string {
	if (n === undefined || n === null) return "—";
	return n.toLocaleString("fr-FR");
}
