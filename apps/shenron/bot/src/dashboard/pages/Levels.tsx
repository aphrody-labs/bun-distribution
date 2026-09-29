import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Trophy,
	TrendingUp,
	Plus,
	Trash2,
	Save,
	Mic,
	MessageSquare,
	Coins,
	Flame,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api";
import { formatDuration } from "../lib/utils";
import { RoleSelect, RoleBadge } from "../components/RoleSelect";
import { RolePicker } from "../components/RolePicker";
import { formatZeni } from "~/lib/zeni";

interface Threshold {
	level: number;
	xp: number;
}

interface ConfigResponse {
	thresholds: Threshold[];
	defaults: Record<string, number>;
	overrides: Record<string, string>;
}

interface DistributionBucket {
	level: number;
	minXp: number;
	maxXp: number;
	count: number;
}

interface LevelReward {
	level: number;
	roleId: string;
	xpThreshold: number;
	zeniBonus: number;
}

interface TopUser {
	id: string;
	xp: number;
	zeni: number;
	lastLevelReached: number;
	messageCount: number;
	totalVoiceMs: number;
	dailyStreak: number;
}

type Metric = "xp" | "zeni" | "voice" | "streak" | "messages";

export function Levels() {
	const config = useQuery({
		queryKey: ["levels", "config"],
		queryFn: () => api.get<ConfigResponse>("/levels/config"),
	});
	const distribution = useQuery({
		queryKey: ["levels", "distribution"],
		queryFn: () => api.get<{ buckets: DistributionBucket[] }>("/levels/distribution"),
	});
	const rewards = useQuery({
		queryKey: ["levels", "rewards"],
		queryFn: () => api.get<{ rewards: LevelReward[] }>("/levels/rewards"),
	});

	return (
		<div className="space-y-6">
			<div className="card">
				<div className="flex items-center gap-2">
					<Trophy className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Système de niveaux et XP</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Configuration des paliers, distribution des joueurs, classements et actions manuelles. Le
					palier final « It's over 9 millions ! » correspond à 9 000 000 XP.
				</p>
			</div>

			<XpRatesCard config={config.data} loading={config.isLoading} />
			<ThresholdsCard config={config.data} distribution={distribution.data?.buckets} />
			<RewardsCard rewards={rewards.data?.rewards ?? []} />
			<TopsCard />
			<ManualActionsCard />
		</div>
	);
}

function effective(config: ConfigResponse | undefined, key: string): string {
	if (!config) return "—";
	if (config.overrides[key] !== undefined) return config.overrides[key]!;
	const def = config.defaults[key];
	return def !== undefined ? String(def) : "—";
}

function XpRatesCard({
	config,
	loading,
}: {
	config: ConfigResponse | undefined;
	loading: boolean;
}) {
	if (loading) return <div className="text-zinc-500">Chargement de la configuration…</div>;
	const rates = [
		{
			key: "xp.message.min",
			label: "XP minimum par message",
			icon: <MessageSquare className="h-4 w-4" />,
		},
		{
			key: "xp.message.max",
			label: "XP maximum par message",
			icon: <MessageSquare className="h-4 w-4" />,
		},
		{
			key: "xp.message.cooldown_ms",
			label: "Cooldown messages (ms)",
			icon: <MessageSquare className="h-4 w-4" />,
		},
		{
			key: "xp.voice.per_minute",
			label: "XP par minute en vocal",
			icon: <Mic className="h-4 w-4" />,
		},
		{
			key: "zeni.daily_quest",
			label: "Récompense quête quotidienne",
			icon: <Flame className="h-4 w-4" />,
		},
		{
			key: "zeni.per_level",
			label: "Bonus zénis par level-up",
			icon: <Coins className="h-4 w-4" />,
		},
	];

	return (
		<div className="card">
			<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
				Taux d'XP et de zénis (effectifs)
			</h3>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{rates.map((r) => {
					const value = effective(config, r.key);
					const overridden = config?.overrides[r.key] !== undefined;
					return (
						<div key={r.key} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
							<div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
								{r.icon}
								<span>{r.label}</span>
							</div>
							<p className="text-xl font-bold text-brand-400">{value}</p>
							<p className="mt-1 text-xs text-zinc-500">
								<code>{r.key}</code>
								{overridden && <span className="ml-2 badge badge-warning">surcharge active</span>}
							</p>
						</div>
					);
				})}
			</div>
			<p className="mt-3 text-xs text-zinc-500">
				Modifier ces valeurs depuis la page <code>/settings</code> ou via la commande{" "}
				<code>/config</code> dans Discord.
			</p>
		</div>
	);
}

