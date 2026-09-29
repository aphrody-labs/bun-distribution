/**
 * /api/telemetry — ingest first-party de la télémétrie web (RGPD-safe).
 *
 * POST { events: [...] } → valide (zod) → insert Postgres (`site_events`).
 *
 * Anonymisation (cible France/UE) :
 *   - JAMAIS d'IP brute : on calcule `visitorHash = SHA-256(IP + UA + sel
 *     quotidien)`. Le sel tourne chaque jour → la ré-identification d'un
 *     visiteur d'un jour à l'autre est impossible (pseudonymisation forte).
 *   - `userId` rattaché seulement si session Better Auth active.
 *   - sinon `anonId` = cookie httpOnly signé (HMAC) — pseudonyme stable, pas un
 *     identifiant personnel, jamais lisible/falsifiable côté client.
 *   - `path` est conservé sans query string (pas de PII dans l'URL).
 *
 * Rate-limit basique en mémoire (par visitorHash) pour éviter le flood.
 */
import { createHash, createHmac } from "node:crypto";
import { timingSafeEqualString } from "@shenron/auth/crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { siteEvents, type SiteEventInsert } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { SITE_URL } from "@/lib/config";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";
import { clientIp } from "@/app/api/_client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hôte canonique du site (sans `www.`), dérivé de la config centralisée, pour
// distinguer un référent interne d'un référent externe dans `cleanReferrer`.
const CANONICAL_HOST = new URL(SITE_URL).host.replace(/^www\./, "");

// --- Validation --------------------------------------------------------------

const eventSchema = z.object({
	type: z.string().min(1).max(64),
	path: z.string().min(1).max(512),
	referrer: z.string().max(512).nullish(),
	sessionId: z.string().min(1).max(64),
	entityType: z.string().max(64).nullish(),
	entityId: z.string().max(128).nullish(),
	// Borne le volume de `props` : jusqu'à 20 events/POST × jsonb non borné →
	// amplification de stockage (nginx client_max_body_size = 60m). Rejette si la
	// sérialisation dépasse ~2 Ko.
	props: z
		.record(z.string(), z.unknown())
		.refine((p) => JSON.stringify(p).length <= 2000, { message: "props too large" })
		.optional(),
	ts: z.number().optional(),
});

const bodySchema = z.object({
	events: z.array(eventSchema).min(1).max(20),
});

/**
 * Plafond du corps accepté, refusé AVANT désérialisation.
 *
 * Le schéma borne déjà chaque champ, mais il ne s'applique qu'une fois le JSON
 * désérialisé : nginx laisse passer 60 Mo (`client_max_body_size` de
 * `deploy/nginx/dragonballfr.com.conf`), et cette route est ouverte aux
 * visiteurs anonymes. Un lot de 20 évènements aux bornes maximales pèse ~70 Ko —
 * 128 Ko laissent de la marge sans offrir de levier d'amplification.
 */
const CORPS_MAX = 128 * 1024;

/**
 * Horodatage retenu pour un évènement, ou `null` pour laisser l'horloge serveur.
 *
 * Le client envoie son `Date.now()` au moment de l'évènement, et c'est utile :
 * le lot part avec 1,5 s de débounce, et le flush de fermeture d'onglet
 * (`sendBeacon`) peut arriver bien plus tard. Mais cette valeur n'est pas
 * vérifiable, et `site_events.ts` commande TOUTES les fenêtres de
 * `/api/analytics` (aujourd'hui, 7 j, 30 j, 90 j, temps réel) : une horloge mal
 * réglée — banal sur mobile — y écrivait des évènements datés de mois en avance
 * ou en retard, sans que rien ne le signale. Pire, `z.number()` laisse passer
 * `Infinity` : `new Date(Infinity)` est une date invalide, que le pilote refuse
 * au moment de l'insert — le lot ENTIER repartait alors en 500.
 *
 * On garde donc l'horloge client dans la seule fenêtre où elle apporte quelque
 * chose (le retard d'envoi), et on retombe sur le `CURRENT_TIMESTAMP` de la
 * colonne au-delà — exactement ce qui se passait déjà quand `ts` était absent.
 */
const TS_RETARD_MAX_MS = 24 * 60 * 60 * 1000;
const TS_AVANCE_MAX_MS = 5 * 60 * 1000;

function horodatage(brut: number | undefined, maintenant: number): Date | null {
	if (brut === undefined || !Number.isFinite(brut)) return null;
	if (brut > maintenant + TS_AVANCE_MAX_MS) return null;
	if (brut < maintenant - TS_RETARD_MAX_MS) return null;
	return new Date(brut);
}

// --- Anonymisation -----------------------------------------------------------

