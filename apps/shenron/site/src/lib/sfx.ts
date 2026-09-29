"use client";

/**
 * SFX Dragon Ball — Howler charge les MP3 de `public/sfx/` (pack officiel).
 * Repli Web Audio si un fichier manque.
 *
 * Chemins par défaut :
 *   click, select, whoosh, ki-charge, kamehameha, power-up, teleport, hit
 * Extras optionnels :
 *   punch, final-flash, galick, over9000, nimbus, scream, tapion (ocarina)
 */
import type { Howl } from "howler";

/**
 * `howler` est chargé PARESSEUSEMENT, au premier son.
 *
 * L'import statique le faisait entrer dans le bundle de la page d'accueil :
 * `HomeExperience` importe ce module, `app/page.tsx` rend `HomeExperience`. Or
 * aucun son ne peut être joué avant une interaction (les navigateurs bloquent
 * l'audio automatique), donc ce poids était payé par 100 % des visiteurs pour
 * 0 % d'usage immédiat.
 *
 * Tant que le module n'est pas là, `getHowl` renvoie `null` et l'appelant
 * retombe sur la synthèse Web Audio (`tone`) déjà prévue comme repli — le tout
 * premier clic sonne donc en synthèse, les suivants en échantillon.
 */
type HowlerModule = typeof import("howler");
let howlerMod: HowlerModule | null = null;
let howlerLoading: Promise<void> | null = null;

function ensureHowler(): void {
	if (howlerMod || howlerLoading || typeof window === "undefined") return;
	howlerLoading = import("howler")
		.then((m) => {
			howlerMod = m;
			// Le mode muet a pu être posé avant l'arrivée du module.
			try {
				m.Howler.mute(muted || !enabled);
			} catch {
				/* ignore */
			}
		})
		.catch(() => {
			/* pack audio indisponible : la synthèse Web Audio prend le relais */
		});
}

export type SfxKey =
	| "click"
	| "select"
	| "whoosh"
	| "kiCharge"
	| "kamehameha"
	| "powerUp"
	| "teleport"
	| "hit"
	| "punch"
	| "finalFlash"
	| "galick"
	| "over9000"
	| "nimbus"
	| "scream"
	| "tapion"
	| "win"
	| "lose"
	| "draw";

const FILE: Record<SfxKey, string | null> = {
	click: "/sfx/click.mp3",
	select: "/sfx/select.mp3",
	whoosh: "/sfx/whoosh.mp3",
	kiCharge: "/sfx/ki-charge.mp3",
	kamehameha: "/sfx/kamehameha.mp3",
	powerUp: "/sfx/power-up.mp3",
	teleport: "/sfx/teleport.mp3",
	hit: "/sfx/hit.mp3",
	punch: "/sfx/punch.mp3",
	finalFlash: "/sfx/final-flash.mp3",
	galick: "/sfx/galick.mp3",
	over9000: "/sfx/over9000.mp3",
	nimbus: "/sfx/nimbus.mp3",
	scream: "/sfx/scream.mp3",
	tapion: "/sfx/tapion-ocarina.mp3",
	win: "/sfx/power-up.mp3",
	lose: null,
	draw: null,
};

const VOL: Partial<Record<SfxKey, number>> = {
	kamehameha: 0.42,
	kiCharge: 0.28,
	finalFlash: 0.28,
	galick: 0.28,
	over9000: 0.25,
	scream: 0.2,
	hit: 0.2,
	punch: 0.2,
	whoosh: 0.16,
	select: 0.18,
	click: 0.12,
	teleport: 0.2,
	powerUp: 0.22,
	nimbus: 0.18,
	tapion: 0.15,
	win: 0.22,
};

