import { getPgPool } from "@/lib/db/pg";
import { sendEmail } from "@/lib/email";

export type EmailCategory = "mediation" | "tournament" | "support" | "partnership" | "general";
export type EmailStatus = "unread" | "read" | "processed" | "archived" | "spam";

export interface InboundEmailAttachment {
	filename: string;
	contentType: string;
	size?: number;
	contentBase64?: string;
	url?: string;
}

export interface InboundEmailData {
	messageId?: string;
	from: string;
	fromName?: string;
	to: string[];
	replyTo?: string;
	subject: string;
	text?: string;
	html?: string;
	category?: EmailCategory;
	attachments?: InboundEmailAttachment[];
	metadata?: Record<string, unknown>;
}

export interface ProcessedInboundEmail {
	id: string;
	messageId?: string;
	sender: string;
	senderName?: string;
	recipient: string;
	subject: string;
	category: EmailCategory;
	status: EmailStatus;
	receivedAt: Date;
}

/**
 * Catégorise un email entrant selon ses destinataires et son objet.
 */
export function categorizeEmail(recipients: string[], subject = ""): EmailCategory {
	const recips = recipients.map((r) => r.toLowerCase().trim());
	const subj = subject.toLowerCase().trim();

	if (recips.some((r) => r.includes("mediation")) || subj.includes("médiation") || subj.includes("mediation")) {
		return "mediation";
	}
	if (
		recips.some((r) => r.includes("tournoi") || r.includes("esport") || r.includes("achillea")) ||
		subj.includes("tournoi") ||
		subj.includes("match") ||
		subj.includes("ranked") ||
		subj.includes("clan")
	) {
		return "tournament";
	}
	if (recips.some((r) => r.includes("partenariat") || r.includes("sponsor")) || subj.includes("partenariat")) {
		return "partnership";
	}
	if (
		recips.some((r) => r.includes("support") || r.includes("aide") || r.includes("technique")) ||
		subj.includes("bug") ||
		subj.includes("erreur") ||
		subj.includes("problème")
	) {
		return "support";
	}

	return "general";
}

/**
 * Nettoie et extrait une adresse email simple depuis un format "Nom <user@domaine.fr>"
 */
