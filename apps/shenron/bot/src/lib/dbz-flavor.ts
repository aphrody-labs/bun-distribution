/**
 * Textes DBZ-thémés pour rendre les notifications du bot plus immersives.
 *
 * Trois surfaces :
 *   - `randomDailyQuestMessage` : quête quotidienne (pool large + variantes streak)
 *   - `levelUpMessage`          : passage de palier (3 variantes par niveau)
 *   - `rareDropMessage` (bonus) : événement rare (1-2% de chance d'être utilisé)
 */
import { formatXP, xpRequiredForLevel } from "./xp";

// ─── Quête quotidienne ────────────────────────────────────────────────────

/**
 * Pool commun — 30+ messages inspirés des arcs Saiyan → Tournoi du Pouvoir.
 * Placeholders : {user} {zeni} {streak}
 */
const QUEST_COMMON = [
	"🎯 {user} s'est entraîné chez **Kami-sama** : **+{zeni} Ƶ** (streak {streak})",
	"🥋 {user} a survécu à un entraînement de **Maître Roshi** — 200 pompes, 200 abdos, 200 squats : **+{zeni} Ƶ** (streak {streak})",
	"💪 {user} a tenu un round contre **Végéta** en salle de gravité ×300 : **+{zeni} Ƶ** (streak {streak})",
	"⚡ {user} a chargé une **Genkidama** avec les bras levés : **+{zeni} Ƶ** (streak {streak})",
	"🐉 {user} a trouvé une **Dragon Ball** à 4 étoiles près de chez Papy Son Gohan : **+{zeni} Ƶ** (streak {streak})",
	"☁️ {user} a filé sur le **Nuage Magique** (ça tient, il a le cœur pur) : **+{zeni} Ƶ** (streak {streak})",
	"🔥 {user} a lâché un **Kame-Hame-Ha** de trois secondes : **+{zeni} Ƶ** (streak {streak})",
	"🌌 {user} a médité avec **Piccolo** au sommet d'une cascade : **+{zeni} Ƶ** (streak {streak})",
	"🏜️ {user} a éclaté un **Saibaman** avant qu'il n'explose : **+{zeni} Ƶ** (streak {streak})",
	"🏆 {user} a signé un autographe à **Mr. Satan** : **+{zeni} Ƶ** (streak {streak})",
	"🗼 {user} a grimpé la **Tour Karin** (deux fois, l'ascenseur est cassé) : **+{zeni} Ƶ** (streak {streak})",
	"🍚 {user} a mangé un **Senzu** — et rendu les six autres : **+{zeni} Ƶ** (streak {streak})",
	"🎶 {user} a pêché un poisson géant à mains nues comme **Gokū enfant** : **+{zeni} Ƶ** (streak {streak})",
	"🌀 {user} a maîtrisé le **Kaio-ken × 4** sans s'évanouir : **+{zeni} Ƶ** (streak {streak})",
	"👽 {user} a battu **Raditz** (avec un peu d'aide, ok) : **+{zeni} Ƶ** (streak {streak})",
	"💥 {user} a survécu à un **Ki Blast Cannon** de Nappa : **+{zeni} Ƶ** (streak {streak})",
	"🛸 {user} a réparé un vaisseau spatial à la façon de **Bulma** : **+{zeni} Ƶ** (streak {streak})",
	"🧘 {user} a passé 24 h dans la **Salle de l'Esprit et du Temps** : **+{zeni} Ƶ** (streak {streak})",
	"🍜 {user} a partagé un bol de ramens avec **Chi-Chi** (sans se prendre la gifle) : **+{zeni} Ƶ** (streak {streak})",
	"🎓 {user} a reçu un cours particulier de **Whis** (il reste un peu lent) : **+{zeni} Ƶ** (streak {streak})",
	"🟣 {user} a esquivé un **Destructo-Disque** de Krilin : **+{zeni} Ƶ** (streak {streak})",
	"🔮 {user} a consulté **Baba la Voyante** : **+{zeni} Ƶ** (streak {streak})",
	"🎩 {user} a ramassé les courses de **Mr. Popo** : **+{zeni} Ƶ** (streak {streak})",
	"👹 {user} a neutralisé un **Saiyan de 4ᵉ classe** : **+{zeni} Ƶ** (streak {streak})",
	"🌊 {user} a traversé le **Serpentin Road** sans tomber : **+{zeni} Ƶ** (streak {streak})",
	"🏎️ {user} a pris l'**Air Car** de Bulma pour un tour : **+{zeni} Ƶ** (streak {streak})",
	"🥊 {user} a gagné un match au **Tenkaichi Budokai** : **+{zeni} Ƶ** (streak {streak})",
	"🛡️ {user} a paré une charge de **Cell forme parfaite** : **+{zeni} Ƶ** (streak {streak})",
	"👊 {user} a posé un coup de poing à **Boo gros-bonbon** (qui a bien ri) : **+{zeni} Ƶ** (streak {streak})",
	"🌸 {user} a fait tomber **Beerus** avec un plat de nouilles : **+{zeni} Ƶ** (streak {streak})",
	"🕊️ {user} a reçu un compliment de **Dendé** : **+{zeni} Ƶ** (streak {streak})",
	"💎 {user} a récupéré un **cristal du Temps** chez Chronoa : **+{zeni} Ƶ** (streak {streak})",
];

