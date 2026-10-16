import nodemailer from "nodemailer";

import { createPostgresClient } from "@rosegriffon/db/service";
import { absoluteUrl } from "@/lib/site-url";

export type ReminderStage = "announce" | "reminder1" | "reminder2" | "lastcall";

const transporter = nodemailer.createTransport({
	auth: {
		pass: process.env.SMTP_PASSWORD,
		user: process.env.SMTP_USER,
	},
	host: process.env.SMTP_HOST || "smtp.gmail.com",
	port: Number(process.env.SMTP_PORT || "587"),
	secure: process.env.SMTP_SECURE === "true",
});

const FROM = `"Rose Griffon" <${process.env.SMTP_USER}>`;

interface MailContent {
	subject: string;
	html: string;
	text: string;
}

function migrationLink(): string {
	return absoluteUrl("/patreon-migration");
}

function buildContent(stage: ReminderStage, fullName?: string): MailContent {
	const greeting = fullName ? `Bonjour ${fullName},` : "Bonjour,";
	const link = migrationLink();
	switch (stage) {
		case "announce": {
			return {
				subject: "Rose Griffon prend son envol — important",
				text:
					`${greeting}\n\n` +
					`Nous quittons Patreon. Pour ne rien perdre (rôle Discord, mentions, contenus), ` +
					`liez votre compte Patreon à Rose Griffon en 2 clics : ${link}\n\n` +
					`Vous conservez le même prix pendant 12 mois.\n\nMerci pour votre soutien.`,
				html: htmlWrap(
					greeting,
					`<p>Nous quittons Patreon. Pour ne rien perdre (rôle Discord, mentions, contenus), liez votre compte Patreon à Rose Griffon en 2 clics.</p>
					<p><a href="${link}" class="cta">Lier mon compte → ${link.replace("https://", "")}</a></p>
					<p>Vous conservez le <strong>même prix pendant 12 mois</strong>. Merci pour votre soutien.</p>`
				),
			};
		}
		case "reminder1": {
			return {
				subject: "Plus que 45 jours pour conserver votre rôle Discord",
				text:
					`${greeting}\n\nIl vous reste 45 jours pour réactiver votre soutien sur ${link} ` +
					`et conserver votre rôle Discord + le même tarif Patreon.\n\nMerci.`,
				html: htmlWrap(
					greeting,
					`<p>Il vous reste <strong>45 jours</strong> pour réactiver votre soutien et conserver votre rôle Discord + le même tarif Patreon.</p>
					<p><a href="${link}" class="cta">Réactiver mon soutien</a></p>`
				),
			};
		}
		case "reminder2": {
			return {
				subject: "Plus que 15 jours — Rose Griffon",
				text:
					`${greeting}\n\nDans 15 jours, nous arrêtons définitivement Patreon. ` +
					`Réactivez maintenant : ${link}\n\nUn mois offert pour toute réactivation avant ce délai.`,
				html: htmlWrap(
					greeting,
					`<p>Dans <strong>15 jours</strong>, nous arrêtons définitivement Patreon.</p>
					<p><strong>1 mois offert</strong> pour toute réactivation avant ce délai.</p>
					<p><a href="${link}" class="cta">Réactiver maintenant</a></p>`
				),
			};
		}
		case "lastcall": {
			return {
				subject: "Patreon ferme dans 48h",
				text:
					`${greeting}\n\nDernière chance de conserver votre rôle Discord et votre tarif Patreon.\n` +
					`${link}\n\n— L'équipe Rose Griffon`,
				html: htmlWrap(
					greeting,
					`<p>Dernière chance de conserver votre rôle Discord et votre tarif Patreon.</p>
					<p><a href="${link}" class="cta">Je réactive en 2 clics</a></p>`
				),
			};
		}
	}
}

function htmlWrap(greeting: string, body: string): string {
	return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:32px;background:#0c1730;color:#e8e6e1;font-family:Inter,system-ui,sans-serif">
	<div style="max-width:520px;margin:0 auto;background:#15214a;border-radius:16px;padding:28px;border:1px solid #c9a958">
		<h1 style="color:#c9a958;font-size:18px;margin:0 0 16px">Rose Griffon</h1>
		<p style="margin:0 0 12px">${greeting}</p>
		<style>.cta{display:inline-block;background:#c9a958;color:#0c1730;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none;margin:8px 0}</style>
		${body}
	</div>
</body></html>`;
}

export async function sendReminder(
	email: string,
	stage: ReminderStage,
	fullName?: string
): Promise<void> {
	const content = buildContent(stage, fullName);
	await transporter.sendMail({
		from: FROM,
		html: content.html,
		subject: content.subject,
		text: content.text,
		to: email,
	});
}

export interface ReminderRunSummary {
	stage: ReminderStage;
	candidates: number;
	sent: number;
	skipped: number;
	failed: number;
}

export async function runReminderBatch(stage: ReminderStage): Promise<ReminderRunSummary> {
	const supabase = createPostgresClient();

	const minNotificationCount = (
		{
			announce: 0,
			lastcall: 3,
			reminder1: 1,
			reminder2: 2,
		} as const
	)[stage];

	const { data, error } = await supabase
		.from("patreon_legacy_members")
		.select("patreon_member_id,email,full_name,notification_count")
		.eq("rg_subscription_status", "pending")
		.lte("notification_count", minNotificationCount)
		.not("email", "is", null)
		.limit(500);
	if (error) {
		throw error;
	}

	const candidates = data?.length ?? 0;
	let sent = 0;
	let skipped = 0;
	let failed = 0;

	for (const row of data ?? []) {
		const r = row as {
			patreon_member_id: string;
			email: string;
			full_name: string | null;
			notification_count: number;
		};
		if (r.notification_count > minNotificationCount) {
			skipped += 1;
			continue;
		}
		try {
			await sendReminder(r.email, stage, r.full_name ?? undefined);
			await supabase
				.from("patreon_legacy_members")
				.update({
					notification_count: r.notification_count + 1,
					notified_at: new Date().toISOString(),
				})
				.eq("patreon_member_id", r.patreon_member_id);
			sent += 1;
		} catch (error) {
			console.error("[patreon/notify] mail failed", r.email, error);
			failed += 1;
		}
	}

	return { candidates, failed, sent, skipped, stage };
}