function ThresholdsCard({
	config,
	distribution,
}: {
	config: ConfigResponse | undefined;
	distribution: DistributionBucket[] | undefined;
}) {
	if (!config) return null;
	const total = (distribution ?? []).reduce((s, b) => s + b.count, 0);
	const max = Math.max(...(distribution ?? [{ count: 1 }]).map((b) => b.count), 1);

	return (
		<div className="card">
			<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
				<TrendingUp className="h-4 w-4" />
				Paliers DBZ — distribution des joueurs ({total} au total)
			</h3>
			<div className="space-y-2">
				{config.thresholds.map((t, i) => {
					const bucket = distribution?.find((b) => b.level === t.level);
					const minXp = i === 0 ? 0 : config.thresholds[i - 1]!.xp;
					const count = bucket?.count ?? 0;
					return (
						<div key={t.level} className="flex items-center gap-3">
							<span className="w-20 font-mono text-xs text-zinc-400">niveau {t.level}</span>
							<span className="w-32 text-right font-mono text-xs text-zinc-500">
								{minXp.toLocaleString("fr-FR")} – {t.xp.toLocaleString("fr-FR")}
							</span>
							<div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800">
								<div
									className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all"
									style={{ width: `${(count / max) * 100}%` }}
								/>
							</div>
							<span className="w-16 text-right font-mono text-xs">
								{count} joueur{count > 1 ? "s" : ""}
							</span>
						</div>
					);
				})}
				{distribution?.find((b) => b.level === 11)?.count ? (
					<div className="flex items-center gap-3">
						<span className="w-20 font-mono text-xs text-amber-400">au-delà</span>
						<span className="w-32 text-right font-mono text-xs text-zinc-500">&gt; 9 000 000</span>
						<div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800">
							<div
								className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all"
								style={{
									width: `${((distribution?.find((b) => b.level === 11)?.count ?? 0) / max) * 100}%`,
								}}
							/>
						</div>
						<span className="w-16 text-right font-mono text-xs">
							{distribution?.find((b) => b.level === 11)?.count}
						</span>
					</div>
				) : null}
			</div>
		</div>
	);
}

