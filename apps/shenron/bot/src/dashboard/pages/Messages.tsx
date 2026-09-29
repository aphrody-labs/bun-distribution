import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Save, RotateCcw, Eye, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface EventVariable {
	name: string;
	description: string;
}

interface EventEntry {
	event: string;
	description: string;
	defaultTemplate: string;
	defaultChannelKey: string;
	template: string;
	channelKey: string;
	enabled: boolean;
	isCustom: boolean;
	embed: boolean;
	variables: EventVariable[];
}

const CHANNEL_KEYS: { key: string; label: string; virtual?: boolean }[] = [
	{ key: "channel.announce", label: "Annonces générales" },
	{ key: "channel.achievement", label: "Accomplissements" },
	{ key: "channel.level", label: "Niveau & XP" },
	{ key: "channel.welcome", label: "Bienvenue" },
	{ key: "channel.farewell", label: "Au revoir" },
	{ key: "channel.giveaway", label: "Tirages au sort" },
	{ key: "channel.mod_notify", label: "Notifications modération" },
	{ key: "channel.log_sanction", label: "Logs sanctions" },
	{ key: "channel.dm", label: "DM membre concerné", virtual: true },
	{ key: "channel.invocation", label: "Salon d'invocation", virtual: true },
	{ key: "channel.ticket", label: "Salon du ticket", virtual: true },
];

const VIRTUAL_CHANNEL_KEYS = new Set(["channel.dm", "channel.invocation", "channel.ticket"]);

export function Messages() {
	const { data, isLoading } = useQuery({
		queryKey: ["messages"],
		queryFn: () => api.get<{ events: EventEntry[] }>("/messages"),
	});
	const [selected, setSelected] = useState<string | null>(null);

	useEffect(() => {
		if (!selected && data?.events[0]) setSelected(data.events[0].event);
	}, [data, selected]);

	if (isLoading) return <div className="text-zinc-500">Chargement en cours…</div>;

	const events = data?.events ?? [];
	const current = events.find((e) => e.event === selected);

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<MessageSquare className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Messages événementiels</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Configure le contenu et le salon de chaque message envoyé automatiquement par le bot.
					Variables disponibles affichées par événement. Les surcharges sont rechargées sous 30
					secondes côté bot (ou immédiatement après modification).
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<div className="card lg:col-span-1">
					<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
						Événements ({events.length})
					</h3>
					<div className="space-y-1">
						{events.map((e) => (
							<button
								key={e.event}
								type="button"
								onClick={() => setSelected(e.event)}
								className={`flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm transition-colors ${
									selected === e.event
										? "bg-brand-500/10 text-brand-400"
										: "hover:bg-zinc-800 text-zinc-300"
								}`}
							>
								<div className="flex-1">
									<code className="font-mono text-xs">{e.event}</code>
									<p className="mt-0.5 text-xs text-zinc-500">{e.description}</p>
								</div>
								<div className="flex flex-col items-end gap-0.5">
									{e.isCustom && <span className="badge badge-warning">surchargé</span>}
									{!e.enabled && <span className="badge badge-error">désactivé</span>}
								</div>
							</button>
						))}
					</div>
				</div>

				<div className="lg:col-span-2">{current ? <EventEditor entry={current} /> : null}</div>
			</div>
		</div>
	);
}

