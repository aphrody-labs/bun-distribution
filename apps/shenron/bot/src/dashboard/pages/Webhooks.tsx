import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Trash2, Webhook as WebhookIcon, Copy, Check } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../lib/api";

interface Channel {
	id: string;
	name: string;
	type: number;
	parentId: string | null;
}

interface Webhook {
	id: string;
	name: string | null;
	channel_id: string | null;
	avatar: string | null;
	token?: string;
	url?: string;
	user?: { id: string; username: string; avatar: string | null };
}

export function Webhooks() {
	const qc = useQueryClient();
	const [filterChannel, setFilterChannel] = useState<string>("");

	const channels = useQuery({
		queryKey: ["discord", "channels"],
		queryFn: () => api.get<{ channels: Channel[] }>("/discord/channels"),
	});

	const webhooks = useQuery({
		queryKey: ["webhooks", filterChannel],
		queryFn: () =>
			api.get<{ webhooks: Webhook[] }>(
				filterChannel ? `/webhooks?channel_id=${filterChannel}` : "/webhooks"
			),
	});

	const create = useMutation({
		mutationFn: (data: { channel_id: string; name: string }) =>
			api.post<{ webhook: Webhook }>("/webhooks/create", data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
	});

	const remove = useMutation({
		mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
	});

	const textChannels = useMemo(
		() => (channels.data?.channels ?? []).filter((c) => c.type === 0 || c.type === 5),
		[channels.data]
	);

	const [createForm, setCreateForm] = useState({ channel_id: "", name: "" });
	const [executing, setExecuting] = useState<Webhook | null>(null);

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<WebhookIcon className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Webhooks Discord</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Gestion des webhooks de la guild via REST Discord. Lecture, création, suppression et
					exécution (envoi de message) sans démarrer le client bot.
				</p>
			</div>

			<div className="card flex flex-wrap items-end gap-3">
				<div className="flex-1 min-w-[200px]">
					<label className="mb-1 block text-xs text-zinc-400">Filtrer par salon</label>
					<select
						className="input"
						value={filterChannel}
						onChange={(e) => setFilterChannel(e.target.value)}
					>
						<option value="">Tous les salons de la guild</option>
						{textChannels.map((c) => (
							<option key={c.id} value={c.id}>
								#{c.name}
							</option>
						))}
					</select>
				</div>
			</div>

			<form
				onSubmit={(e: FormEvent) => {
					e.preventDefault();
					if (!createForm.channel_id || !createForm.name) return;
					create.mutate(createForm);
					setCreateForm({ channel_id: "", name: "" });
				}}
				className="card grid gap-3 sm:grid-cols-3"
			>
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Salon cible</label>
					<select
						className="input"
						value={createForm.channel_id}
						onChange={(e) => setCreateForm({ ...createForm, channel_id: e.target.value })}
						required
					>
						<option value="">— Choisir un salon —</option>
						{textChannels.map((c) => (
							<option key={c.id} value={c.id}>
								#{c.name}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="mb-1 block text-xs text-zinc-400">Nom</label>
					<input
						className="input"
						value={createForm.name}
						onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
						placeholder="Mon webhook"
						maxLength={80}
						required
					/>
				</div>
				<button
					type="submit"
					disabled={create.isPending || !createForm.channel_id || !createForm.name}
					className="btn btn-primary self-end"
				>
					<Plus className="h-3 w-3" />
					{create.isPending ? "Création…" : "Créer le webhook"}
				</button>
			</form>

			<div className="card overflow-x-auto p-0">
				<table className="w-full text-sm">
					<thead className="border-b border-zinc-800 bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
						<tr>
							<th className="px-3 py-2 text-left">Nom</th>
							<th className="px-3 py-2 text-left">Salon</th>
							<th className="px-3 py-2 text-left">ID</th>
							<th className="px-3 py-2 text-left">URL</th>
							<th className="px-3 py-2 text-right">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-800">
						{webhooks.data?.webhooks.map((w) => {
							const chan = textChannels.find((c) => c.id === w.channel_id);
							return (
								<tr key={w.id} className="hover:bg-zinc-900/30">
									<td className="px-3 py-2">{w.name ?? "(sans nom)"}</td>
									<td className="px-3 py-2 text-zinc-400">
										{chan ? `#${chan.name}` : w.channel_id}
									</td>
									<td className="px-3 py-2 font-mono text-xs text-zinc-500">{w.id}</td>
									<td className="px-3 py-2">
										<CopyUrl url={w.url ?? ""} />
									</td>
									<td className="px-3 py-2 text-right">
										<div className="flex justify-end gap-1">
											<button
												type="button"
												onClick={() => setExecuting(w)}
												disabled={!w.url}
												className="btn btn-ghost px-2"
												title="Envoyer un message"
											>
												<Send className="h-3 w-3" />
											</button>
											<button
												type="button"
												onClick={() => {
													if (confirm(`Supprimer le webhook "${w.name}" ?`)) remove.mutate(w.id);
												}}
												className="btn btn-ghost px-2 text-red-400"
											>
												<Trash2 className="h-3 w-3" />
											</button>
										</div>
									</td>
								</tr>
							);
						})}
						{webhooks.data?.webhooks.length === 0 && (
							<tr>
								<td colSpan={5} className="p-6 text-center text-sm text-zinc-500">
									Aucun webhook trouvé.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{executing && executing.url && (
				<ExecuteModal webhook={executing} onClose={() => setExecuting(null)} />
			)}
		</div>
	);
}

function CopyUrl({ url }: { url: string }) {
	const [copied, setCopied] = useState(false);
	if (!url) return <span className="text-xs text-zinc-600">—</span>;
	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(url);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
			className="flex items-center gap-1 text-xs text-zinc-400 hover:text-brand-400"
			title="Copier l'URL"
		>
			{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
			<span className="font-mono">{url.slice(0, 50)}…</span>
		</button>
	);
}

function ExecuteModal({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
	const [content, setContent] = useState("");
	const [username, setUsername] = useState(webhook.name ?? "");
	const [avatarUrl, setAvatarUrl] = useState("");
	const [embedTitle, setEmbedTitle] = useState("");
	const [embedDesc, setEmbedDesc] = useState("");
	const [embedColor, setEmbedColor] = useState("#eab308");
	const [result, setResult] = useState<string | null>(null);

	const send = useMutation({
		mutationFn: async () => {
			const payload: Record<string, unknown> = { url: webhook.url, wait: true };
			if (content) payload.content = content;
			if (username) payload.username = username;
			if (avatarUrl) payload.avatar_url = avatarUrl;
			if (embedTitle || embedDesc) {
				payload.embeds = [
					{
						title: embedTitle || undefined,
						description: embedDesc || undefined,
						color: parseInt(embedColor.replace("#", ""), 16),
						timestamp: new Date().toISOString(),
					},
				];
			}
			return api.post("/webhooks/execute", payload);
		},
		onSuccess: () => setResult("✓ Message envoyé"),
		onError: (err) => setResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
	});

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
			<div className="card max-h-[85vh] w-full max-w-2xl overflow-y-auto">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-lg font-semibold">Envoyer via {webhook.name}</h3>
					<button type="button" onClick={onClose} className="btn btn-ghost px-2">
						✕
					</button>
				</div>

				<div className="space-y-3">
					<div className="grid gap-3 sm:grid-cols-2">
						<div>
							<label className="mb-1 block text-xs text-zinc-400">Username override</label>
							<input
								className="input"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								maxLength={80}
							/>
						</div>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">Avatar URL override</label>
							<input
								className="input"
								value={avatarUrl}
								onChange={(e) => setAvatarUrl(e.target.value)}
								placeholder="https://…"
							/>
						</div>
					</div>

					<div>
						<label className="mb-1 block text-xs text-zinc-400">
							Contenu (texte, ≤ 2000 caractères)
						</label>
						<textarea
							className="input"
							rows={3}
							value={content}
							onChange={(e) => setContent(e.target.value)}
							maxLength={2000}
							placeholder="Message…"
						/>
					</div>

					<fieldset className="space-y-2 rounded-lg border border-zinc-800 p-3">
						<legend className="px-2 text-xs uppercase tracking-wide text-zinc-500">
							Embed (optionnel)
						</legend>
						<input
							className="input"
							value={embedTitle}
							onChange={(e) => setEmbedTitle(e.target.value)}
							placeholder="Titre de l'embed"
							maxLength={256}
						/>
						<textarea
							className="input"
							rows={2}
							value={embedDesc}
							onChange={(e) => setEmbedDesc(e.target.value)}
							placeholder="Description de l'embed"
							maxLength={4096}
						/>
						<div className="flex items-center gap-2">
							<label className="text-xs text-zinc-400">Couleur</label>
							<input
								type="color"
								value={embedColor}
								onChange={(e) => setEmbedColor(e.target.value)}
								className="h-8 w-16 rounded border border-zinc-800 bg-zinc-900"
							/>
							<span className="font-mono text-xs text-zinc-500">{embedColor}</span>
						</div>
					</fieldset>

					{result && (
						<div
							className={`rounded p-2 text-xs ${
								result.startsWith("✓")
									? "bg-green-900/20 text-green-400"
									: "bg-red-900/20 text-red-400"
							}`}
						>
							{result}
						</div>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<button type="button" onClick={onClose} className="btn btn-ghost">
							Annuler
						</button>
						<button
							type="button"
							onClick={() => send.mutate()}
							disabled={send.isPending || (!content && !embedTitle && !embedDesc)}
							className="btn btn-primary"
						>
							<Send className="h-3 w-3" />
							{send.isPending ? "Envoi…" : "Envoyer le message"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