function RewardsCard({ rewards }: { rewards: LevelReward[] }) {
	const qc = useQueryClient();
	const [editing, setEditing] = useState<LevelReward | null>(null);
	const [adding, setAdding] = useState(false);

	const upsert = useMutation({
		mutationFn: (r: LevelReward) =>
			api.post("/levels/rewards", {
				level: r.level,
				roleId: r.roleId,
				xpThreshold: r.xpThreshold,
				zeniBonus: r.zeniBonus,
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["levels", "rewards"] });
			setEditing(null);
			setAdding(false);
		},
	});

	const remove = useMutation({
		mutationFn: (level: number) => api.delete(`/levels/rewards/${level}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["levels", "rewards"] }),
	});

	return (
		<div className="card">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
					Récompenses de palier ({rewards.length})
				</h3>
				<button type="button" onClick={() => setAdding(true)} className="btn btn-primary">
					<Plus className="h-3 w-3" />
					Ajouter une récompense
				</button>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="text-xs uppercase tracking-wide text-zinc-500">
						<tr>
							<th className="px-3 py-2 text-left">Niveau</th>
							<th className="px-3 py-2 text-left">Rôle Discord</th>
							<th className="px-3 py-2 text-right">Seuil XP</th>
							<th className="px-3 py-2 text-right">Bonus zénis</th>
							<th className="px-3 py-2" />
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-800">
						{rewards.map((r) => (
							<tr key={r.level}>
								<td className="px-3 py-2 font-bold text-brand-400">{r.level}</td>
								<td className="px-3 py-2 text-sm">
									<RoleBadge roleId={r.roleId} />
								</td>
								<td className="px-3 py-2 text-right font-mono text-xs">
									{r.xpThreshold.toLocaleString("fr-FR")}
								</td>
								<td className="px-3 py-2 text-right font-mono text-xs text-amber-400">
									+{r.zeniBonus.toLocaleString("fr-FR")}
								</td>
								<td className="px-3 py-2 text-right">
									<div className="flex justify-end gap-1">
										<button
											type="button"
											onClick={() => setEditing(r)}
											className="btn btn-ghost px-2"
										>
											<Save className="h-3 w-3" />
										</button>
										<button
											type="button"
											onClick={() => {
												if (confirm(`Supprimer la récompense du niveau ${r.level} ?`))
													remove.mutate(r.level);
											}}
											className="btn btn-ghost px-2 text-red-400"
										>
											<Trash2 className="h-3 w-3" />
										</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{(editing || adding) && (
				<RewardForm
					initial={editing ?? undefined}
					onSubmit={(r) => upsert.mutate(r)}
					onCancel={() => {
						setEditing(null);
						setAdding(false);
					}}
					pending={upsert.isPending}
				/>
			)}
		</div>
	);
}

function RewardForm({
	initial,
	onSubmit,
	onCancel,
	pending,
}: {
	initial?: LevelReward;
	onSubmit: (r: LevelReward) => void;
	onCancel: () => void;
	pending: boolean;
}) {
	const [level, setLevel] = useState(String(initial?.level ?? ""));
	const [roleId, setRoleId] = useState(initial?.roleId ?? "");
	const [xpThreshold, setXpThreshold] = useState(String(initial?.xpThreshold ?? ""));
	const [zeniBonus, setZeniBonus] = useState(String(initial?.zeniBonus ?? "1000"));

	const submit = (e: FormEvent) => {
		e.preventDefault();
		onSubmit({
			level: Number(level),
			roleId,
			xpThreshold: Number(xpThreshold),
			zeniBonus: Number(zeniBonus),
		});
	};

	return (
		<form
			onSubmit={submit}
			className="mt-3 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
		>
			<div className="grid gap-3 sm:grid-cols-4">
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Niveau</label>
					<input
						className="input"
						type="number"
						min="1"
						value={level}
						onChange={(e) => setLevel(e.target.value)}
						required
						disabled={!!initial}
					/>
				</div>
				<div className="sm:col-span-3">
					<label className="mb-1 block text-xs text-zinc-400">Rôle Discord à attribuer</label>
					<RolePicker value={roleId} onChange={setRoleId} />
				</div>
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Seuil XP</label>
					<input
						className="input"
						type="number"
						min="0"
						value={xpThreshold}
						onChange={(e) => setXpThreshold(e.target.value)}
						required
					/>
				</div>
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Bonus zénis</label>
					<input
						className="input"
						type="number"
						min="0"
						value={zeniBonus}
						onChange={(e) => setZeniBonus(e.target.value)}
						required
					/>
				</div>
			</div>
			<div className="flex justify-end gap-2">
				<button type="button" onClick={onCancel} className="btn btn-ghost">
					Annuler
				</button>
				<button type="submit" disabled={pending} className="btn btn-primary">
					<Save className="h-3 w-3" />
					{pending ? "Enregistrement…" : "Enregistrer la récompense"}
				</button>
			</div>
		</form>
	);
}

function TopsCard() {
	const [metric, setMetric] = useState<Metric>("xp");
	const [limit, setLimit] = useState(10);
	const top = useQuery({
		queryKey: ["levels", "top", metric, limit],
		queryFn: () => api.get<{ users: TopUser[] }>(`/levels/top?metric=${metric}&limit=${limit}`),
	});

	const formatMetric = (u: TopUser): string => {
		switch (metric) {
			case "voice":
				return formatDuration(u.totalVoiceMs);
			case "streak":
				return `${u.dailyStreak} jour${u.dailyStreak > 1 ? "s" : ""}`;
			case "messages":
				return `${u.messageCount.toLocaleString("fr-FR")} msg`;
			case "zeni":
				return formatZeni(u.zeni);
			default:
				return `${u.xp.toLocaleString("fr-FR")} XP`;
		}
	};

	return (
		<div className="card">
			<div className="mb-3 flex flex-wrap items-center gap-3">
				<h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Classements</h3>
				<div className="flex flex-wrap gap-1">
					{(
						[
							{ k: "xp" as Metric, label: "XP" },
							{ k: "zeni" as Metric, label: "Zénis" },
							{ k: "voice" as Metric, label: "Temps en vocal" },
							{ k: "messages" as Metric, label: "Messages" },
							{ k: "streak" as Metric, label: "Streak quête" },
						] as const
					).map((m) => (
						<button
							key={m.k}
							type="button"
							onClick={() => setMetric(m.k)}
							className={`btn ${metric === m.k ? "btn-primary" : "btn-ghost"}`}
						>
							{m.label}
						</button>
					))}
				</div>
				<select
					className="input ml-auto w-32"
					value={limit}
					onChange={(e) => setLimit(Number(e.target.value))}
				>
					{[10, 25, 50].map((n) => (
						<option key={n} value={n}>
							Top {n}
						</option>
					))}
				</select>
			</div>

			<div className="space-y-1.5">
				{top.data?.users.map((u, i) => (
					<div key={u.id} className="flex items-center gap-3 text-sm">
						<span className="w-8 text-right font-mono text-xs text-zinc-500">#{i + 1}</span>
						<code className="w-44 truncate text-xs">{u.id}</code>
						<span className="flex-1 truncate text-xs text-zinc-400">
							niveau {u.lastLevelReached} · {u.xp.toLocaleString("fr-FR")} XP ·{" "}
							{formatZeni(u.zeni)}
						</span>
						<span className="text-right font-mono text-sm text-brand-400">{formatMetric(u)}</span>
					</div>
				))}
				{top.data?.users.length === 0 && (
					<p className="text-sm italic text-zinc-500">
						Aucun joueur enregistré pour cette métrique.
					</p>
				)}
			</div>
		</div>
	);
}

function ManualActionsCard() {
	const [userId, setUserId] = useState("");
	const [target, setTarget] = useState<"xp" | "zeni">("xp");
	const [mode, setMode] = useState<"add" | "set">("add");
	const [amount, setAmount] = useState("");
	const [lastResult, setLastResult] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: () =>
			api.post(`/levels/users/${userId}/${target}`, {
				mode,
				amount: Number(amount),
			}),
		onSuccess: (data) => setLastResult(JSON.stringify(data, null, 2)),
		onError: (err) => setLastResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
	});

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setLastResult(null);
		mutation.mutate();
	};

	return (
		<form onSubmit={submit} className="card space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
				Action manuelle sur un joueur
			</h3>
			<p className="text-xs text-zinc-500">
				Ajoute ou définit l'XP ou les zénis d'un membre. Utilise l'identifiant Discord (snowflake)
				du joueur.
			</p>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="lg:col-span-2">
					<label className="mb-1 block text-xs text-zinc-400">ID du joueur</label>
					<input
						className="input font-mono text-xs"
						value={userId}
						onChange={(e) => setUserId(e.target.value)}
						placeholder="000000000000000000"
						required
					/>
				</div>
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Cible</label>
					<select
						className="input"
						value={target}
						onChange={(e) => setTarget(e.target.value as "xp" | "zeni")}
					>
						<option value="xp">XP</option>
						<option value="zeni">Zénis</option>
					</select>
				</div>
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Opération</label>
					<select
						className="input"
						value={mode}
						onChange={(e) => setMode(e.target.value as "add" | "set")}
					>
						<option value="add">Ajouter</option>
						<option value="set">Définir</option>
					</select>
				</div>
				<div className="lg:col-span-2">
					<label className="mb-1 block text-xs text-zinc-400">Montant</label>
					<input
						className="input"
						type="number"
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
						placeholder={mode === "add" ? "ex. 1000 ou -500" : "ex. 50000"}
						required
					/>
				</div>
			</div>
			<button
				type="submit"
				disabled={!userId || !amount || mutation.isPending}
				className="btn btn-primary"
			>
				<Save className="h-3 w-3" />
				{mutation.isPending ? "Application…" : "Appliquer"}
			</button>
			{lastResult && (
				<pre className="overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300">
					{lastResult}
				</pre>
			)}
		</form>
	);
}
