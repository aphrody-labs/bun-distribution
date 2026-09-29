"use client";

import { useState, useTransition } from "react";
import { sfx } from "@/lib/sfx";
import { KiAura, KiShock } from "@/components/games/KiFx";
import fx from "@/components/games/games.module.css";

// Pierre/Feuille/Ciseaux thématisés "techniques de Ki" Dragon Ball.
const CHOICES = [
	{
		value: "pierre",
		label: "Pierre",
		emoji: "🪨",
		ki: "Genki-Dama",
		aura: "blue" as const,
	},
	{
		value: "feuille",
		label: "Feuille",
		emoji: "📄",
		ki: "Kienzan",
		aura: "green" as const,
	},
	{
		value: "ciseaux",
		label: "Ciseaux",
		emoji: "✂️",
		ki: "Kamehameha",
		aura: "orange" as const,
	},
] as const;

type Choice = (typeof CHOICES)[number]["value"];

type ApiResult =
	| {
			ok: true;
			player: Choice;
			bot: Choice;
			result: "win" | "lose" | "draw";
			delta: number;
			balance: number;
	  }
	| { ok: false; error: string };

const RESULT_TEXT = {
	win: {
		label: "VICTOIRE",
		color: "text-green-400",
		border: "border-green-400",
	},
	lose: { label: "DÉFAITE", color: "text-red-400", border: "border-red-400" },
	draw: {
		label: "ÉGALITÉ",
		color: "text-dbz-yellow",
		border: "border-dbz-yellow",
	},
} as const;

export function PfcGame() {
	const [stake, setStake] = useState<string>("");
	const [history, setHistory] = useState<ApiResult[]>([]);
	const [clash, setClash] = useState(0);
	const [pending, startTransition] = useTransition();

	function play(choice: Choice) {
		const parsedStake = stake ? Number(stake) : undefined;
		if (parsedStake !== undefined && (!Number.isFinite(parsedStake) || parsedStake < 1)) {
			setHistory((h) => [{ ok: false, error: "Mise invalide" }, ...h]);
			return;
		}
		sfx.click();
		startTransition(async () => {
			try {
				const res = await fetch("/api/bot-user/games/pfc/play", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ choice, stake: parsedStake }),
				});
				const data = (await res.json()) as ApiResult;
				if (!res.ok && "error" in data === false) {
					setHistory((h) => [{ ok: false, error: `HTTP ${res.status}` }, ...h]);
					return;
				}
				setHistory((h) => [data, ...h.slice(0, 19)]);
				if (data.ok) {
					setClash((c) => c + 1);
					if (data.result === "win") sfx.win();
					else if (data.result === "lose") sfx.lose();
					else sfx.draw();
				}
			} catch (err) {
				setHistory((h) => [
					{ ok: false, error: err instanceof Error ? err.message : "erreur" },
					...h,
				]);
			}
		});
	}

	const last = history[0];
	const lastSuccess = last && last.ok ? last : null;

	return (
		<div className="space-y-6">
			<div className="dbz-panel p-6">
				<label className="block mb-4">
					<span className="font-saiyan uppercase tracking-widest text-sm text-dbz-yellow">
						Mise (optionnelle, en zénis)
					</span>
					<input
						type="number"
						min={1}
						max={1_000_000}
						value={stake}
						onChange={(e) => setStake(e.target.value)}
						placeholder="défaut : 100 z win / 50 z loss"
						className="mt-2 w-full bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-2 font-mono"
						disabled={pending}
					/>
				</label>

				<div className="grid grid-cols-3 gap-3">
					{CHOICES.map((c) => (
						<KiAura
							key={c.value}
							color={c.aura}
							className={`rounded-lg ${pending ? "" : fx.float}`}
						>
							<button
								type="button"
								onClick={() => play(c.value)}
								disabled={pending}
								className="dbz-button !text-base flex flex-col items-center gap-1 py-4 w-full disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<span className="text-3xl">{c.emoji}</span>
								<span>{c.label}</span>
								<span className="font-scouter text-[9px] tracking-[0.2em] opacity-80">{c.ki}</span>
							</button>
						</KiAura>
					))}
				</div>
			</div>

			{lastSuccess && (
				<div
					className={`dbz-panel p-6 border-l-8 relative overflow-hidden ${RESULT_TEXT[lastSuccess.result].border} ${
						lastSuccess.result === "lose" ? fx.shake : ""
					}`}
				>
					{/* Onde de choc du clash de Ki + flash sur victoire */}
					<KiShock
						trigger={clash || null}
						color={
							lastSuccess.result === "win"
								? "green"
								: lastSuccess.result === "lose"
									? "red"
									: "yellow"
						}
						flash={lastSuccess.result === "win"}
					/>
					<div className="flex items-baseline justify-between mb-3 relative z-10">
						<span className={`font-saiyan text-3xl ${RESULT_TEXT[lastSuccess.result].color}`}>
							{RESULT_TEXT[lastSuccess.result].label}
						</span>
						<span className="font-scouter text-xs tracking-widest text-dbz-blue-light">
							Solde : {lastSuccess.balance} z
						</span>
					</div>
					<div
						className={`flex items-center justify-center gap-6 text-5xl py-4 relative z-10 ${fx.impactIn}`}
						key={clash}
					>
						<span>{CHOICES.find((c) => c.value === lastSuccess.player)?.emoji}</span>
						<span className="font-saiyan text-dbz-orange text-2xl ki-pulse">VS</span>
						<span>{CHOICES.find((c) => c.value === lastSuccess.bot)?.emoji}</span>
					</div>
					{lastSuccess.delta !== 0 && (
						<p
							className={`text-center font-saiyan text-xl relative z-10 ${lastSuccess.delta > 0 ? "text-green-400" : "text-red-400"}`}
						>
							{lastSuccess.delta > 0 ? "+" : ""}
							{lastSuccess.delta} z
						</p>
					)}
				</div>
			)}

			{last && !last.ok && (
				<div className="dbz-panel p-4 border-l-8 border-red-400">
					<span className="font-scouter text-xs tracking-widest text-red-400">✗ {last.error}</span>
				</div>
			)}

			{history.length > 1 && (
				<div className="dbz-panel p-4">
					<h3 className="font-saiyan text-sm text-dbz-blue-light mb-2 uppercase tracking-widest">
						Historique
					</h3>
					<ul className="text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
						{history.slice(1).map((h, i) =>
							h.ok ? (
								<li key={i} className="flex gap-3">
									<span className={RESULT_TEXT[h.result].color}>{RESULT_TEXT[h.result].label}</span>
									<span>
										{CHOICES.find((c) => c.value === h.player)?.emoji} vs{" "}
										{CHOICES.find((c) => c.value === h.bot)?.emoji}
									</span>
									{h.delta !== 0 && (
										<span className={h.delta > 0 ? "text-green-400" : "text-red-400"}>
											{h.delta > 0 ? "+" : ""}
											{h.delta} z
										</span>
									)}
								</li>
							) : (
								<li key={i} className="text-red-400">
									✗ {h.error}
								</li>
							)
						)}
					</ul>
				</div>
			)}
		</div>
	);
}
