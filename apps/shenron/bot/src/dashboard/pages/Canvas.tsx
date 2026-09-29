import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, RefreshCw, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../lib/api";

interface CanvasDef {
	id: string;
	name: string;
	description: string;
	url: string;
	params: string[];
}

interface DiscordMember {
	id: string;
	username: string;
	displayName: string;
	avatar: string;
}

const PROFILE_THEMES = ["default", "goku", "vegeta", "kaio", "ssj", "blue", "rose", "ultra"];

/**
 * Les PNG de marque, servis depuis `apps/shenron/bot/assets/marque/` (le bot n'expose en
 * statique que ce qui vit sous `assets/`). Ils sont RÉGÉNÉRÉS depuis la géométrie
 * du Kinto-Un par `bun apps/shenron/site/scripts/genere-icones.ts` — ne pas les retoucher
 * à la main, la prochaine génération écraserait la retouche.
 */
const MARQUE = [
	{
		fichier: "avatar-1024-transparent.png",
		nom: "Avatar (transparent)",
		usage:
			"Avatar de bot ou de serveur. Discord rogne en cercle : sans fond, c'est la silhouette du nuage qui devient l'avatar.",
		sombre: true,
	},
	{
		fichier: "avatar-1024-fond-sombre.png",
		nom: "Avatar (disque plein)",
		usage: "Même dessin sur pastille sombre, si un disque net est préféré.",
		sombre: true,
	},
	{
		fichier: "banniere-960x540.png",
		nom: "Bannière",
		usage: "Bannière de serveur Discord, 960 × 540.",
		sombre: false,
	},
	{
		fichier: "kinto-un-2048.png",
		nom: "Illustration 2048",
		usage: "Le nuage seul, transparent, pour tout usage large.",
		sombre: true,
	},
	{
		fichier: "kinto-un-1024.png",
		nom: "Illustration 1024",
		usage: "La même, plus légère.",
		sombre: true,
	},
	{
		fichier: "emoji-128.png",
		nom: "Émoji 128",
		usage:
			"Émoji personnalisé. Rendu sans les volutes : à 32 px dans un fil, elles ne sont plus que du bruit.",
		sombre: true,
	},
] as const;

/** Galerie de marque : aperçu, poids réel et téléchargement direct. */
function GalerieMarque() {
	return (
		<div className="card">
			<div className="flex items-center gap-2">
				<ImageIcon className="h-5 w-5 text-brand-400" />
				<h2 className="text-lg font-semibold">Galerie de marque</h2>
			</div>
			<p className="mt-1 text-sm text-zinc-400">
				Le Kinto-Un décliné en PNG, prêt à téléverser. Régénérés depuis le SVG par{" "}
				<code>bun apps/shenron/site/scripts/genere-icones.ts</code>.
			</p>
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{MARQUE.map((m) => (
					<figure key={m.fichier} className="rounded-lg border border-zinc-800 p-3">
						{/* Le damier ne sert pas de décor : il rend la transparence visible,
						    sans quoi un PNG à fond transparent et un PNG à fond sombre sont
						    indiscernables sur un dashboard sombre. */}
						<div
							className="flex h-32 items-center justify-center rounded"
							style={
								m.sombre
									? {
											backgroundImage:
												"linear-gradient(45deg,#26262b 25%,transparent 25%),linear-gradient(-45deg,#26262b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#26262b 75%),linear-gradient(-45deg,transparent 75%,#26262b 75%)",
											backgroundSize: "16px 16px",
											backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
										}
									: { background: "#18181b" }
							}
						>
							<img
								src={`/assets/marque/${m.fichier}`}
								alt={m.nom}
								loading="lazy"
								className="max-h-28 max-w-full object-contain"
							/>
						</div>
						<figcaption className="mt-2 space-y-1">
							<div className="text-sm font-semibold text-zinc-200">{m.nom}</div>
							<p className="text-xs leading-relaxed text-zinc-500">{m.usage}</p>
							<a
								href={`/assets/marque/${m.fichier}`}
								download
								className="btn btn-ghost mt-1 inline-flex items-center gap-1.5 text-xs"
							>
								<Download className="h-3.5 w-3.5" />
								{m.fichier}
							</a>
						</figcaption>
					</figure>
				))}
			</div>
		</div>
	);
}

