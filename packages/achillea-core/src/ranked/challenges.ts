// Store portable en mémoire des défis ranked partageables par lien.
//
// Un joueur génère un lien (`/ranked/defi/<code>`) ; n'importe quel autre joueur connecté
// peut l'ouvrir et l'accepter → un match est créé entre les deux. Le défi peut aussi viser
// un joueur précis (`toUserId`, ex. proposition de revanche poussée via Socket.IO).
//
// Volontairement EN MÉMOIRE (pas de table) : un défi est éphémère (TTL court) et un
// redémarrage du sub-process Colyseus l'invalide sans conséquence (le lien renverra
// simplement « défi expiré », l'inviteur en régénère un). Zéro migration DB.

const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 min
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I/O/0/1 (lisibilité)
const CODE_LEN = 8;

export interface Challenge {
  code: string;
  fromUserId: string;
  fromDisplayName: string;
  fromAvatar: string;
  fromElo: number;
  mode: number;
  ranked: boolean;
  /** Défi ciblé (revanche) : seul ce joueur peut l'accepter. null = ouvert à tous. */
  toUserId: string | null;
  createdAt: number;
  expiresAt: number;
}

const challenges = new Map<string, Challenge>();

function genCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Supprime les défis expirés (appelé en lecture/écriture, pas besoin de timer dédié). */
export function purgeExpiredChallenges(now = Date.now()): void {
  for (const [code, c] of challenges) {
    if (c.expiresAt <= now) challenges.delete(code);
  }
}

export interface CreateChallengeInput {
  fromUserId: string;
  fromDisplayName: string;
  fromAvatar: string;
  fromElo: number;
  mode: number;
  ranked: boolean;
  toUserId?: string | null;
}

export function createChallenge(input: CreateChallengeInput): Challenge {
  purgeExpiredChallenges();
  const now = Date.now();
  // Code unique (collision ultra-improbable mais on reboucle par sûreté).
  let code = genCode();
  while (challenges.has(code)) code = genCode();
  const challenge: Challenge = {
    code,
    fromUserId: input.fromUserId,
    fromDisplayName: input.fromDisplayName,
    fromAvatar: input.fromAvatar,
    fromElo: input.fromElo,
    mode: input.mode,
    ranked: input.ranked,
    toUserId: input.toUserId ?? null,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  };
  challenges.set(code, challenge);
  return challenge;
}

/** Lecture (preview) sans consommer. null si absent ou expiré. */
export function getChallenge(code: string): Challenge | null {
  const c = challenges.get(code);
  if (!c) return null;
  if (c.expiresAt <= Date.now()) {
    challenges.delete(code);
    return null;
  }
  return c;
}

/** Consomme (supprime) un défi à usage unique. null si absent/expiré. */
export function consumeChallenge(code: string): Challenge | null {
  const c = getChallenge(code);
  if (!c) return null;
  challenges.delete(code);
  return c;
}

/** Annule un défi encore en attente (l'inviteur a fermé l'attente). */
export function cancelChallenge(code: string): void {
  challenges.delete(code);
}

/** Nombre de défis actifs (diagnostic). */
export function activeChallengeCount(): number {
  purgeExpiredChallenges();
  return challenges.size;
}