/** Streak ≥ 7 jours — ton plus fier. */
const QUEST_STREAK_HOT = [
	"🔥 {user} enchaîne **{streak} jours** d'entraînement — Maître Roshi est presque ému : **+{zeni} Ƶ**",
	"⚔️ {user} maintient **{streak} jours** de discipline saiyan : **+{zeni} Ƶ**",
	"🌟 Régularité légendaire : **{streak} jours** d'affilée pour {user} — **+{zeni} Ƶ**",
];

/** Streak ≥ 30 jours — ton "divin". */
const QUEST_STREAK_DIVINE = [
	"🌌 {user} vient de franchir **{streak} jours** consécutifs — Whis prend des notes : **+{zeni} Ƶ**",
	"👑 **{streak} jours** sans faillir. {user} approche de l'état d'Ultra Instinct : **+{zeni} Ƶ**",
	"💫 Zeno-sama lève un sourcil. {user} : **{streak} jours** d'affilée · **+{zeni} Ƶ**",
];

/** Événements rares (1% de chance, substitués par appelant si souhaité). */
const QUEST_RARE = [
	"🐲 Un éclat doré traverse le ciel — {user} a croisé **Super Shenron** : **+{zeni} Ƶ** (streak {streak})",
	"⚡ {user} a touché l'**Ultra Instinct** deux secondes (et l'a reperdu aussitôt) : **+{zeni} Ƶ** (streak {streak})",
	"🕰️ {user} a trouvé une **Time Ring** abandonnée par Zamasu : **+{zeni} Ƶ** (streak {streak})",
];

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

function apply(template: string, userId: string, zeni: number, streak: number): string {
	return template
		.replaceAll("{user}", `<@${userId}>`)
		.replaceAll("{zeni}", String(zeni))
		.replaceAll("{streak}", String(streak));
}

function randomDailyQuestMessage(userId: string, zeni: number, streak: number): string {
	// 1% : événement rare (toutes streaks confondues)
	if (Math.random() < 0.01) return apply(pick(QUEST_RARE), userId, zeni, streak);
	// Streak divine (30+)
	if (streak >= 30 && Math.random() < 0.5)
		return apply(pick(QUEST_STREAK_DIVINE), userId, zeni, streak);
	// Streak chaude (7+)
	if (streak >= 7 && Math.random() < 0.35)
		return apply(pick(QUEST_STREAK_HOT), userId, zeni, streak);
	// Pool commun
	return apply(pick(QUEST_COMMON), userId, zeni, streak);
}

// ─── Level up ─────────────────────────────────────────────────────────────

/**
 * Trois variantes par palier — sélection aléatoire à chaque level-up.
 * Les paliers 1-10 correspondent à LEVEL_THRESHOLDS (1 k → 9 M).
 */
