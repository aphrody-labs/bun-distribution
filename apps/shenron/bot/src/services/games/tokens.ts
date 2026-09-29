/**
 * Helpers HMAC pour les états de jeu stateless.
 *
 * Pourquoi : permet à un client (site Next) de garder le board/target côté
 * navigateur sans pouvoir le forger. Chaque réponse serveur inclut une
 * signature HMAC-SHA256 que le serveur revérifie au coup suivant.
 *
 * Évite d'ajouter une table game_sessions pour des parties courtes.
 */

import { timingSafeEqualString } from "@shenron/auth/crypto";
import type { MorpionCell } from "./morpion";

function hmacHex(secret: string, msg: string): string {
	return new Bun.CryptoHasher("sha256", secret).update(msg).digest("hex");
}

/** Égalité à durée constante (`timingSafeEqualString` de `@shenron/auth/crypto`). */
export function constantTimeEqualStr(a: string, b: string): boolean {
	return timingSafeEqualString(a, b);
}

/* ───── Morpion : sig sur board (9 cells) + userId + stake + ts ───── */

export function signMorpion(
	secret: string,
	board: MorpionCell[],
	userId: string,
	stake: number,
	ts: number
): string {
	return hmacHex(secret, `morpion:${userId}:${stake}:${ts}:${board.join("")}`);
}

const BOARD_RE = /^[.XO]{9}$/;

/** Parse une string 9 chars "..X..O.X." vers MorpionCell[]. */
export function parseMorpionBoard(raw: unknown): MorpionCell[] | null {
	if (typeof raw !== "string") return null;
	if (!BOARD_RE.test(raw)) return null;
	return raw.split("") as MorpionCell[];
}

/* ───── Bingo : token base64 qui encapsule target + attempts + stake ───── */

/**
 * Token = base64url(JSON({target, stake, attempts, ts, userId})) + "." + hmac
 * Le client ne peut pas modifier (sig invalide) ni dériver target (opaque b64
 * + HMAC). Le bot redécode et vérifie l'intégrité.
 */
export function packBingoToken(
	secret: string,
	userId: string,
	target: number,
	stake: number,
	attempts: number,
	ts: number
): string {
	const payload = JSON.stringify({
		u: userId,
		t: target,
		s: stake,
		a: attempts,
		ts,
	});
	const b64 = Buffer.from(payload).toString("base64url");
	const sig = hmacHex(secret, b64);
	return `${b64}.${sig}`;
}

export type BingoTokenPayload = {
	target: number;
	stake: number;
	attempts: number;
	ts: number;
};

export function unpackBingoToken(
	secret: string,
	token: string,
	expectedUserId: string
): BingoTokenPayload | null {
	const [b64, sig] = token.split(".");
	if (!b64 || !sig) return null;
	const expectedSig = hmacHex(secret, b64);
	if (!constantTimeEqualStr(expectedSig, sig)) return null;
	let parsed: { u?: string; t?: number; s?: number; a?: number; ts?: number };
	try {
		parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (parsed.u !== expectedUserId) return null;
	if (
		typeof parsed.t !== "number" ||
		typeof parsed.s !== "number" ||
		typeof parsed.a !== "number" ||
		typeof parsed.ts !== "number"
	) {
		return null;
	}
	if (Math.abs(Date.now() - parsed.ts) > 30 * 60 * 1000) return null;
	return {
		target: parsed.t,
		stake: parsed.s,
		attempts: parsed.a,
		ts: parsed.ts,
	};
}
