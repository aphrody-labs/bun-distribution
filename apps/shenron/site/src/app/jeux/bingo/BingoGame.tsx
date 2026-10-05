"use client";

import { useState, useTransition } from "react";
import { sfx } from "@/lib/sfx";
import { KiShock, KiReactor } from "@/components/games/KiFx";
import fx from "@/components/games/games.module.css";

type SessionStart = {
	token: string;
	ts: number;
	attempts: number;
	max: number;
	min: number;
};
type SessionContinue = {
	hint: "higher" | "lower";
	attempts: number;
	token: string;
	ts: number;
};
type SessionEnd = {
	hint: "match" | "lost";
	target: number;
	attempts: number;
	delta: number;
	balance: number;
};
type ApiError = { error: string };
type Reply = SessionStart | SessionContinue | SessionEnd | ApiError;

type Attempt = {
	guess: number;
	hint: "higher" | "lower" | "match" | "lost";
};

// Capteur de Ki : "plus haut" = la cible a un Ki supérieur (signal monte).
const HINT_LABEL = {
	higher: { txt: "↑ KI SUPÉRIEUR", color: "text-cyan-400" },
	lower: { txt: "↓ KI INFÉRIEUR", color: "text-purple-400" },
	match: { txt: "🎯 KI VERROUILLÉ", color: "text-green-400" },
	lost: { txt: "✗ HORS PORTÉE", color: "text-red-400" },
} as const;