const LEVEL_FLAVORS: Record<number, readonly string[]> = {
	1: [
		"💨 **Premier souffle** — tu dépasses l'humain moyen. Chi-Chi approuve (pour une fois).",
		"🌱 **Aura visible** — Roshi te laisse arroser le jardin. C'est un début.",
		"🥚 **Sortie de la coquille** — tu viens de dépasser Yamcha. De peu.",
	],
	2: [
		"🥋 **Niveau Krilin** — tu t'entraînes sérieusement au dojo Turtle.",
		"🎯 **Contrôle du ki** — Ten Shin Han t'accorde un hochement de tête.",
		"🧢 **Chauve honorable** — Nimbus tolère ton poids.",
	],
	3: [
		"⚔️ **Saga Saiyan** — tu tiendrais tête à Nappa (pas longtemps, mais quand même).",
		"👊 **Kaio-ken débloqué** — la route du Serpent ne t'effraie plus.",
		"🪐 **Gravité 10×** — tu marches droit là où Gokū rampait hier.",
	],
	4: [
		"🌍 **Saga Namek** — les soldats de Freezer commencent à transpirer.",
		"🟢 **Contact Namekien** — Piccolo te concède un sourire en coin.",
		"🛸 **Vaisseau Bulma** — tu atteins la vitesse supra-lumière mentalement.",
	],
	5: [
		"☢️ **Saga Cyborgs** — Dr. Gero a mis ton nom sur sa liste.",
		"🤖 **C-17 t'observe** — il hausse les sourcils. C'est déjà beaucoup.",
		"🧬 **Cell Phase 1** esquive un peu moins bien tes attaques.",
	],
	6: [
		"💪 **Super Saiyan débloqué** — cheveux dorés, aura qui chauffe les murs.",
		"🟡 **Le Légendaire** — une colère suffisante, une transformation suffisante.",
		"🦁 **Route de Gokū** — le scouter de Freezer a explosé rien qu'en te voyant.",
	],
	7: [
		"🌟 **Super Saiyan 2** — la foudre crépite, le sol recule.",
		"⚡ **Moment Gohan vs Cell** — ton ki devient cassant comme du verre.",
		"💥 **Électricité statique divine** — ta coiffure refuse de redescendre.",
	],
	8: [
		"🦁 **Super Saiyan 3** — tes cheveux touchent le sol, la planète tremble.",
		"🌋 **Tension planétaire** — le Kaiō du Nord te supplie de te calmer.",
		"🫠 **Forme coûteuse** — tu la tiens 10 minutes, puis tu dors 3 jours.",
	],
	9: [
		"🌌 **Super Saiyan Blue** — union du Saiyan et du Kaio-ken, aura turquoise.",
		"🐉 **Beerus hoche la tête** — il ne dort plus pendant ton combat.",
		"🧘 **Whis lève les yeux** de sa tasse. C'est un compliment.",
	],
	10: [
		"⚡ **IT'S OVER 9 000 000 !** — Ultra Instinct, forme argentée, mouvements purs.",
		"👑 **Mastered Ultra Instinct** — Jiren hésite. Jiren n'hésite jamais.",
		"🌠 **Zeno-sama applaudit** depuis sa tour. Ça n'arrive jamais.",
	],
};

export function levelUpMessage(userId: string, newLevel: number): string {
	const reqXp = xpRequiredForLevel(newLevel);
	const threshold = Number.isFinite(reqXp) ? { level: newLevel, xp: reqXp } : undefined;
	const variants = LEVEL_FLAVORS[newLevel];
	const flavor = variants ? pick(variants) : undefined;
	const header = threshold
		? `<@${userId}> a atteint les **${formatXP(threshold.xp)} unités** !`
		: `<@${userId}> monte en puissance !`;
	return flavor ? `${header}\n${flavor}` : header;
}

// ─── Bonus : rare drop (utilisable ailleurs) ──────────────────────────────

const RARE_DROPS = [
	"🌟 {user} a trouvé un **Senzu** en tapant ses messages !",
	"🐲 Une **Dragon Ball** a roulé dans le canal. {user} l'a attrapée.",
	"🪙 {user} a ramassé un **sac de Zéni** échappé par Mr. Popo.",
];

function rareDropMessage(userId: string): string {
	return pick(RARE_DROPS).replaceAll("{user}", `<@${userId}>`);
}