export function CanvasPage() {
	const list = useQuery({
		queryKey: ["canvas", "list"],
		queryFn: () => api.get<{ canvases: CanvasDef[] }>("/canvas/list"),
	});

	const members = useQuery({
		queryKey: ["discord", "members"],
		queryFn: () => api.get<{ members: DiscordMember[] }>("/discord/members?limit=200"),
	});

	const [selected, setSelected] = useState("profile");

	if (list.isLoading) return <div className="text-zinc-500">Chargement en cours…</div>;

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<ImageIcon className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Aperçu des canvases</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Rendu en direct des images générées par le bot via <code>@napi-rs/canvas</code> (Skia
					natif). Les paramètres sont passés en query string ; cache HTTP côté serveur 60 s.
				</p>
			</div>

			<div className="card flex flex-wrap gap-2">
				{list.data?.canvases.map((c) => (
					<button
						key={c.id}
						type="button"
						onClick={() => setSelected(c.id)}
						className={`btn ${selected === c.id ? "btn-primary" : "btn-ghost"}`}
					>
						{c.name}
					</button>
				))}
			</div>

			{list.data?.canvases
				.filter((c) => c.id === selected)
				.map((c) => (
					<CanvasPreview key={c.id} def={c} members={members.data?.members ?? []} />
				))}

			<GalerieMarque />
		</div>
	);
}