export function BingoGame() {
	const [stake, setStake] = useState("");
	const [token, setToken] = useState<string | null>(null);
	const [guess, setGuess] = useState("");
	const [attempts, setAttempts] = useState<Attempt[]>([]);
	const [ended, setEnded] = useState<SessionEnd | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [scanPulse, setScanPulse] = useState(0);
	const [pending, startTransition] = useTransition();

	async function call(payload: { token?: string; guess?: number; stake?: number }): Promise<Reply> {
		const res = await fetch("/api/bot-user/games/bingo/play", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		return (await res.json()) as Reply;
	}

	function reset() {
		setToken(null);
		setAttempts([]);
		setEnded(null);
		setError(null);
		setGuess("");
	}

	function startNew() {
		const parsedStake = stake ? Number(stake) : undefined;
		if (parsedStake !== undefined && (!Number.isFinite(parsedStake) || parsedStake < 1)) {
			setError("Mise invalide");
			return;
		}
		startTransition(async () => {
			const reply = await call({ stake: parsedStake });
			if ("error" in reply) {
				setError(reply.error);
				return;
			}
			if ("token" in reply && "max" in reply) {
				reset();
				setToken(reply.token);
			}
		});
	}

	function submitGuess() {
		if (!token) return;
		const g = Number(guess);
		if (!Number.isInteger(g) || g < 1 || g > 100) {
			setError("Entre 1 et 100");
			return;
		}
		sfx.click();
		startTransition(async () => {
			const reply = await call({ token, guess: g });
			if ("error" in reply) {
				setError(reply.error);
				return;
			}
			setError(null);
			setGuess("");
			setScanPulse((p) => p + 1);
			if ("target" in reply) {
				setAttempts((a) => [...a, { guess: g, hint: reply.hint }]);
				setEnded(reply);
				setToken(null);
				if (reply.hint === "match") sfx.win();
				else sfx.lose();
				return;
			}
			if ("hint" in reply && "token" in reply) {
				setAttempts((a) => [...a, { guess: g, hint: reply.hint }]);
				setToken(reply.token);
			}
		});
	}

	// Dernier signal capté → couleur du réacteur de Ki.
	const lastHint = attempts[attempts.length - 1]?.hint;
	const reactorColor = lastHint === "higher" ? "blue" : lastHint === "lower" ? "purple" : "orange";

	return (
		<div className="space-y-6">
			{!token && !ended && (
				<div className="dbz-panel p-6 space-y-4 hud-frame">
					<p className="text-center font-scouter text-[10px] tracking-[0.3em] text-dbz-blue-light/70 uppercase">
						Capteur de Ki · localise une puissance cachée (1-100)
					</p>
					<label className="block">
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
					<button
						type="button"
						onClick={startNew}
						disabled={pending}
						className="dbz-button w-full disabled:opacity-40"
					>
						{pending ? "…" : "CALIBRER LE CAPTEUR"}
					</button>
				</div>
			)}

			{token && !ended && (
				<div
					className={`dbz-panel p-6 space-y-4 relative overflow-hidden hud-frame ${fx.scanSweep}`}
				>
					{/* Onde de scan à chaque mesure de Ki */}
					<KiShock trigger={scanPulse || null} color={reactorColor} />
					<div className="flex items-center justify-center gap-4">
						<KiReactor color={reactorColor} active={pending} className="w-12 h-12" />
						<div className="text-center">
							<div className="font-scouter text-xs tracking-widest text-dbz-blue-light/70 mb-0.5">
								SCANS // {attempts.length} / 10
							</div>
							<div className="font-scouter text-[10px] tracking-widest uppercase">
								{lastHint ? (
									<span className={HINT_LABEL[lastHint].color}>{HINT_LABEL[lastHint].txt}</span>
								) : (
									<span className="text-dbz-orange/70">Aucun signal · lance un scan</span>
								)}
							</div>
						</div>
					</div>
					<div className="flex justify-center gap-1">
						{Array.from({ length: 10 }, (_, i) => (
							<div
								key={i}
								className={`w-4 h-4 border transition-all ${
									i < attempts.length
										? "border-dbz-orange bg-dbz-orange shadow-[0_0_8px_var(--color-dbz-orange)]"
										: "border-dbz-border"
								}`}
							/>
						))}
					</div>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							submitGuess();
						}}
						className="flex gap-2 relative z-10"
					>
						<input
							type="number"
							min={1}
							max={100}
							value={guess}
							onChange={(e) => setGuess(e.target.value)}
							
							aria-label="Puissance estimée, de 1 à 100"
							placeholder="Puissance estimée 1-100"
							className="flex-1 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-3 font-mono text-xl text-center"
							disabled={pending}
						/>
						<button
							type="submit"
							disabled={pending || !guess}
							className="dbz-button !text-base disabled:opacity-40"
						>
							SCAN
						</button>
					</form>
				</div>
			)}

			{ended && (
				<div
					className={`dbz-panel p-5 border-l-8 relative overflow-hidden ${ended.hint === "match" ? "border-green-400" : `border-red-400 ${fx.shake}`}`}
				>
					{/* Verrouillage de Ki réussi → flash vert ; signal perdu → shake */}
					<KiShock
						trigger={ended.hint === "match" ? `win-${ended.target}` : null}
						color="green"
						flash
					/>
					<div className="flex items-baseline justify-between mb-2 relative z-10">
						<span
							className={`font-saiyan text-3xl ${ended.hint === "match" ? "text-green-400" : "text-red-400"}`}
						>
							{ended.hint === "match" ? "KI VERROUILLÉ" : "SIGNAL PERDU"}
						</span>
						<span className="font-scouter text-xs tracking-widest text-dbz-blue-light">
							Solde : {ended.balance} z
						</span>
					</div>
					<p className="font-mono text-sm text-dbz-blue-light relative z-10">
						Puissance cible :{" "}
						<span className="text-dbz-yellow font-bold text-lg">{ended.target}</span> · localisée en{" "}
						{ended.attempts} scan
						{ended.attempts > 1 ? "s" : ""}
					</p>
					{ended.delta !== 0 && (
						<p
							className={`font-saiyan text-xl mt-2 relative z-10 ${ended.delta > 0 ? "text-green-400" : "text-red-400"}`}
						>
							{ended.delta > 0 ? "+" : ""}
							{ended.delta} z
						</p>
					)}
					<button type="button" onClick={reset} className="dbz-button mt-4 !text-sm relative z-10">
						REJOUER
					</button>
				</div>
			)}

			{attempts.length > 0 && (
				<div className="dbz-panel p-4">
					<h3 className="font-saiyan text-sm text-dbz-blue-light mb-2 uppercase tracking-widest">
						Journal des scans
					</h3>
					<ul className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
						{attempts.map((a, i) => (
							<li key={i} className="flex gap-3 items-center">
								<span className="text-dbz-blue-light/70 w-6">#{i + 1}</span>
								<span className="text-dbz-yellow font-bold w-10 text-right">{a.guess}</span>
								<span className={HINT_LABEL[a.hint].color}>{HINT_LABEL[a.hint].txt}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{error && (
				<div className="dbz-panel p-4 border-l-8 border-red-400">
					<span className="font-scouter text-xs tracking-widest text-red-400">✗ {error}</span>
				</div>
			)}
		</div>
	);
}