function EventEditor({ entry }: { entry: EventEntry }) {
	const qc = useQueryClient();
	const [template, setTemplate] = useState(entry.template);
	const [channelKey, setChannelKey] = useState(entry.channelKey);
	const [enabled, setEnabled] = useState(entry.enabled);
	const [previewVars, setPreviewVars] = useState<Record<string, string>>(() =>
		Object.fromEntries(entry.variables.map((v) => [v.name, defaultPreviewValue(v.name)]))
	);
	const [previewResult, setPreviewResult] = useState<string | null>(null);

	useEffect(() => {
		setTemplate(entry.template);
		setChannelKey(entry.channelKey);
		setEnabled(entry.enabled);
		setPreviewVars(
			Object.fromEntries(entry.variables.map((v) => [v.name, defaultPreviewValue(v.name)]))
		);
		setPreviewResult(null);
	}, [entry]);

	const save = useMutation({
		mutationFn: () =>
			api.post(`/messages/${entry.event}`, {
				template: template === entry.defaultTemplate ? null : template,
				channelKey: channelKey === entry.defaultChannelKey ? null : channelKey,
				enabled,
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
	});

	const reset = useMutation({
		mutationFn: () => api.delete(`/messages/${entry.event}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
	});

	const preview = useMutation({
		mutationFn: () =>
			api.post<{ rendered: string }>(`/messages/${entry.event}/preview`, previewVars),
		onSuccess: (data) => setPreviewResult(data.rendered),
		onError: (err) =>
			setPreviewResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
	});

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="mb-3 flex items-center justify-between">
					<div>
						<code className="font-mono text-sm font-semibold text-brand-400">{entry.event}</code>
						<p className="mt-0.5 text-xs text-zinc-400">{entry.description}</p>
						{entry.embed && <span className="badge mt-1">Rendu en embed</span>}
					</div>
					<button
						type="button"
						onClick={() => setEnabled(!enabled)}
						className={`btn ${enabled ? "btn-primary" : "btn-ghost"}`}
					>
						<Power className="h-3 w-3" />
						{enabled ? "Activé" : "Désactivé"}
					</button>
				</div>

				<div className="space-y-3">
					<div>
						<label className="mb-1 block text-xs text-zinc-400">Salon de destination</label>
						<select
							className="input"
							value={channelKey}
							onChange={(e) => setChannelKey(e.target.value)}
						>
							{CHANNEL_KEYS.map((k) => (
								<option key={k.key} value={k.key}>
									{k.label} — {k.key}
								</option>
							))}
						</select>
						<ResolvedChannel channelKey={channelKey} />
						<p className="mt-1 text-xs text-zinc-500">
							Le salon réel est défini dans <code>/settings</code> ou via{" "}
							<code>/config channel</code>. Défaut catalogue :{" "}
							<code>{entry.defaultChannelKey}</code>
						</p>
					</div>

					<div>
						<label className="mb-1 block text-xs text-zinc-400">Template du message</label>
						<textarea
							className="input font-mono text-sm"
							rows={4}
							value={template}
							onChange={(e) => setTemplate(e.target.value)}
						/>
						<p className="mt-1 text-xs text-zinc-500">
							Variables : utilise <code>{"{nom}"}</code> pour insérer une valeur. Les placeholders
							inconnus restent affichés tels quels.
						</p>
					</div>

					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => save.mutate()}
							disabled={save.isPending}
							className="btn btn-primary"
						>
							<Save className="h-3 w-3" />
							{save.isPending ? "Enregistrement…" : "Enregistrer la surcharge"}
						</button>
						{entry.isCustom && (
							<button
								type="button"
								onClick={() => {
									if (confirm(`Supprimer la surcharge pour ${entry.event} ?`)) reset.mutate();
								}}
								disabled={reset.isPending}
								className="btn btn-ghost"
							>
								<RotateCcw className="h-3 w-3" />
								Revenir au défaut
							</button>
						)}
					</div>
				</div>
			</div>

			<div className="card">
				<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
					<Eye className="h-4 w-4" />
					Aperçu avec variables
				</h3>
				<div className="grid gap-3 sm:grid-cols-2">
					{entry.variables.map((v) => (
						<div key={v.name}>
							<label className="mb-1 block text-xs">
								<code className="text-brand-400">{`{${v.name}}`}</code>{" "}
								<span className="text-zinc-500">— {v.description}</span>
							</label>
							<input
								className="input text-xs"
								value={previewVars[v.name] ?? ""}
								onChange={(e) => setPreviewVars({ ...previewVars, [v.name]: e.target.value })}
							/>
						</div>
					))}
				</div>
				<button
					type="button"
					onClick={() => preview.mutate()}
					disabled={preview.isPending}
					className="btn btn-primary mt-3"
				>
					<Eye className="h-3 w-3" />
					{preview.isPending ? "Rendu…" : "Générer l'aperçu"}
				</button>
				{previewResult && (
					<div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
						<p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Aperçu rendu</p>
						<p className="whitespace-pre-wrap text-zinc-100">{previewResult}</p>
					</div>
				)}
			</div>

			<div className="card">
				<h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
					Template par défaut
				</h3>
				<pre className="overflow-x-auto rounded bg-zinc-950 p-3 text-xs text-zinc-400">
					{entry.defaultTemplate}
				</pre>
			</div>
		</div>
	);
}

function ResolvedChannel({ channelKey }: { channelKey: string }) {
	if (VIRTUAL_CHANNEL_KEYS.has(channelKey)) {
		const label = CHANNEL_KEYS.find((k) => k.key === channelKey)?.label ?? channelKey;
		return (
			<p className="mt-1 text-xs text-cyan-400">
				🔗 Cible contextuelle : <strong>{label}</strong>{" "}
				<span className="text-zinc-500">
					— résolu côté bot par le call-site (pas via /settings).
				</span>
			</p>
		);
	}
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
	const value = (settings.data as any)?.rows?.find((s: any) => s.key === channelKey)?.value;
	if (!value) {
		return (
			<p className="mt-1 text-xs text-amber-400">
				⚠ Pas de surcharge dans /settings · le bot tombera sur la valeur par défaut de l'env si elle
				existe.
			</p>
		);
	}
	const c = channels.data?.channels.find((x) => x.id === value);
	return (
		<p className="mt-1 text-xs text-green-400">
			→ {c ? `#${c.name}` : value} <span className="text-zinc-500">({value})</span>
		</p>
	);
}

function defaultPreviewValue(name: string): string {
	switch (name) {
		case "user":
			return "<@123456789>";
		case "userName":
			return "Goku";
		case "userId":
			return "123456789012345678";
		case "guildName":
			return "Dragon Ball FR";
		case "memberCount":
			return "5757";
		case "inviter":
			return "<@987654321>";
		case "level":
			return "5";
		case "xp":
			return "50000";
		case "zeni":
			return "200";
		case "streak":
			return "7";
		case "code":
			return "KAMEHAMEHA";
		case "url":
			return "discord.gg/example";
		case "duration":
			return "24h";
		case "winners":
			return "<@111> <@222>";
		case "prize":
			return "Capsule Hoi-Poi";
		case "title":
			return "Tirage hebdomadaire";
		case "channelId":
			return "111222333";
		case "roleId":
			return "444555666";
		case "zeniBonus":
			return "5000";
		case "description":
			return "Description du succès";
		default:
			return "";
	}
}