const howls = new Map<SfxKey, Howl>();
let muted = false;
let enabled = true;
let masterVolume = 0.55;
let unlocked = false;
let kameChargeTimer: ReturnType<typeof setTimeout> | null = null;

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
	if (typeof window === "undefined") return null;
	if (!ctx) {
		const Ctor =
			window.AudioContext ??
			(window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	if (ctx.state === "suspended") void ctx.resume();
	return ctx;
}

function tone(opts: {
	freq: number;
	dur: number;
	type?: OscillatorType;
	gain?: number;
	delay?: number;
}) {
	const c = audio();
	if (!c) return;
	const t0 = c.currentTime + (opts.delay ?? 0) / 1000;
	const osc = c.createOscillator();
	const g = c.createGain();
	osc.type = opts.type ?? "square";
	osc.frequency.setValueAtTime(opts.freq, t0);
	g.gain.setValueAtTime(opts.gain ?? 0.08, t0);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
	osc.connect(g).connect(c.destination);
	osc.start(t0);
	osc.stop(t0 + opts.dur + 0.02);
}

const synth: Record<SfxKey, () => void> = {
	click: () => tone({ freq: 800, dur: 0.05, type: "square", gain: 0.05 }),
	select: () => tone({ freq: 660, dur: 0.06, type: "triangle", gain: 0.05 }),
	whoosh: () => tone({ freq: 280, dur: 0.12, type: "sawtooth", gain: 0.04 }),
	kiCharge: () => tone({ freq: 120, dur: 0.35, type: "sawtooth", gain: 0.05 }),
	kamehameha: () => {
		tone({ freq: 200, dur: 0.2, type: "sawtooth", gain: 0.07 });
		tone({ freq: 400, dur: 0.4, type: "square", gain: 0.08, delay: 200 });
	},
	powerUp: () => tone({ freq: 300, dur: 0.25, type: "triangle", gain: 0.06 }),
	teleport: () => {
		tone({ freq: 880, dur: 0.04, type: "square", gain: 0.04 });
		tone({ freq: 1320, dur: 0.06, type: "triangle", gain: 0.05, delay: 40 });
	},
	hit: () => tone({ freq: 90, dur: 0.06, type: "square", gain: 0.06 }),
	punch: () => tone({ freq: 110, dur: 0.05, type: "square", gain: 0.05 }),
	finalFlash: () => tone({ freq: 500, dur: 0.3, type: "sawtooth", gain: 0.06 }),
	galick: () => tone({ freq: 450, dur: 0.25, type: "sawtooth", gain: 0.05 }),
	over9000: () => tone({ freq: 700, dur: 0.2, type: "triangle", gain: 0.05 }),
	nimbus: () => tone({ freq: 520, dur: 0.15, type: "sine", gain: 0.04 }),
	scream: () => tone({ freq: 900, dur: 0.2, type: "sawtooth", gain: 0.04 }),
	tapion: () => {
		/* file-only */
	},
	win: () => {
		tone({ freq: 523, dur: 0.08 });
		tone({ freq: 659, dur: 0.08, delay: 80 });
		tone({ freq: 784, dur: 0.18, type: "triangle", gain: 0.1, delay: 160 });
	},
	lose: () => {
		tone({ freq: 220, dur: 0.18, type: "sawtooth", gain: 0.08 });
		tone({ freq: 165, dur: 0.25, type: "sawtooth", gain: 0.08, delay: 160 });
	},
	draw: () => tone({ freq: 440, dur: 0.18, type: "triangle", gain: 0.06 }),
};

function getHowl(key: SfxKey): Howl | null {
	if (typeof window === "undefined") return null;
	const src = FILE[key];
	if (!src) return null;
	if (!howlerMod) {
		ensureHowler();
		return null; // repli synthèse le temps du chargement
	}
	let h = howls.get(key);
	if (!h) {
		h = new howlerMod.Howl({
			src: [src],
			volume: (VOL[key] ?? 0.2) * masterVolume,
			html5: true,
			preload: true,
		});
		howls.set(key, h);
	}
	return h;
}

function play(key: SfxKey) {
	if (muted || !enabled || typeof window === "undefined") return;
	const h = getHowl(key);
	if (h) {
		try {
			h.stop();
			h.play();
			return;
		} catch {
			/* fall through */
		}
	}
	synth[key]();
}

function stop(key: SfxKey) {
	const h = howls.get(key);
	if (h) h.stop();
}

const DEFAULT_FILE: Record<SfxKey, string | null> = { ...FILE };

const SFX_KEY_ALIASES: Record<string, SfxKey> = {
	click: "click",
	select: "select",
	whoosh: "whoosh",
	kiCharge: "kiCharge",
	"ki-charge": "kiCharge",
	kamehameha: "kamehameha",
	powerUp: "powerUp",
	"power-up": "powerUp",
	teleport: "teleport",
	hit: "hit",
	punch: "punch",
	finalFlash: "finalFlash",
	"final-flash": "finalFlash",
	galick: "galick",
	over9000: "over9000",
	nimbus: "nimbus",
	scream: "scream",
	tapion: "tapion",
};

function configureSfx(
	map: Partial<Record<string, string | null>> | null | undefined,
	opts?: { volume?: number; enabled?: boolean; muted?: boolean; resetDefaults?: boolean }
) {
	if (opts?.volume != null) masterVolume = Math.max(0, Math.min(1, opts.volume));
	if (opts?.enabled != null) enabled = opts.enabled;
	if (opts?.muted != null) muted = opts.muted;
	if (opts?.resetDefaults) {
		for (const k of Object.keys(DEFAULT_FILE) as SfxKey[]) {
			FILE[k] = DEFAULT_FILE[k];
		}
		howls.forEach((h) => {
			try {
				h.unload();
			} catch {
				/* ignore */
			}
		});
		howls.clear();
	}
	if (map) {
		for (const [k, v] of Object.entries(map)) {
			const key = SFX_KEY_ALIASES[k] ?? (k as SfxKey);
			if (!(key in FILE)) continue;
			if (v !== undefined) {
				// null → synth only (pas de fichier)
				FILE[key] = v;
				const old = howls.get(key);
				if (old) {
					old.unload();
					howls.delete(key);
				}
			}
		}
	}
	// re-apply volumes
	for (const [key, h] of howls) {
		h.volume((VOL[key] ?? 0.2) * masterVolume);
	}
	try {
		howlerMod?.Howler.mute(muted || !enabled);
	} catch {
		/* ignore */
	}
}

function unlockSfx() {
	if (unlocked) {
		const c = audio();
		if (c?.state === "suspended") void c.resume();
		return;
	}
	unlocked = true;
	// Premier geste utilisateur = moment idéal pour aller chercher `howler` :
	// l'audio devient autorisé, et le téléchargement ne pèse plus sur le rendu.
	ensureHowler();
	(
		[
			"click",
			"select",
			"hit",
			"whoosh",
			"kamehameha",
			"kiCharge",
			"teleport",
			"powerUp",
		] as SfxKey[]
	).forEach((k) => getHowl(k));
	const c = audio();
	if (c?.state === "suspended") void c.resume();
	try {
		const h = getHowl("click");
		if (h) {
			const v = h.volume();
			h.volume(0);
			const id = h.play();
			h.once("play", () => {
				h.stop(id);
				h.volume(v);
			});
		}
	} catch {
		/* ignore */
	}
}

function playKamehamehaSequence() {
	if (muted || !enabled || typeof window === "undefined") return;
	cancelKamehameha();
	play("kiCharge");
	kameChargeTimer = setTimeout(() => {
		kameChargeTimer = null;
		if (muted || !enabled) return;
		stop("kiCharge");
		play("kamehameha");
	}, 1050);
}

function cancelKamehameha() {
	if (kameChargeTimer != null) {
		clearTimeout(kameChargeTimer);
		kameChargeTimer = null;
	}
	stop("kamehameha");
	stop("kiCharge");
}

export const sfx = {
	unlock: unlockSfx,
	click: () => play("click"),
	select: () => play("select"),
	whoosh: () => play("whoosh"),
	kiCharge: () => play("kiCharge"),
	kamehameha: () => play("kamehameha"),
	kamehamehaFull: playKamehamehaSequence,
	cancelKamehameha,
	powerUp: () => play("powerUp"),
	teleport: () => play("teleport"),
	hit: () => play("hit"),
	punch: () => play("punch"),
	finalFlash: () => play("finalFlash"),
	galick: () => play("galick"),
	over9000: () => play("over9000"),
	nimbus: () => play("nimbus"),
	scream: () => play("scream"),
	tapion: () => play("tapion"),
	stopTapion: () => stop("tapion"),
	win: () => play("win"),
	lose: () => play("lose"),
	draw: () => play("draw"),
};

type SfxName = keyof typeof sfx;
