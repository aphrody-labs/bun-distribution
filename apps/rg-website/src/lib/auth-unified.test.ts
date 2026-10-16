import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
	ACHILLEA_SESSION_AUDIENCE,
	ACHILLEA_SESSION_COOKIE_NAME,
	ACHILLEA_SESSION_TTL_SECONDS,
	ACHILLEA_AUTH_ISSUER,
	signAchilleaSessionToken,
	type AchilleaSessionIdentity,
} from "@rosegriffon/auth/achillea-session";
import { safeReturnUrl } from "./achillea/auth-session";
import { isAdmin, isStaff } from "@rosegriffon/auth";

const TEST_SECRET = "432937954077f767fdeb0b68158663f29c97ea917265b114019b96dc57a6742c";

function verifierJetonManuel(
	jeton: string,
	secret: string
): { valide: boolean; erreur?: string; charge?: any } {
	const parties = jeton.split(".");
	if (parties.length !== 3) {
		return { valide: false, erreur: "format_invalide" };
	}
	const [enteteB64, corpsB64, signatureB64] = parties;

	const signatureCalculee = createHmac("sha256", secret)
		.update(`${enteteB64}.${corpsB64}`)
		.digest()
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");

	if (signatureCalculee !== signatureB64) {
		return { valide: false, erreur: "signature_invalide" };
	}

	try {
		const charge = JSON.parse(Buffer.from(corpsB64, "base64url").toString("utf8"));
		const maintenant = Math.floor(Date.now() / 1000);
		if (charge.exp && charge.exp < maintenant) {
			return { valide: false, erreur: "jeton_expire" };
		}
		if (charge.iss !== ACHILLEA_AUTH_ISSUER) {
			return { valide: false, erreur: "emetteur_invalide" };
		}
		if (charge.aud !== ACHILLEA_SESSION_AUDIENCE) {
			return { valide: false, erreur: "audience_invalide" };
		}
		if (charge.id !== charge.sub) {
			return { valide: false, erreur: "id_sub_discordants" };
		}
		return { valide: true, charge };
	} catch {
		return { valide: false, erreur: "charge_illisible" };
	}
}

describe("Unified Auth Ecosystem - Contrat & Sécurité", () => {
	describe("Passerelle Jeton Achilléa (Rose Griffon -> Achilléa)", () => {
		it("signe un jeton conforme aux exigences strictes du bot Achilléa", () => {
			const identite: AchilleaSessionIdentity = {
				id: "123456789012345678",
				username: "CaptainInazuma",
				avatar: "https://cdn.discordapp.com/avatars/123/avatar.png",
			};

			const jeton = signAchilleaSessionToken(identite, TEST_SECRET);
			const verification = verifierJetonManuel(jeton, TEST_SECRET);

			expect(verification.valide).toBe(true);
			expect(verification.charge?.id).toBe("123456789012345678");
			expect(verification.charge?.sub).toBe("123456789012345678");
			expect(verification.charge?.username).toBe("CaptainInazuma");
			expect(verification.charge?.avatar).toBe("https://cdn.discordapp.com/avatars/123/avatar.png");
			expect(verification.charge?.iss).toBe(ACHILLEA_AUTH_ISSUER);
			expect(verification.charge?.aud).toBe(ACHILLEA_SESSION_AUDIENCE);
			expect(verification.charge?.tokenUse).toBe("session");
			expect(verification.charge?.exp - verification.charge?.iat).toBe(
				ACHILLEA_SESSION_TTL_SECONDS
			);
		});

		it("rejette immédiatement un jeton signé avec un mauvais secret", () => {
			const identite: AchilleaSessionIdentity = { id: "987654321" };
			const jeton = signAchilleaSessionToken(identite, "mauvais-secret-non-partage");

			const verification = verifierJetonManuel(jeton, TEST_SECRET);
			expect(verification.valide).toBe(false);
			expect(verification.erreur).toBe("signature_invalide");
		});

		it("rejette un jeton altéré ou expiré", () => {
			const identite: AchilleaSessionIdentity = { id: "987654321" };
			// Jeton expiré depuis 1 heure
			const ilYaUneHeure = Math.floor(Date.now() / 1000) - 3600;
			const ilYaUnMoisEtUneHeure = ilYaUneHeure - ACHILLEA_SESSION_TTL_SECONDS;
			const jetonExpire = signAchilleaSessionToken(identite, TEST_SECRET, ilYaUnMoisEtUneHeure);

			const verification = verifierJetonManuel(jetonExpire, TEST_SECRET);
			expect(verification.valide).toBe(false);
			expect(verification.erreur).toBe("jeton_expire");
		});

		it("garantit le nom et la portée des cookies de session Achilléa", () => {
			expect(ACHILLEA_SESSION_COOKIE_NAME).toBe("token");
			expect(ACHILLEA_SESSION_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
		});
	});

	describe("Validation des redirections (safeReturnUrl)", () => {
		it("permet les routes internes de l'application", () => {
			expect(safeReturnUrl("/achillea")).toBe("/achillea");
			expect(safeReturnUrl("/achillea/clans/12")).toBe("/achillea/clans/12");
			expect(safeReturnUrl("/achillea/tournaments?status=open")).toBe(
				"/achillea/tournaments?status=open"
			);
			expect(safeReturnUrl("/wiki/chara")).toBe("/wiki/chara");
		});

		it("neutralise toute tentative d'open redirect", () => {
			expect(safeReturnUrl("https://malicious.com")).toBe("/achillea");
			expect(safeReturnUrl("//malicious.com")).toBe("/achillea");
			expect(safeReturnUrl("/\\malicious.com")).toBe("/achillea");
			expect(safeReturnUrl("javascript:alert(1)")).toBe("/achillea");
			expect(safeReturnUrl("/achillea\r\nInjected-Header: 1")).toBe("/achillea");
			expect(safeReturnUrl("/achillea\0nullbyte")).toBe("/achillea");
		});
	});

	describe("Contrôle d'accès et rôles unifiés", () => {
		it("reconnaît les rôles administrateur", () => {
			expect(isAdmin("admin")).toBe(true);
			expect(isAdmin("superadmin")).toBe(true);
			expect(isAdmin("editor")).toBe(true);
			expect(isAdmin("member")).toBe(false);
			expect(isAdmin(null)).toBe(false);
		});

		it("reconnaît les rôles staff", () => {
			expect(isStaff("admin")).toBe(true);
			expect(isStaff("staff")).toBe(true);
			expect(isStaff("member")).toBe(false);
			expect(isStaff(null)).toBe(false);
		});
	});
});