// Sel de base : un secret serveur (réutilise SHENRON_USER_SECRET / BETTER_AUTH_SECRET
// déjà présents en prod) — jamais committé. Combiné à la date du jour, il rotate
// quotidiennement le hash visiteur. Fallback dev si aucun secret n'est posé.
function serverSecret(): string {
	return env.SHENRON_USER_SECRET ?? env.BETTER_AUTH_SECRET ?? "dbfr-telemetry-dev-secret-change-me";
}

/** Hash visiteur quotidien (anti-doublon), jamais d'IP brute stockée. */
function dailyVisitorHash(ip: string, ua: string): string {
	const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
	return createHash("sha256")
		.update(`${ip}|${ua}|${day}|${serverSecret()}`)
		.digest("hex")
		.slice(0, 32);
}

// --- Cookie anonId signé (HMAC) ---------------------------------------------

const ANON_COOKIE = "dbfr_aid";
const ANON_MAX_AGE = 60 * 60 * 24 * 180; // 180 j

function signAnon(raw: string): string {
	const mac = createHmac("sha256", serverSecret()).update(raw).digest("base64url").slice(0, 24);
	return `${raw}.${mac}`;
}

function verifyAnon(value: string | undefined): string | null {
	if (!value) return null;
	const dot = value.lastIndexOf(".");
	if (dot <= 0) return null;
	const raw = value.slice(0, dot);
	const mac = value.slice(dot + 1);
	const expected = createHmac("sha256", serverSecret())
		.update(raw)
		.digest("base64url")
		.slice(0, 24);
	return timingSafeEqualString(mac, expected) ? raw : null;
}

function newAnonId(): string {
	return createHash("sha256")
		.update(`${Date.now()}-${Math.random()}-${serverSecret()}`)
		.digest("base64url")
		.slice(0, 20);
}

// --- Rate-limit en mémoire (best-effort, par visitorHash) -------------------

const telemetryRateLimit = createMemoryRateLimiter({
	windowMs: 60_000,
	limit: 120,
	namespace: "telemetry-ip",
});

// --- Handler -----------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
	const annoncee = Number(req.headers.get("content-length") ?? 0);
	if (Number.isFinite(annoncee) && annoncee > CORPS_MAX) {
		return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
	}

	let parsed: z.infer<typeof bodySchema>;
	try {
		parsed = bodySchema.parse(await req.json());
	} catch {
		return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
	}

	const ua = req.headers.get("user-agent")?.slice(0, 256) ?? "";
	const ip = clientIp(req);
	const visitorHash = dailyVisitorHash(ip, ua);

	const rate = await telemetryRateLimit.consume(visitorHash, parsed.events.length);
	if (rate.limited) {
		return NextResponse.json(
			{ ok: false, error: "rate_limited" },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
		);
	}

	// Identité : userId (connecté) prioritaire ; sinon anonId cookie signé.
	let userId: string | null = null;
	try {
		const me = await getCurrentUser();
		userId = me?.user?.id ?? null;
	} catch {
		userId = null;
	}

	const existingAnon = verifyAnon(req.cookies.get(ANON_COOKIE)?.value);
	const anonId = existingAnon ?? newAnonId();

	// Normalise le path (retire query string + fragment → pas de PII).
	const cleanPath = (p: string): string => p.split("?")[0]!.split("#")[0]!;
	// Référent : chemin seul si interne (host canonique ou son variant `www.`),
	// sinon host seul pour l'externe (pas de chemin tiers complet).
	const cleanReferrer = (r: string | null | undefined): string | null => {
		if (!r) return null;
		try {
			const u = new URL(r);
			const host = u.host.replace(/^www\./, "");
			return host === CANONICAL_HOST ? cleanPath(u.pathname) : u.host;
		} catch {
			return null;
		}
	};

	const maintenant = Date.now();
	const rows: SiteEventInsert[] = parsed.events.map((e) => {
		const ts = horodatage(e.ts, maintenant);
		return {
			type: e.type,
			userId,
			anonId,
			sessionId: e.sessionId,
			entityType: e.entityType ?? null,
			entityId: e.entityId ?? null,
			path: cleanPath(e.path),
			referrer: cleanReferrer(e.referrer),
			visitorHash,
			props: (e.props ?? null) as Record<string, unknown> | null,
			...(ts ? { ts } : {}),
		};
	});

	try {
		await db.insert(siteEvents).values(rows);
	} catch (err) {
		console.error("[telemetry] insert failed", err);
		return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
	}

	const res = NextResponse.json({ ok: true, count: rows.length });
	// (Re)pose le cookie anonId signé (httpOnly, SameSite=Lax, sécurisé en prod).
	if (!existingAnon) {
		res.cookies.set(ANON_COOKIE, signAnon(anonId), {
			httpOnly: true,
			sameSite: "lax",
			secure: env.NODE_ENV === "production",
			maxAge: ANON_MAX_AGE,
			path: "/",
		});
	}
	return res;
}
