/**
 * Numéros de licence et secrets QR (logique pure, multi-runtime).
 *
 * - Format / parsing / validation du numéro `ACH-YYYY-#####`.
 * - Génération et vérification de `qrSecret` via la Web Crypto API standard
 *   (`crypto.getRandomValues` / `crypto.subtle`), donc utilisable en
 *   navigateur, edge (Deno/Web), Node 18+ et Bun — aucune dépendance Node.
 */

import { LicenseStatus } from "@rosegriffon/achillea-types";

/** Préfixe des numéros de licence Achilléa. */
export const LICENSE_PREFIX = "ACH";

/** Nombre de chiffres du compteur séquentiel (padding zéro). */
export const LICENSE_SEQ_PADDING = 5;

/** Expression régulière d'un numéro de licence valide : `ACH-YYYY-#####`. */
export const LICENSE_NUMBER_REGEX = /^ACH-(\d{4})-(\d{5})$/;

/** Durée de validité d'une licence (1 an, en millisecondes). */
export const LICENSE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Construit un numéro de licence `ACH-{year}-{seq:5}`.
 *
 * @param year Année d'émission (ex. 2026).
 * @param seq Numéro séquentiel dans l'année (1-based).
 */
export function formatLicenseNumber(year: number, seq: number): string {
	return `${LICENSE_PREFIX}-${year}-${String(seq).padStart(LICENSE_SEQ_PADDING, "0")}`;
}

/** Décompose un numéro de licence en `{ year, seq }`, ou `null` s'il est invalide. */
export function parseLicenseNumber(licenseNumber: string): { year: number; seq: number } | null {
	const match = LICENSE_NUMBER_REGEX.exec(licenseNumber);
	if (!match) return null;
	return { year: Number(match[1]), seq: Number(match[2]) };
}

/** Indique si une chaîne respecte le format `ACH-YYYY-#####`. */
export function isValidLicenseNumber(licenseNumber: string): boolean {
	return LICENSE_NUMBER_REGEX.test(licenseNumber);
}

/**
 * Génère un `qrSecret` aléatoire de 64 caractères hexadécimaux (256 bits
 * d'entropie) via la Web Crypto API — même forme que celui produit par le bot
 * (2 × UUID v4 concaténés sans tirets).
 */
export function generateQrSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

/**
 * Comparaison à temps constant de deux secrets de même longueur, pour éviter
 * les attaques temporelles lors de la vérification d'un `qrSecret`.
 *
 * @returns `true` si les chaînes sont identiques.
 */
export function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/** Raison d'invalidité d'une licence lors d'une vérification. */
export type LicenseInvalidReason = "not_found" | "revoked" | "expired";

/** Données minimales nécessaires pour statuer sur la validité d'une licence. */
export interface LicenseValidityInput {
	status: LicenseStatus;
	/** Date de fin de validité (timestamp ms, Date ou ISO string). */
	validUntil: number | Date | string;
}

/**
 * Détermine si une licence est valide à l'instant `now`, et sinon pourquoi.
 * Réplique l'ordre de décision de `LicenseService.verify` (révoquée avant
 * expirée). Ne révèle aucune donnée interne : statut binaire + raison.
 */
export function evaluateLicenseValidity(
	license: LicenseValidityInput,
	now: number = Date.now()
): { valid: boolean; reason?: LicenseInvalidReason } {
	if (license.status === LicenseStatus.Revoked) return { valid: false, reason: "revoked" };

	const validUntilMs = toEpochMs(license.validUntil);
	if (validUntilMs <= now || license.status === LicenseStatus.Expired) {
		return { valid: false, reason: "expired" };
	}

	return { valid: true };
}

/**
 * Signe un payload avec une clé secrète via HMAC-SHA256 (Web Crypto `subtle`).
 * Utile pour des QR codes auto-vérifiables (sans aller-retour DB) ou des
 * webhooks signés. Renvoie une signature hexadécimale.
 */
export async function signHmacSha256(payload: string, secret: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
	return bytesToHex(new Uint8Array(sig));
}

/** Vérifie une signature HMAC-SHA256 hexadécimale (comparaison à temps constant). */
export async function verifyHmacSha256(
	payload: string,
	signature: string,
	secret: string
): Promise<boolean> {
	const expected = await signHmacSha256(payload, secret);
	return safeEqual(expected, signature);
}

// ── Helpers internes ─────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
	return hex;
}

function toEpochMs(value: number | Date | string): number {
	if (typeof value === "number") return value;
	if (value instanceof Date) return value.getTime();
	return new Date(value).getTime();
}
