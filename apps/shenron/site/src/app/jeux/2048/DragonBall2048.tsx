"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { DBZ_TILES } from "./tiles";
import { assetUrl } from "@/lib/assets";
import { sfx } from "@/lib/sfx";
import { KiShock, PowerLevel } from "@/components/games/KiFx";
import fx from "@/components/games/games.module.css";

type Tile = {
	id: number;
	value: number;
	x: number;
	y: number;
	isNew: boolean;
	isMerged: boolean;
};

const GRID_SIZE = 4;

function generateId() {
	return Math.random() * 1000000;
}

export default function DragonBall2048() {
	const [tiles, setTiles] = useState<Tile[]>([]);
	const [score, setScore] = useState(0);
	const [gameOver, setGameOver] = useState(false);
	// FX : pulse d'onde de choc à chaque fusion, flash + speed-lines sur record.
	const [mergePulse, setMergePulse] = useState(0);
	const [ascendFlash, setAscendFlash] = useState(0);
	const [showSpeed, setShowSpeed] = useState(false);
	const bestTile = useRef(2);

	const initializeGame = useCallback(() => {
		// Deux cases DISTINCTES : deux tirages indépendants superposaient les tuiles
		// de départ une partie sur seize, et le plateau démarrait alors avec une
		// seule case visible.
		const libres = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => i);
		const depart = [0, 0].map(
			() => libres.splice(Math.floor(Math.random() * libres.length), 1)[0]!
		);
		setTiles(
			depart.map((c) => ({
				id: generateId(),
				value: 2,
				x: c % GRID_SIZE,
				y: Math.floor(c / GRID_SIZE),
				isNew: true,
				isMerged: false,
			}))
		);
		setScore(0);
		setGameOver(false);
		setShowSpeed(false);
		bestTile.current = 2;
	}, []);

	useEffect(() => {
		initializeGame();
	}, [initializeGame]);

	// Basic 2048 logic
	const move = useCallback(
		(direction: "UP" | "DOWN" | "LEFT" | "RIGHT") => {
			if (gameOver) return;

			setTiles((prevTiles) => {
				let newTiles = [...prevTiles].map((t) => (Object.assign(t, {
	isNew: false,
	isMerged: false
})));
				// Tuiles SURVIVANTES du coup : une tuile absorbée par une fusion doit
				// disparaître du plateau. `newTiles` la gardait (seule la ligne fusionnée
				// était reconstruite), donc chaque fusion laissait un fantôme à l'ancienne
				// place — le plateau se remplissait de doublons dès le premier coup.
				const survivants: Tile[] = [];
				let hasMoved = false;
				let didMerge = false;
				let topValue = 0;
				let currentScore = score;

				const moveInLine = (line: Tile[]) => {
					let result: Tile[] = [];
					for (let i = 0; i < line.length; i++) {
						if (line[i]) {
							if (
								result.length > 0 &&
								result[result.length - 1].value === line[i].value &&
								!result[result.length - 1].isMerged
							) {
								result[result.length - 1].value *= 2;
								result[result.length - 1].isMerged = true;
								currentScore += result[result.length - 1].value;
								hasMoved = true;
								didMerge = true;
								if (result[result.length - 1].value > topValue)
									topValue = result[result.length - 1].value;
							} else {
								result.push(line[i]);
							}
						}
					}
					return result;
				};

				for (let i = 0; i < GRID_SIZE; i++) {
					let line = newTiles.filter((t) =>
						direction === "UP" || direction === "DOWN" ? t.x === i : t.y === i
					);
					line.sort((a, b) => (direction === "UP" || direction === "DOWN" ? a.y - b.y : a.x - b.x));
					if (direction === "DOWN" || direction === "RIGHT") line.reverse();

					const mergedLine = moveInLine(line);

					for (let j = 0; j < mergedLine.length; j++) {
						const targetPos = direction === "DOWN" || direction === "RIGHT" ? GRID_SIZE - 1 - j : j;
						if (direction === "UP" || direction === "DOWN") {
							if (mergedLine[j].y !== targetPos) hasMoved = true;
							mergedLine[j].y = targetPos;
						} else {
							if (mergedLine[j].x !== targetPos) hasMoved = true;
							mergedLine[j].x = targetPos;
						}
					}
					survivants.push(...mergedLine);
				}

				if (hasMoved) {
					// Add new tile
					const emptySpots = [];
					for (let x = 0; x < GRID_SIZE; x++) {
						for (let y = 0; y < GRID_SIZE; y++) {
							if (!survivants.some((t) => t.x === x && t.y === y)) emptySpots.push({ x, y });
						}
					}
					if (emptySpots.length > 0) {
						const randomSpot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
						survivants.push({
							id: generateId(),
							value: Math.random() < 0.9 ? 2 : 4,
							x: randomSpot.x,
							y: randomSpot.y,
							isNew: true,
							isMerged: false,
						});
					}
					setScore(currentScore);

					// FX déférés (hors render strict-mode) : onde de choc + son de
					// fusion ; flash + speed-lines + son de victoire sur nouveau record.
					const ascended = topValue > bestTile.current;
					if (topValue > bestTile.current) bestTile.current = topValue;
					setTimeout(() => {
						if (didMerge) {
							setMergePulse((p) => p + 1);
							if (ascended) {
								setAscendFlash((p) => p + 1);
								setShowSpeed(true);
								setTimeout(() => setShowSpeed(false), 700);
								sfx.win();
							} else {
								sfx.click();
							}
						}
					}, 0);
				}

				return survivants;
			});
		},
		[gameOver, score]
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
			// L'écoute est posée sur `window` : sans ce filtre, le jeu confisquait les
			// flèches à tout champ de saisie de la page (et les raccourcis du
			// navigateur), curseur bloqué au milieu d'un mot.
			if (e.altKey || e.ctrlKey || e.metaKey) return;
			const cible = e.target as HTMLElement | null;
			if (cible?.isContentEditable) return;
			if (cible && ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName)) return;
			e.preventDefault();
			if (e.key === "ArrowUp") move("UP");
			if (e.key === "ArrowDown") move("DOWN");
			if (e.key === "ArrowLeft") move("LEFT");
			if (e.key === "ArrowRight") move("RIGHT");
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [move]);

	// Touch/Swipe support
	const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

	const handleTouchStart = (e: React.TouchEvent) => {
		setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
	};

	const handleTouchEnd = (e: React.TouchEvent) => {
		if (!touchStart) return;
		const touchEnd = {
			x: e.changedTouches[0].clientX,
			y: e.changedTouches[0].clientY,
		};
		const dx = touchEnd.x - touchStart.x;
		const dy = touchEnd.y - touchStart.y;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		if (Math.max(absDx, absDy) > 30) {
			if (absDx > absDy) {
				move(dx > 0 ? "RIGHT" : "LEFT");
			} else {
				move(dy > 0 ? "DOWN" : "UP");
			}
		}
		setTouchStart(null);
	};

	// Simple check for game over
	useEffect(() => {
		if (gameOver) return;
		if (tiles.length === GRID_SIZE * GRID_SIZE) {
			const canMove = tiles.some((t) => {
				const neighbors = tiles.filter(
					(n) =>
						(Math.abs(n.x - t.x) === 1 && n.y === t.y) || (Math.abs(n.y - t.y) === 1 && n.x === t.x)
				);
				return neighbors.some((n) => n.value === t.value);
			});
			if (!canMove) {
				setGameOver(true);
				sfx.lose();
			}
		}
	}, [tiles, gameOver]);

	// Tuile la plus puissante du plateau (pour l'aura de Ki renforcée).
	const maxValue = tiles.reduce((m, t) => Math.max(m, t.value), 0);

	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-white font-sans">
			<div className="flex items-center justify-between w-full max-w-md mb-8">
				<h1 className="text-5xl font-saiyan text-dbz-yellow tracking-widest drop-shadow-lg">
					DBZ 2048
				</h1>
				<PowerLevel
					value={score}
					label="Ki total"
					className="dbz-panel border border-dbz-orange/50"
				/>
			</div>

			{/* Le balayage n'est écouté que SUR le plateau : posé sur l'enveloppe (haute
			    de 60vh, titre et consignes compris), un simple défilement de la page vers
			    le bas jouait un coup. `touch-action: none` évite en plus que le même
			    geste fasse défiler la page ET joue le coup. */}
			<div
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
				style={{ touchAction: "none" }}
				className="relative bg-zinc-900/80 p-3 rounded-xl border-4 border-dbz-border shadow-2xl backdrop-blur-sm w-full max-w-md aspect-square hud-frame"
			>
				{/* Speed-lines d'énergie quand une nouvelle transformation est atteinte */}
				{showSpeed && (
					<div
						className="absolute inset-0 speed-lines z-30 pointer-events-none rounded-lg"
						aria-hidden
					/>
				)}
				{/* Onde de choc de fusion + flash d'ascension */}
				<KiShock trigger={mergePulse || null} color="yellow" />
				{ascendFlash > 0 && <KiShock trigger={ascendFlash} color="yellow" flash />}

				<div className="grid grid-cols-4 grid-rows-4 gap-3 w-full h-full">
					{Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => (
						<div key={i} className="w-full h-full bg-zinc-800/50 rounded-lg shadow-inner" />
					))}
				</div>

				{tiles.map((tile) => {
					const tileInfo = DBZ_TILES[tile.value] || DBZ_TILES[16384];
					const isTop = tile.value === maxValue && maxValue >= 8;
					// Aura de Ki : glow renforcé sur la tuile la plus puissante et
					// pendant la fusion (montée d'énergie).
					const glow =
						tile.isMerged || isTop
							? `0 0 18px ${tileInfo.color}, 0 0 36px ${tileInfo.color}80`
							: `0 0 10px ${tileInfo.color}40`;
					return (
						<div
							key={tile.id}
							className="absolute transition-all duration-150 ease-in-out"
							style={{
								width: "calc((100% - 2.25rem) / 4)",
								height: "calc((100% - 2.25rem) / 4)",
								transform: `translate(calc(${tile.x * 100}% + ${tile.x * 0.75}rem), calc(${tile.y * 100}% + ${tile.y * 0.75}rem))`,
								top: "0.75rem",
								left: "0.75rem",
								margin: 0,
							}}
						>
							{/* Deux couches à dessein : la POSITION vit sur l'enveloppe, les
							    animations sur la boîte intérieure. Une déclaration d'animation
							    l'emporte sur l'attribut `style` (cascade CSS) : posées sur la
							    même boîte que `transform: translate(...)`, `reveal-scale` et
							    `ki-pulse` — qui écrivent toutes deux `transform: scale(...)` —
							    EFFAÇAIENT le placement. Mesuré au navigateur : une boîte à
							    `translate(200%, 100%)` était rendue à x=8 au lieu de x=208.
							    Conséquences : la tuile qui venait d'apparaître se dessinait sur
							    la case du coin haut-gauche et y restait (`forwards`) jusqu'au
							    coup suivant, une fusion y sautait 300 ms, et la tuile la plus
							    forte (`ki-pulse` infini) y était collée toute la partie. */}
							<div
								className={`w-full h-full rounded-lg flex flex-col items-center justify-center ${
									tile.isNew ? "animate-[reveal-scale_0.2s_ease-out]" : ""
								} ${tile.isMerged ? "animate-[ki-pulse_0.3s_ease-out]" : ""} ${
									isTop ? "ki-pulse" : ""
								}`}
								style={{
									backgroundColor: tileInfo.bg,
									border: `2px solid ${tileInfo.color}`,
									boxShadow: glow,
								}}
							>
								<div className="relative w-full h-full p-1 overflow-hidden group">
									<img
										src={assetUrl(tileInfo.image)}
										alt={tileInfo.name}
										className="w-full h-full object-contain drop-shadow-md z-10 relative opacity-90"
									/>
									<div className="absolute bottom-0 left-0 right-0 bg-black/60 z-20">
										<p
											className="text-[9px] sm:text-[11px] font-bold text-center text-white truncate px-1 font-display uppercase tracking-wider"
											style={{ color: tileInfo.color }}
										>
											{tileInfo.name}
										</p>
									</div>
									{/* Power level scouter (la valeur = niveau de puissance) */}
									<div className="absolute top-1 left-1 bg-black/80 px-1 rounded z-20">
										<p className="scouter-text text-[10px]">{tile.value}</p>
									</div>
								</div>
							</div>
						</div>
					);
				})}

				{gameOver && (
					<div
						className={`absolute inset-0 bg-black/85 backdrop-blur-md rounded-lg flex flex-col items-center justify-center z-50 ${fx.shake}`}
					>
						<div className="font-scouter text-[10px] tracking-[0.35em] text-red-400/80 uppercase mb-1">
							Signal de Ki perdu
						</div>
						<h2 className="text-6xl font-saiyan text-red-500 mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(255,0,0,0.5)]">
							K.O.
						</h2>
						<p className="text-zinc-300 font-display mb-2">Tu as été vaincu !</p>
						<p className="scouter-text text-lg mb-6">Ki final : {score.toLocaleString("fr-FR")}</p>
						<button onClick={initializeGame} className="dbz-button">
							Renaître
						</button>
					</div>
				)}
			</div>

			<div className="mt-8 text-center text-zinc-400 text-sm font-display max-w-md">
				<p>
					Utilise les <strong>flèches directionnelles</strong> pour fusionner les personnages et
					augmenter leur niveau de puissance.
				</p>
				<p className="mt-2 text-dbz-orange/80">
					Fusionne deux personnages identiques pour évoluer vers la transformation suivante !
				</p>
			</div>
		</div>
	);
}
