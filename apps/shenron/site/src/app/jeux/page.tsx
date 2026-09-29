import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ogMeta } from "@/lib/og";

export const metadata: Metadata = {
	title: "Mini-jeux",
	description:
		"Les mini-jeux Dragon Ball du serveur DBFR : 2048 Ki Merge, Pierre-Feuille-Ciseaux, Morpion, Pendu, Bingo et plus.",
	...ogMeta({
		title: "Mini-jeux — DBFR",
		description: "Les mini-jeux Dragon Ball du serveur Discord DBFR.",
		canonical: "/jeux",
	}),
};

// `glow` = rgba de l'aura de Ki au survol ; `power` = niveau de puissance
// scouter affiché sur la carte (flavor Dragon Ball).
const GAMES = [
	{
		name: "2048: Ki Merge",
		cmd: "Nouveau !",
		variant: "solo",
		desc: "Joue au célèbre 2048 version Dragon Ball ! Fusionne tes guerriers jusqu'à Whis pour faire exploser ton compteur de Ki.",
		palette: "text-dbz-orange border-dbz-orange",
		glow: "rgba(255,178,0,0.45)",
		power: "16 384",
		play: "/jeux/2048" as string | null,
	},
	{
		name: "Pendu",
		cmd: "/pendu",
		variant: "solo / joueur",
		desc: "Devine le mot caché, 7 essais. Embed avec lettres trouvées/ratées triées, ASCII frame du pendu, victoire = +100 Ƶ.",
		palette: "text-dbz-yellow border-dbz-yellow",
		glow: "color-mix(in srgb, var(--color-dbz-amber) 45%, transparent)",
		power: "7 essais",
		play: null,
	},
	{
		name: "Morpion",
		cmd: "/morpion",
		variant: "vs IA / vs joueur",
		desc: "Tic-tac-toe 3×3. IA défensive (gagner > bloquer > centre > coin > random). Ligne gagnante surlignée en vert.",
		palette: "text-cyan-400 border-cyan-400",
		glow: "color-mix(in srgb, var(--color-dbz-ki) 45%, transparent)",
		power: "Duel de Ki",
		play: "/jeux/morpion" as string | null,
	},
	{
		name: "PFC",
		cmd: "/pfc",
		variant: "solo / joueur",
		desc: "Pierre Feuille Ciseaux à coups de techniques de Ki. Adversaire IA random ou défi entre membres avec boutons Accepter/Refuser timeout 60s.",
		palette: "text-purple-400 border-purple-400",
		glow: "rgba(192,132,252,0.45)",
		power: "3 techniques",
		play: "/jeux/pfc" as string | null,
	},
	{
		name: "Bingo",
		cmd: "/bingo",
		variant: "vs IA",
		desc: "Capteur de Ki : localise une puissance cachée entre 1 et 100. 10 scans max. Le capteur indique Ki supérieur / inférieur après chaque mesure.",
		palette: "text-dbz-orange border-dbz-orange",
		glow: "rgba(255,178,0,0.45)",
		power: "1 → 100",
		play: "/jeux/bingo" as string | null,
	},
];

export default function JeuxPage() {
	return (
		<PageShell width="narrow">
			{/* Backdrop d'arène : starfield + speed-lines (décor pur) */}
			<div className="relative">
				<div
					className="absolute inset-x-0 -top-8 h-40 speed-lines opacity-30 pointer-events-none"
					aria-hidden
				/>
				<PageHeader
					eyebrow="Arène de combat"
					title="Jeux"
					className="mb-10 relative"
					subtitle="Mise ton ki, encaisse les Zénis."
				/>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{GAMES.map((g) => (
					<article
						key={g.name}
						className={`dbz-panel hud-frame group relative overflow-hidden p-6 flex flex-col border-l-4 ${g.palette} hover:border-dbz-orange transition-colors`}
					>
						{/* Aura de Ki révélée au survol */}
						<div
							className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
							style={{
								background: `radial-gradient(120% 80% at 50% 0%, ${g.glow}, transparent 70%)`,
							}}
							aria-hidden
						/>
						<div className="relative z-10 flex flex-col flex-1">
							<div className="flex items-baseline justify-between mb-1">
								<h2 className={`text-3xl font-saiyan uppercase ${g.palette}`}>{g.name}</h2>
								<code className="text-dbz-orange font-mono">{g.cmd}</code>
							</div>
							<div className="flex items-center gap-3 mb-3">
								<span className="text-[10px] uppercase tracking-widest text-dbz-blue-light">
									Mode : {g.variant}
								</span>
								<span className="scouter-text text-[10px] tracking-widest">⚡ {g.power}</span>
							</div>
							<p className="text-sm text-gray-300 leading-relaxed flex-1">{g.desc}</p>
							{g.play ? (
								<a href={g.play} className="dbz-button mt-4 self-start !text-sm">
									JOUER
								</a>
							) : (
								<span className="mt-4 self-start font-scouter text-[10px] tracking-widest text-dbz-blue-light/60">
									Jouable sur Discord uniquement
								</span>
							)}
						</div>
					</article>
				))}
			</div>

			<section className="mt-10 dbz-panel hud-frame p-6 text-center relative overflow-hidden">
				<div className="absolute inset-0 halftone opacity-20 pointer-events-none" aria-hidden />
				<p className="font-saiyan text-2xl text-dbz-orange uppercase mb-2 relative z-10 ki-pulse">
					Récompenses
				</p>
				<p className="text-sm text-gray-300 relative z-10">
					Victoire : <span className="text-dbz-yellow font-bold">+100 Ƶ</span> · Défaite :{" "}
					<span className="text-red-400 font-bold">−50 Ƶ</span>
				</p>
			</section>
		</PageShell>
	);
}