function CanvasPreview({ def, members }: { def: CanvasDef; members: DiscordMember[] }) {
	const [params, setParams] = useState<Record<string, string>>(() => initialParams(def, members));
	const [bust, setBust] = useState(0); // cache buster pour forcer reload

	const url = useMemo(() => buildUrl(def, params, bust), [def, params, bust]);

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="card lg:col-span-1 space-y-3">
				<h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Paramètres</h3>
				<p className="text-xs text-zinc-500">{def.description}</p>

				{def.id === "profile" && (
					<>
						<MemberSelect
							label="Joueur"
							value={params.userId ?? ""}
							onChange={(v) => setParams({ ...params, userId: v })}
							members={members}
						/>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">Thème</label>
							<select
								className="input"
								value={params.theme ?? "default"}
								onChange={(e) => setParams({ ...params, theme: e.target.value })}
							>
								{PROFILE_THEMES.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</select>
						</div>
					</>
				)}

				{def.id === "scan" && (
					<MemberSelect
						label="Joueur à scanner"
						value={params.userId ?? ""}
						onChange={(v) => setParams({ ...params, userId: v })}
						members={members}
					/>
				)}

				{def.id === "scouter" && (
					<>
						<MemberSelect
							label="Cible"
							value={params.userId ?? ""}
							onChange={(v) => setParams({ ...params, userId: v })}
							members={members}
						/>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">Type de scouter</label>
							<select
								className="input"
								value={params.type ?? "gay"}
								onChange={(e) => setParams({ ...params, type: e.target.value })}
							>
								<option value="gay">Gaydar de Bulma (rose)</option>
								<option value="raciste">Racism-o-mètre (rouge)</option>
							</select>
						</div>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">
								Pourcentage : {params.pct ?? "50"}
							</label>
							<input
								type="range"
								min="0"
								max="101"
								className="w-full"
								value={params.pct ?? "50"}
								onChange={(e) => setParams({ ...params, pct: e.target.value })}
							/>
						</div>
					</>
				)}

				{def.id === "fusion" && (
					<>
						<MemberSelect
							label="Joueur A"
							value={params.a ?? ""}
							onChange={(v) => setParams({ ...params, a: v })}
							members={members}
						/>
						<MemberSelect
							label="Joueur B"
							value={params.b ?? ""}
							onChange={(v) => setParams({ ...params, b: v })}
							members={members}
						/>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">État</label>
							<select
								className="input"
								value={params.state ?? "success"}
								onChange={(e) => setParams({ ...params, state: e.target.value })}
							>
								<option value="propose">Proposition</option>
								<option value="success">Fusion réussie</option>
							</select>
						</div>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">Nom de fusion</label>
							<input
								className="input"
								value={params.name ?? ""}
								onChange={(e) => setParams({ ...params, name: e.target.value })}
								placeholder="Gokuetto"
							/>
						</div>
					</>
				)}

				{def.id === "leaderboard" && (
					<>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">Métrique</label>
							<select
								className="input"
								value={params.metric ?? "xp"}
								onChange={(e) => setParams({ ...params, metric: e.target.value })}
							>
								<option value="xp">XP</option>
								<option value="zeni">Zénis</option>
							</select>
						</div>
						<div>
							<label className="mb-1 block text-xs text-zinc-400">
								Profondeur : {params.limit ?? "10"}
							</label>
							<input
								type="range"
								min="3"
								max="20"
								className="w-full"
								value={params.limit ?? "10"}
								onChange={(e) => setParams({ ...params, limit: e.target.value })}
							/>
						</div>
					</>
				)}

				<div className="flex gap-2 pt-2">
					<button type="button" onClick={() => setBust(bust + 1)} className="btn btn-ghost">
						<RefreshCw className="h-3 w-3" />
						Régénérer
					</button>
					<a href={url} download={`${def.id}.png`} className="btn btn-ghost">
						<Download className="h-3 w-3" />
						Télécharger
					</a>
				</div>

				<div>
					<label className="mb-1 block text-xs text-zinc-400">URL générée</label>
					<code className="block break-all rounded bg-zinc-950 p-2 text-xs text-zinc-400">
						{url}
					</code>
				</div>
			</div>

			<div className="card lg:col-span-2">
				<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Aperçu</h3>
				<div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
					{paramsValid(def, params) ? (
						<img src={url} alt={def.name} className="max-w-full rounded" loading="lazy" />
					) : (
						<p className="py-12 text-sm italic text-zinc-500">
							Renseigne les paramètres requis pour afficher l'aperçu.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

function MemberSelect({
	label,
	value,
	onChange,
	members,
}: {
	label: string;
	value: string;
	onChange: (id: string) => void;
	members: DiscordMember[];
}) {
	const [search, setSearch] = useState("");
	const filtered = members.filter(
		(m) =>
			!search ||
			m.username.toLowerCase().includes(search.toLowerCase()) ||
			m.displayName.toLowerCase().includes(search.toLowerCase()) ||
			m.id.includes(search)
	);

	return (
		<div>
			<label className="mb-1 block text-xs text-zinc-400">{label}</label>
			<input
				className="input mb-1 text-xs"
				placeholder="Filtrer par pseudo ou ID"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>
			<select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
				<option value="">— sélectionner —</option>
				{filtered.slice(0, 50).map((m) => (
					<option key={m.id} value={m.id}>
						{m.displayName} ({m.id})
					</option>
				))}
			</select>
			{filtered.length > 50 && (
				<p className="mt-1 text-xs text-zinc-500">
					{filtered.length} résultats — affine le filtre.
				</p>
			)}
		</div>
	);
}

function initialParams(def: CanvasDef, members: DiscordMember[]): Record<string, string> {
	const firstMember = members.find((m) => !m.id.startsWith("0"))?.id ?? "";
	switch (def.id) {
		case "profile":
			return { userId: firstMember, theme: "default" };
		case "scan":
			return { userId: firstMember };
		case "scouter":
			return { userId: firstMember, type: "gay", pct: "50" };
		case "fusion":
			return {
				a: members[0]?.id ?? "",
				b: members[1]?.id ?? "",
				state: "success",
				name: "Gokuetto",
			};
		case "leaderboard":
			return { metric: "xp", limit: "10" };
		default:
			return {};
	}
}

function paramsValid(def: CanvasDef, params: Record<string, string>): boolean {
	if (def.id === "profile" || def.id === "scan" || def.id === "scouter") return !!params.userId;
	if (def.id === "fusion") return !!params.a && !!params.b;
	if (def.id === "leaderboard") return true;
	return false;
}

function buildUrl(def: CanvasDef, params: Record<string, string>, bust: number): string {
	const sp = new URLSearchParams();
	let path = "";
	switch (def.id) {
		case "profile":
			path = `/api/canvas/profile/${params.userId ?? ""}`;
			if (params.theme) sp.set("theme", params.theme);
			break;
		case "scan":
			path = `/api/canvas/scan/${params.userId ?? ""}`;
			break;
		case "scouter":
			path = `/api/canvas/scouter/${params.userId ?? ""}`;
			if (params.type) sp.set("type", params.type);
			if (params.pct) sp.set("pct", params.pct);
			break;
		case "fusion":
			path = "/api/canvas/fusion";
			sp.set("a", params.a ?? "");
			sp.set("b", params.b ?? "");
			if (params.state) sp.set("state", params.state);
			if (params.name) sp.set("name", params.name);
			break;
		case "leaderboard":
			path = "/api/canvas/leaderboard";
			if (params.metric) sp.set("metric", params.metric);
			if (params.limit) sp.set("limit", params.limit);
			break;
	}
	if (bust) sp.set("_", String(bust));
	const qs = sp.toString();
	return qs ? `${path}?${qs}` : path;
}