export function extractEmailAddress(raw: string): { email: string; name?: string } {
	if (!raw) return { email: "" };
	const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
	if (match) {
		const name = match[1]?.trim().replace(/^["']|["']$/g, "");
		const email = match[2]?.trim().toLowerCase() ?? "";
		return { email, name: name || undefined };
	}
	return { email: raw.trim().toLowerCase() };
}

/**
 * Parse un payload webhook entrant provenant de différents fournisseurs
 * (Resend, Postmark, SendGrid, ou format générique JSON).
 */
export function parseInboundWebhook(
	payload: Record<string, any>
): InboundEmailData {
	// 1. Format Resend (type: "email.created" / "email.received" ou payload direct)
	if (payload.type === "email.created" || payload.type === "email.received") {
		const data = payload.data || {};
		const fromInfo = extractEmailAddress(data.from || "");
		return {
			messageId: data.email_id || data.id,
			from: fromInfo.email,
			fromName: fromInfo.name,
			to: Array.isArray(data.to) ? data.to : [data.to || "contact@rosegriffon.fr"],
			replyTo: data.reply_to?.[0],
			subject: data.subject || "(sans objet)",
			text: data.text,
			html: data.html,
			category: categorizeEmail(Array.isArray(data.to) ? data.to : [data.to || ""], data.subject),
			attachments: (data.attachments || []).map((att: any) => ({
				filename: att.filename || "piece-jointe",
				contentType: att.content_type || "application/octet-stream",
				size: att.size,
				url: att.url,
			})),
			metadata: { provider: "resend", ...payload },
		};
	}

	// 2. Format Postmark (From, To, Subject, TextBody, HtmlBody, MessageID)
	if (payload.From && payload.To && (payload.Subject !== undefined || payload.MessageID)) {
		const fromInfo = extractEmailAddress(payload.From);
		const toAddresses = String(payload.To)
			.split(",")
			.map((addr) => extractEmailAddress(addr).email)
			.filter(Boolean);

		return {
			messageId: payload.MessageID,
			from: fromInfo.email,
			fromName: fromInfo.name || payload.FromName,
			to: toAddresses.length ? toAddresses : ["contact@rosegriffon.fr"],
			replyTo: payload.ReplyTo,
			subject: payload.Subject || "(sans objet)",
			text: payload.TextBody,
			html: payload.HtmlBody,
			category: categorizeEmail(toAddresses, payload.Subject),
			attachments: (payload.Attachments || []).map((att: any) => ({
				filename: att.Name || "piece-jointe",
				contentType: att.ContentType || "application/octet-stream",
				size: att.ContentLength,
				contentBase64: att.Content,
			})),
			metadata: { provider: "postmark" },
		};
	}

	// 3. Format SendGrid Inbound Parse (from, to, subject, text, html)
	if (payload.from && payload.to) {
		const fromInfo = extractEmailAddress(payload.from);
		const toAddresses = String(payload.to)
			.split(",")
			.map((addr) => extractEmailAddress(addr).email)
			.filter(Boolean);

		return {
			messageId: payload.message_id || payload.headers?.["Message-ID"],
			from: fromInfo.email,
			fromName: fromInfo.name,
			to: toAddresses.length ? toAddresses : ["contact@rosegriffon.fr"],
			replyTo: payload.reply_to,
			subject: payload.subject || "(sans objet)",
			text: payload.text,
			html: payload.html,
			category: categorizeEmail(toAddresses, payload.subject),
			metadata: { provider: "sendgrid" },
		};
	}

	// 4. Format générique direct
	const rawFrom = payload.sender || payload.from || "";
	const fromInfo = extractEmailAddress(rawFrom);
	const toRaw = payload.recipient || payload.to || "contact@rosegriffon.fr";
	const toAddresses = Array.isArray(toRaw)
		? toRaw.map((a: string) => extractEmailAddress(a).email)
		: [extractEmailAddress(toRaw).email];

	const subject = payload.subject || "(sans objet)";

	return {
		messageId: payload.messageId || payload.id,
		from: fromInfo.email,
		fromName: fromInfo.name || payload.fromName || payload.name,
		to: toAddresses,
		replyTo: payload.replyTo,
		subject,
		text: payload.text || payload.body || payload.message,
		html: payload.html,
		category: (payload.category as EmailCategory) || categorizeEmail(toAddresses, subject),
		attachments: payload.attachments,
		metadata: { provider: "generic", ...payload.metadata },
	};
}

/**
 * Traite et enregistre un email entrant dans la base de données.
 */
export async function processInboundEmail(
	emailData: InboundEmailData,
	options: { sendAutoReply?: boolean } = {}
): Promise<ProcessedInboundEmail> {
	const category = emailData.category || categorizeEmail(emailData.to, emailData.subject);
	const recipient = emailData.to[0] || "contact@rosegriffon.fr";
	const receivedAt = new Date();

	let insertedId = crypto.randomUUID();

	try {
		const pool = getPgPool();
		const result = await pool.query<{ id: string }>(
			`INSERT INTO public.inbound_emails (
				id, message_id, sender, sender_name, recipient, subject, body_text, body_html, category, status, metadata, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, 'unread', $10, now(), now()
			) RETURNING id`,
			[
				insertedId,
				emailData.messageId || null,
				emailData.from,
				emailData.fromName || null,
				recipient,
				emailData.subject,
				emailData.text || null,
				emailData.html || null,
				category,
				JSON.stringify({
					attachmentsCount: emailData.attachments?.length || 0,
					replyTo: emailData.replyTo,
					allRecipients: emailData.to,
					...emailData.metadata,
				}),
			]
		);
		if (result.rows[0]?.id) {
			insertedId = result.rows[0].id;
		}
	} catch (error) {
		console.warn("[inbound-email] Erreur insertion SQL (mode mémoire repli):", error);
	}

	// Envoi d'un accusé de réception automatique optionnel
	if (options.sendAutoReply && emailData.from && !emailData.from.includes("no-reply") && !emailData.from.includes("noreply")) {
		try {
			await sendEmail({
				to: emailData.from,
				subject: `Accusé de réception : ${emailData.subject}`,
				html: `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="padding:32px 28px 16px">
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700">Message bien reçu 📬</h1>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#4a4a4a">
          Bonjour ${emailData.fromName || ""},<br/><br/>
          Nous avons bien reçu votre message concernant <strong>« ${emailData.subject} »</strong>.
        </p>
      </td></tr>
      <tr><td style="padding:0 28px 28px">
        <p style="margin:0;font-size:14px;line-height:1.55;color:#6a6a6a">
          Notre équipe traite chaque demande avec soin et reviendra vers vous sous 48 heures ouvrées.
        </p>
      </td></tr>
      <tr><td style="padding:14px 28px;border-top:1px solid #ececec" align="center">
        <p style="margin:0;font-size:11px;color:#8a8a8a">Association Rose Griffon — Inazuma Eleven France</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
			});
		} catch (e) {
			console.warn("[inbound-email] Impossible d'envoyer l'accusé de réception:", e);
		}
	}

	return {
		id: insertedId,
		messageId: emailData.messageId,
		sender: emailData.from,
		senderName: emailData.fromName,
		recipient,
		subject: emailData.subject,
		category,
		status: "unread",
		receivedAt,
	};
}

/**
 * Récupère les emails entrants avec filtres optionnels.
 */
export async function getInboundEmails(options: {
	category?: EmailCategory;
	status?: EmailStatus;
	limit?: number;
	offset?: number;
} = {}): Promise<ProcessedInboundEmail[]> {
	const { category, status, limit = 50, offset = 0 } = options;
	try {
		const pool = getPgPool();
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (category) {
			params.push(category);
			conditions.push(`category = $${params.length}`);
		}
		if (status) {
			params.push(status);
			conditions.push(`status = $${params.length}`);
		}

		params.push(limit);
		const limitIdx = params.length;
		params.push(offset);
		const offsetIdx = params.length;

		const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
		const { rows } = await pool.query<any>(
			`SELECT id, message_id AS "messageId", sender, sender_name AS "senderName",
			        recipient, subject, category, status, created_at AS "receivedAt"
			 FROM public.inbound_emails
			 ${whereClause}
			 ORDER BY created_at DESC
			 LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
			params
		);

		return rows;
	} catch (error) {
		console.warn("[inbound-email] Erreur lecture SQL:", error);
		return [];
	}
}
