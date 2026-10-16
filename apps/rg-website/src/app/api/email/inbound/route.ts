import { NextRequest, NextResponse } from "next/server";
import { parseInboundWebhook, processInboundEmail } from "@/lib/email-inbound";

/**
 * Endpoint de réception universel d'emails entrants.
 * Compatible avec Resend Inbound, Postmark Inbound, SendGrid Inbound Parse et webhooks JSON.
 */
export async function POST(req: NextRequest) {
	try {
		// Vérification de sécurité optionnelle par secret ou jeton d'autorisation
		const secretAttendu = process.env.EMAIL_INBOUND_SECRET;
		if (secretAttendu) {
			const authHeader = req.headers.get("authorization");
			const urlSecret = req.nextUrl.searchParams.get("secret");
			const headerSecret = req.headers.get("x-inbound-secret");

			const tokenRecu =
				urlSecret ||
				headerSecret ||
				(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

			if (tokenRecu !== secretAttendu) {
				return NextResponse.json({ error: "non_autorise" }, { status: 401 });
			}
		}

		let body: Record<string, any>;
		const contentType = req.headers.get("content-type") || "";

		if (contentType.includes("application/json")) {
			body = await req.json();
		} else if (
			contentType.includes("multipart/form-data") ||
			contentType.includes("application/x-www-form-urlencoded")
		) {
			const formData = await req.formData();
			body = {};
			for (const [key, val] of formData.entries()) {
				if (typeof val === "string") {
					try {
						// Certains fournisseurs transmettent du JSON stringifié dans les champs formData
						body[key] = JSON.parse(val);
					} catch {
						body[key] = val;
					}
				} else {
					body[key] = val;
				}
			}
		} else {
			return NextResponse.json({ error: "type_contenu_non_supporte" }, { status: 415 });
		}

		const emailData = parseInboundWebhook(body);

		if (!emailData.from) {
			return NextResponse.json(
				{ error: "expediteur_manquant", hint: "Le champ from ou sender est obligatoire" },
				{ status: 400 }
			);
		}

		const processed = await processInboundEmail(emailData, { sendAutoReply: true });

		return NextResponse.json({
			ok: true,
			email: {
				id: processed.id,
				messageId: processed.messageId,
				category: processed.category,
				recipient: processed.recipient,
				status: processed.status,
			},
		});
	} catch (error) {
		console.error("[api/email/inbound] Erreur traitement email entrant:", error);
		return NextResponse.json({ error: "erreur_interne" }, { status: 500 });
	}
}

/**
 * Diagnostic & état du service de réception
 */
export async function GET() {
	return NextResponse.json({
		ok: true,
		service: "rg-email-inbound",
		status: "active",
		categories: ["mediation", "tournament", "support", "partnership", "general"],
		providers: ["resend", "postmark", "sendgrid", "generic_json"],
	});
}
