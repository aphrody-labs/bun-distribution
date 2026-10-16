// Entry-point Colyseus dédié au ranked Achillea.
// Lance Bun.serve via @colyseus/bun-websockets, monte les rooms, et expose
// les routes REST (profil, contestation upload, admin validate) via la couche
// Express compat de BunWebSockets.

import { defineServer, defineRoom } from "@colyseus/core";
import { BunWebSockets } from "@colyseus/bun-websockets";
import {
	activeChallengeCount,
	cancelChallenge,
	consumeChallenge,
	createChallenge,
	getChallenge,
	parseMode,
} from "@rosegriffon/achillea-core";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { createProxyMiddleware } from "http-proxy-middleware";

import { QueueRoom } from "./rooms/QueueRoom";
import { MatchRoom } from "./rooms/MatchRoom";
import { LobbyRoom } from "./rooms/LobbyRoom";
import { authFromAuthorization, authFromCookieHeader, type SessionUser } from "./auth";
import {
	activateSeasonAdmin,
	createSeasonAdmin,
	findTier,
	getActiveSeason,
	getOrCreateElo,
	getRanks,
	getUserRow,
	listSeasonsAdmin,
	resetLadderForSeason,
	SEASON_STATES,
	type SeasonConfigInput,
	type SeasonStateValue,
	sql,
	updateSeasonAdmin,
} from "./db";
import { createRankedMatch } from "./match-factory";
import {
	adminResolveLobby,
	cancelLobby,
	cleanupStaleOngoingLobbies,
	getRankedOverview,
	listActiveLobbies,
	listDisputedLobbies,
	setLobbyUserScreenshot,
} from "./persistence";
import { listMatchEvents, logMatchEvent } from "./telemetry";
import { resolveRankedProofUrl, uploadRankedProof } from "./storage";

const PORT = Number(process.env.PORT ?? process.env.RANKED_PORT ?? 4002);
const HOST = process.env.RANKED_HOST ?? "127.0.0.1";
const STORAGE_DIR =
	process.env.RANKED_STORAGE_DIR ?? path.join(process.cwd(), "storage", "disputes");
// Base du site public (pour construire les liens de défi partageables).
const WEBSITE_URL = (process.env.WEBSITE_URL ?? "http://localhost:4200").replace(/\/$/, "");
const ALLOWED_ORIGINS = [
	...new Set(
		(
			process.env.RANKED_ALLOWED_ORIGINS ??
			[
				"http://localhost:4200",
				process.env.WEBSITE_URL ?? "http://localhost:4200",
				process.env.WEB_ALLOWED_ORIGINS ?? "",
			].join(",")
		)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
	),
];

await fs.mkdir(STORAGE_DIR, { recursive: true });

// Resolve auth from a request (cookie ou Authorization header).
async function resolveAuth(req: express.Request): Promise<SessionUser | null> {
	const cookieHeader = req.headers.cookie ?? null;
	const fromCookie = await authFromCookieHeader(cookieHeader);
	if (fromCookie) return fromCookie;
	return authFromAuthorization(req.headers.authorization ?? null);
}

async function userRole(userId: string): Promise<number> {
	const row = await sql<Array<{ role: number }>>`
		SELECT role FROM achillea."user" WHERE id = ${userId} LIMIT 1
	`;
	return row[0]?.role ?? 0;
}

// Appel interne (commande bot Discord) : la commande a déjà vérifié le rôle de l'admin
// Discord ; on accepte via un secret partagé (même .env que le bot TSed). Header optionnel
// `x-internal-actor` = id Discord de l'admin (pour la télémétrie).
const INTERNAL_SECRET = process.env.RANKED_INTERNAL_SECRET ?? "";
function isInternal(req: express.Request): boolean {
	return INTERNAL_SECRET.length > 0 && req.headers["x-internal-secret"] === INTERNAL_SECRET;
}

// Pousse un event Socket.IO à une liste de joueurs via le bot TSed (sub-process Colyseus →
// bot :4000). Best-effort : sert à notifier une proposition de revanche (`rematch_offer`).
function emitToUsersViaBot(userIds: string[], event: string, payload: unknown): void {
	const apiPort = Number(process.env.API_PORT ?? 4000);
	fetch(`http://127.0.0.1:${apiPort}/notifications/emit-to-users`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {}),
		},
		body: JSON.stringify({ userIds, event, payload }),
	}).catch((err) => {
		console.error("[ranked] emit-to-users fetch failed", err);
	});
}

// Relaie une preuve de litige vers le bot TSed (→ salon des Tournament Organizers).
// Best-effort : un échec n'empêche pas l'enregistrement de la preuve.
function notifyProofToBot(lobbyId: number, userId: string, url: string): void {
	const apiPort = Number(process.env.API_PORT ?? 4000);
	fetch(`http://127.0.0.1:${apiPort}/notifications/ranked-proof`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {}),
		},
		body: JSON.stringify({ lobbyId, userId, url }),
	}).catch((err) => {
		console.error("[ranked] ranked-proof fetch failed", err);
	});
}

// Notifie en TEMPS RÉEL les 2 joueurs d'un litige tranché par un admin (validation ou
// annulation) → toast côté front (« la décision des admins »). Couvre les 2 voies d'arbitrage
// (dashboard web + commande Discord /ranked-admin), qui passent toutes deux par les endpoints
// /admin/lobbies/:id/{validate,cancel}. Best-effort : un échec de notif n'invalide pas l'arbitrage.
async function notifyDisputeResolved(lobbyId: number, cancelled: boolean): Promise<void> {
	try {
		const lob = await sql<Array<{ mode: number }>>`
			SELECT mode FROM achillea.lobby WHERE id = ${lobbyId} LIMIT 1
		`;
		const mode = lob[0]?.mode ?? 2;
		const rows = await sql<
			Array<{
				user_id: string;
				team: number;
				score: number;
				forfeit: boolean;
				elo_variation: number | null;
				elo: number;
			}>
		>`
			SELECT lu.user_id, lu.team, lu.score, lu.forfeit, lu.elo_variation,
				COALESCE(ue.elo, 0) AS elo
			FROM achillea.lobby_user lu
			LEFT JOIN achillea.user_elo ue ON ue.user_id = lu.user_id AND ue.mode = ${mode}
			WHERE lu.lobby_id = ${lobbyId}
			ORDER BY lu.team ASC
		`;
		if (rows.length < 2) return;
		const players = rows.map((r) => ({
			userId: r.user_id,
			team: r.team,
			score: r.score,
			forfeit: r.forfeit,
			eloDelta: r.elo_variation ?? 0,
			eloAfter: r.elo,
		}));
		emitToUsersViaBot(
			rows.map((r) => r.user_id),
			"ranked_dispute_resolved",
			{ lobbyId, mode, cancelled, players }
		);
	} catch (err) {
		console.error("[ranked] notifyDisputeResolved failed", err);
	}
}

// Résout l'identité publique + l'ELO d'un joueur pour un mode (pour créer un match/défi).
async function resolvePlayer(
	userId: string,
	mode: number
): Promise<{ userId: string; displayName: string; avatar: string; elo: number }> {
	const userRow = await getUserRow(userId);
	const season = await getActiveSeason();
	const baseRating = season?.config?.baseRating ?? 0;
	const elo = await getOrCreateElo(userId, mode, season?.id ?? null, baseRating);
	return {
		userId,
		displayName: userRow?.display_name ?? userId,
		avatar: userRow?.avatar ?? "",
		elo: elo.elo,
	};
}

// URL d'avatar Discord (mêmes règles que /api/users/me + l'ancienne vue leaderboard_view) :
// avatar absolu tel quel, sinon CDN /avatars/<id>/<hash>.png, sinon embed par défaut (id >> 22 % 6).
function discordAvatar(userId: string, avatar: string | null): string {
	if (!avatar) {
		return `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`;
	}
	if (avatar.startsWith("http")) return avatar;
	return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

type AuthorizeResult =
	| { ok: true; actorId: string | null }
	| { ok: false; status: number; error: string };

// UserRole : Member=0, Moderator=1, Administrator=2, SuperAdministrator=3.
// Lecture (litiges + télémétrie) → Modérateurs+ ; actions (valider/annuler) → Admins+.
// `needAdmin=false` ⇒ Modérateur+ suffit. Les appels internes (secret) passent toujours.
async function authorizeStaff(req: express.Request, needAdmin: boolean): Promise<AuthorizeResult> {
	if (isInternal(req)) {
		const actor = req.headers["x-internal-actor"];
		return { ok: true, actorId: typeof actor === "string" ? actor : null };
	}
	const auth = await resolveAuth(req);
	if (!auth) return { ok: false, status: 401, error: "unauthenticated" };
	const role = await userRole(auth.id);
	if (role < (needAdmin ? 2 : 1)) return { ok: false, status: 403, error: "forbidden" };
	return { ok: true, actorId: auth.id };
}

// Preuves de litige : l'upload binaire est IMPOSSIBLE via ce serveur — bun-serve-express
// reconstruit le corps en `Buffer.from(await req.text(), "utf8")`, ce qui CORROMPT tout
// octet non-UTF8 (multer/busboy casse aussi : "Request closed"). Seul un corps TEXTE
// survit. Le front envoie donc l'image encodee en BASE64 (Content-Type text/plain), lue
// via express.text et decodee ici. On VALIDE ensuite par magic bytes : seules png/jpeg/webp
// passent (svg/html rejetes), et l'extension est DERIVEE du contenu (jamais du client)
// → impossible d'heberger du contenu actif sur le sous-domaine de confiance ranked.
const DISPUTE_MAX_BYTES = 5 * 1024 * 1024;

function sniffImageExt(buf: Buffer): string | null {
	if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
		return ".png"; // 89 50 4E 47 (\x89PNG)
	}
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		return ".jpg"; // FF D8 FF (JPEG)
	}
	if (
		buf.length >= 12 &&
		buf.toString("ascii", 0, 4) === "RIFF" &&
		buf.toString("ascii", 8, 12) === "WEBP"
	) {
		return ".webp"; // RIFF....WEBP
	}
	return null;
}

function corsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
	// On ne pose `Allow-Credentials: true` QUE pour les origines connues (ALLOWED_ORIGINS) —
	// sinon « reflet de n'importe quelle origine + credentials » est un anti-pattern. Les
	// autres origines (et les appels sans Origin : sondes, server-to-server) restent
	// autorisées en lecture non-créditée (endpoints publics).
	const origin = req.headers.origin;
	if (typeof origin === "string") {
		res.setHeader("Vary", "Origin");
		res.setHeader("Access-Control-Allow-Origin", origin);
		if (ALLOWED_ORIGINS.includes(origin)) {
			res.setHeader("Access-Control-Allow-Credentials", "true");
		}
	} else {
		res.setHeader("Access-Control-Allow-Origin", "*");
	}
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
	res.setHeader(
		"Access-Control-Allow-Headers",
		"Content-Type,Authorization,Cookie,apikey,x-client-info"
	);
	if (req.method === "OPTIONS") {
		res.status(204).end();
		return;
	}
	next();
}

/** Compatibility transport: public ranked reads are owned by the unified API. */
async function proxyUnifiedRankedRead(req: express.Request, res: express.Response, path: string) {
	const target = new URL(
		path.startsWith("/users/") ? `/v1/achillea${path}` : `/v1/achillea/ranked${path}`,
		process.env.UNIFIED_API_URL ?? "http://127.0.0.1:8800"
	);
	const query = req.originalUrl.split("?", 2)[1];
	if (query) target.search = query;
	const headers: Record<string, string> = { accept: "application/json" };
	if (req.headers.cookie) headers.cookie = req.headers.cookie;
	if (typeof req.headers.authorization === "string") headers.authorization = req.headers.authorization;
	try {
		const upstream = await fetch(target, { headers });
		const body = await upstream.text();
		res.status(upstream.status).setHeader("Content-Type", "application/json");
		if (upstream.headers.get("cache-control")) res.setHeader("Cache-Control", upstream.headers.get("cache-control")!);
		return res.send(body);
	} catch (error) {
		console.error("[ranked] unified read proxy failed", error);
		return res.status(503).json({ error: "unified_api_unavailable" });
	}
}

const server = defineServer({
	transport: new BunWebSockets({}),
	rooms: {
		// Partition par mode ET classé/non classé : un joueur classé ne sera jamais
		// apparié avec un joueur en file amicale (et inversement).
		queue: defineRoom(QueueRoom).filterBy(["mode", "ranked"]),
		match: defineRoom(MatchRoom),
		// Salon de présence partagé (défi direct) — une seule instance pour tous.
		lobby: defineRoom(LobbyRoom),
	},
	express: (rawApp: any) => {
		const app = rawApp as express.Express;
		app.use(corsMiddleware);
		app.use(express.json({ limit: "100kb" }));

		// Healthcheck
		app.get("/api/health", (_req, res) => {
			res.json({ ok: true, ts: Date.now(), activeChallenges: activeChallengeCount() });
		});

		// Public reads are compatibility routes; the unified API owns their SQL.
		app.get("/api/ranked/tiers", (req, res) => proxyUnifiedRankedRead(req, res, "/tiers"));

		// GET /api/users/me — user enrichi (role, clanId, etc.) pour le rewrite nginx
		// Le frontend Angular appelle ça au lieu de /api/auth/me pour avoir
		// le rôle (Administrator) qui débloque l'admin dashboard.
		app.get("/api/users/me", (req, res) => proxyUnifiedRankedRead(req, res, "/users/me"));

		// GET /api/ranked/me — profil ELO du user courant
		app.get("/api/ranked/me", (req, res) => proxyUnifiedRankedRead(req, res, "/me"));

		// GET /api/ranked/leaderboard?mode=&page=&pageSize= — classement LIVE de la saison
		// active (DENSE_RANK par mode, tri Elo desc), enrichi displayName/avatar. Remplace
		// l'ancienne lecture directe de la vue Supabase `leaderboard_view`, qui filtrait
		// `season_id IS NULL` → vide depuis la création de « Saison 1 » (toutes les lignes
		// user_elo portent désormais un season_id non-null). Source de vérité unique = cette DB.
		app.get("/api/ranked/leaderboard", (req, res) => proxyUnifiedRankedRead(req, res, "/leaderboard"));

		// POST /api/ranked/challenge — crée un lien de défi partageable. Body : { mode, ranked,
		// toUserId? }. Si `toUserId` est fourni (revanche), une notification `rematch_offer` est
		// poussée à ce joueur. Renvoie { code, url, mode, ranked, expiresAt }.
		app.post("/api/ranked/challenge", async (req, res) => {
			const auth = await resolveAuth(req);
			if (!auth) {
				res.status(401).json({ error: "unauthenticated" });
				return;
			}
			try {
				const body = (req.body ?? {}) as { mode?: number; ranked?: boolean; toUserId?: string };
				const mode = parseMode(body.mode);
				const ranked = body.ranked !== false;
				const toUserId =
					typeof body.toUserId === "string" && body.toUserId && body.toUserId !== auth.id
						? body.toUserId
						: null;
				const me = await resolvePlayer(auth.id, mode);
				const challenge = createChallenge({
					fromUserId: me.userId,
					fromDisplayName: me.displayName,
					fromAvatar: me.avatar,
					fromElo: me.elo,
					mode,
					ranked,
					toUserId,
				});
				const url = `${WEBSITE_URL}/ranked/defi/${challenge.code}`;
				void logMatchEvent({
					type: "challenge_created",
					mode,
					userId: auth.id,
					detail: { code: challenge.code, ranked, toUserId },
				});
				// Revanche ciblée → notification temps réel au joueur visé.
				if (toUserId) {
					emitToUsersViaBot([toUserId], "rematch_offer", {
						code: challenge.code,
						fromUserId: me.userId,
						fromDisplayName: me.displayName,
						fromAvatar: me.avatar,
						fromElo: me.elo,
						mode,
						ranked,
						url,
					});
				}
				res.json({
					code: challenge.code,
					url,
					mode,
					ranked,
					toUserId,
					expiresAt: challenge.expiresAt,
				});
			} catch (err) {
				console.error("[ranked] POST /challenge failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// GET /api/ranked/challenge/:code — aperçu d'un défi (qui invite, mode, classé).
		app.get("/api/ranked/challenge/:code", async (req, res) => {
			const auth = await resolveAuth(req);
			if (!auth) {
				res.status(401).json({ error: "unauthenticated" });
				return;
			}
			const code = String(req.params.code ?? "").toUpperCase();
			const challenge = getChallenge(code);
			if (!challenge) {
				res.status(404).json({ error: "challenge_not_found" });
				return;
			}
			// Défi ciblé : seul le destinataire (ou l'inviteur) peut le consulter.
			if (
				challenge.toUserId &&
				challenge.toUserId !== auth.id &&
				challenge.fromUserId !== auth.id
			) {
				res.status(403).json({ error: "not_for_you" });
				return;
			}
			res.json({
				code: challenge.code,
				fromUserId: challenge.fromUserId,
				fromDisplayName: challenge.fromDisplayName,
				fromAvatar: challenge.fromAvatar,
				fromElo: challenge.fromElo,
				mode: challenge.mode,
				ranked: challenge.ranked,
				isOwn: challenge.fromUserId === auth.id,
				expiresAt: challenge.expiresAt,
			});
		});

		// POST /api/ranked/challenge/:code/accept — accepte un défi : crée le match et renvoie
		// la réservation de l'accepteur. L'inviteur (présent sur la page ranked) reçoit la
		// sienne via la LobbyRoom ; à défaut, le push Socket.IO `match_found` (auto-join front).
		app.post("/api/ranked/challenge/:code/accept", async (req, res) => {
			const auth = await resolveAuth(req);
			if (!auth) {
				res.status(401).json({ error: "unauthenticated" });
				return;
			}
			const code = String(req.params.code ?? "").toUpperCase();
			const peek = getChallenge(code);
			if (!peek) {
				res.status(404).json({ error: "challenge_not_found" });
				return;
			}
			if (peek.fromUserId === auth.id) {
				res.status(400).json({ error: "cannot_accept_own" });
				return;
			}
			if (peek.toUserId && peek.toUserId !== auth.id) {
				res.status(403).json({ error: "not_for_you" });
				return;
			}
			// Consomme (usage unique) — un 2e accepteur tombera sur 404.
			const challenge = consumeChallenge(code);
			if (!challenge) {
				res.status(404).json({ error: "challenge_not_found" });
				return;
			}
			try {
				const invitee = await resolvePlayer(auth.id, challenge.mode);
				const inviter = {
					userId: challenge.fromUserId,
					displayName: challenge.fromDisplayName,
					avatar: challenge.fromAvatar,
					elo: challenge.fromElo,
				};
				// a = inviteur (réservation A), b = invité/accepteur (réservation B).
				const { reservationA, reservationB } = await createRankedMatch(
					challenge.mode,
					inviter,
					invitee,
					challenge.ranked
				);
				const deliveredToInviter = LobbyRoom.deliverMatchTo(inviter.userId, reservationA);
				void logMatchEvent({
					type: "challenge_accepted",
					mode: challenge.mode,
					userId: auth.id,
					detail: {
						code: challenge.code,
						inviterUserId: inviter.userId,
						ranked: challenge.ranked,
						deliveredToInviter,
					},
				});
				res.json({ reservation: reservationB, mode: challenge.mode, ranked: challenge.ranked });
			} catch (err) {
				console.error("[ranked] POST /challenge/accept failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// DELETE /api/ranked/challenge/:code — l'inviteur annule son défi en attente.
		app.delete("/api/ranked/challenge/:code", async (req, res) => {
			const auth = await resolveAuth(req);
			if (!auth) {
				res.status(401).json({ error: "unauthenticated" });
				return;
			}
			const code = String(req.params.code ?? "").toUpperCase();
			const challenge = getChallenge(code);
			if (challenge && challenge.fromUserId === auth.id) cancelChallenge(code);
			res.json({ ok: true });
		});

		// POST /api/ranked/:lobbyId/dispute — capture encodee en base64 (corps text/plain).
		// express.text bufferise le corps en string (robuste, contrairement au binaire) ;
		// on decode le base64 puis on valide le contenu.
		app.post(
			"/api/ranked/:lobbyId/dispute",
			express.text({ type: () => true, limit: "8mb" }),
			async (req, res) => {
				const auth = await resolveAuth(req);
				if (!auth) {
					res.status(401).json({ error: "unauthenticated" });
					return;
				}
				const lobbyId = Number(req.params.lobbyId);
				if (!Number.isFinite(lobbyId)) {
					res.status(400).json({ error: "invalid_lobby_id" });
					return;
				}
				// Le corps est l'image en base64 (eventuellement un data-URL `data:...;base64,XXXX`).
				const raw = typeof req.body === "string" ? req.body.trim() : "";
				const b64 = raw.includes(",") ? raw.slice(raw.lastIndexOf(",") + 1) : raw;
				if (!b64) {
					res.status(400).json({ error: "no_file" });
					return;
				}
				const body = Buffer.from(b64, "base64");
				if (body.length === 0) {
					res.status(400).json({ error: "no_file" });
					return;
				}
				if (body.length > DISPUTE_MAX_BYTES) {
					res.status(400).json({ error: "too_large" });
					return;
				}
				// Validation par contenu : seules png/jpeg/webp (magic bytes) passent.
				const ext = sniffImageExt(body);
				if (!ext) {
					res.status(400).json({ error: "unsupported_type" });
					return;
				}
				try {
					// Vérifier que le user fait partie du lobby
					const ownership = await sql<Array<{ team: number }>>`
						SELECT team FROM achillea.lobby_user
						WHERE lobby_id = ${lobbyId} AND user_id = ${auth.id} LIMIT 1
					`;
					if (!ownership[0]) {
						res.status(403).json({ error: "not_in_lobby" });
						return;
					}
					// Stockage PRIORITAIRE = bucket Supabase privé. La base conserve une référence
					// interne stable ; seule une URL signée temporaire sort de l'API.
					const uploaded = await uploadRankedProof({ buffer: body, lobbyId, userId: auth.id, ext });
					let storedReference = uploaded?.reference ?? "";
					let accessUrl = uploaded?.signedUrl ?? "";
					if (!uploaded) {
						if ((process.env.NODE_ENV ?? "development") === "production") {
							res.status(503).json({ error: "private_storage_unavailable" });
							return;
						}
						// Nom de fichier sûr (jamais le nom client) + écriture sur disque.
						const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
						await fs.writeFile(path.join(STORAGE_DIR, fileName), body);
						// path relatif (URL exposée via /storage/disputes/).
						storedReference = `/storage/disputes/${fileName}`;
						accessUrl = storedReference;
					}
					await setLobbyUserScreenshot(lobbyId, auth.id, storedReference);
					// Relaie la preuve vers le salon des Tournament Organizers (best-effort).
					notifyProofToBot(lobbyId, auth.id, accessUrl);
					void logMatchEvent({
						type: "proof_uploaded",
						lobbyId,
						userId: auth.id,
						detail: { storage: uploaded ? "supabase-private" : "local" },
					});
					res.json({ url: accessUrl });
				} catch (err) {
					console.error("[ranked] /dispute failed", err);
					res.status(500).json({ error: "internal" });
				}
			}
		);

		// Static : sert les screenshots disputés (read-only). nosniff empeche le
		// navigateur de re-deviner le type (defense en profondeur vs le fileFilter
		// images-only) et Content-Disposition: attachment force le telechargement sur
		// navigation directe (le <img> du dashboard reste affiche, lui).
		if ((process.env.NODE_ENV ?? "development") !== "production") {
			app.use(
				"/storage/disputes",
				express.static(STORAGE_DIR, {
					setHeaders: (res) => {
						res.setHeader("X-Content-Type-Options", "nosniff");
						res.setHeader("Content-Disposition", "attachment");
					},
				})
			);
		}

		// GET /api/admin/lobbies/disputes — liste matches contestés (admin only)
		app.get("/api/admin/lobbies/disputes", async (req, res) => {
			const gate = await authorizeStaff(req, false);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				const list = await listDisputedLobbies();
				res.json(
					await Promise.all(
						list.map(async (d) => ({
							lobbyId: d.lobbyId,
							mode: d.mode,
							player1: {
								userId: d.p1.userId,
								displayName: d.p1.displayName,
								submittedScore: d.p1.score,
								claimedOpponentScore: d.p1.claimedOpponentScore,
								screenshotUrl: await resolveRankedProofUrl(d.p1.screenshotUrl),
							},
							player2: {
								userId: d.p2.userId,
								displayName: d.p2.displayName,
								submittedScore: d.p2.score,
								claimedOpponentScore: d.p2.claimedOpponentScore,
								screenshotUrl: await resolveRankedProofUrl(d.p2.screenshotUrl),
							},
							createdAt: d.createdAt,
						}))
					)
				);
			} catch (err) {
				console.error("[ranked] /admin/disputes failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// GET /api/admin/lobbies/active — matchs EN COURS (lobby 'Ongoing') avec l'état live
		// persisté (qui a saisi, scores, preuves). Modérateur+.
		app.get("/api/admin/lobbies/active", async (req, res) => {
			const gate = await authorizeStaff(req, false);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				const list = await listActiveLobbies();
				res.json(
					list.map((m) => ({
						lobbyId: m.lobbyId,
						mode: m.mode,
						createdAt: m.createdAt,
						player1: {
							userId: m.p1.userId,
							displayName: m.p1.displayName,
							score: m.p1.score,
							claimedOpponentScore: m.p1.claimedOpponentScore,
							submitted: m.p1.submitted,
							hasProof: m.p1.hasProof,
						},
						player2: {
							userId: m.p2.userId,
							displayName: m.p2.displayName,
							score: m.p2.score,
							claimedOpponentScore: m.p2.claimedOpponentScore,
							submitted: m.p2.submitted,
							hasProof: m.p2.hasProof,
						},
					}))
				);
			} catch (err) {
				console.error("[ranked] /admin/lobbies/active failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// GET /api/admin/ranked/overview — compteurs synthétiques (Modérateur+).
		app.get("/api/admin/ranked/overview", async (req, res) => {
			const gate = await authorizeStaff(req, false);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				res.json(await getRankedOverview());
			} catch (err) {
				console.error("[ranked] /admin/ranked/overview failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// POST /api/admin/lobbies/:id/validate — admin tranche
		app.post("/api/admin/lobbies/:id/validate", async (req, res) => {
			const gate = await authorizeStaff(req, true);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			const lobbyId = Number(req.params.id);
			if (!Number.isFinite(lobbyId)) {
				res.status(400).json({ error: "invalid_lobby_id" });
				return;
			}
			const body = (req.body ?? {}) as {
				scoreTeam1?: number;
				scoreTeam2?: number;
				forfeitUserId?: string;
			};
			const s1 = Math.max(0, Math.min(99, Math.floor(Number(body.scoreTeam1 ?? 0))));
			const s2 = Math.max(0, Math.min(99, Math.floor(Number(body.scoreTeam2 ?? 0))));
			try {
				// Récupère le mode + season du lobby
				const lobby = await sql<Array<{ mode: number }>>`
				SELECT mode FROM achillea.lobby WHERE id = ${lobbyId} LIMIT 1
			`;
				if (!lobby[0]) {
					res.status(404).json({ error: "not_found" });
					return;
				}
				// Un forfait ne peut viser qu'un joueur réel du lobby (sinon ignoré en silence).
				if (body.forfeitUserId) {
					const players = await sql<Array<{ user_id: string }>>`
						SELECT user_id FROM achillea.lobby_user WHERE lobby_id = ${lobbyId}
					`;
					if (!players.some((p) => p.user_id === body.forfeitUserId)) {
						res.status(400).json({ error: "forfeit_user_not_in_lobby" });
						return;
					}
				}
				const season = await getActiveSeason();
				const kFactor = season?.config?.kFactor ?? 32;
				const result = await adminResolveLobby(
					lobbyId,
					s1,
					s2,
					body.forfeitUserId,
					lobby[0].mode,
					kFactor
				);
				void logMatchEvent({
					type: "admin_validated",
					lobbyId,
					mode: lobby[0].mode,
					userId: gate.actorId,
					detail: { scoreTeam1: s1, scoreTeam2: s2, forfeitUserId: body.forfeitUserId ?? null },
				});
				// Notif temps réel des 2 joueurs (uniquement si l'arbitrage a réellement été appliqué
				// ce coup-ci — pas sur une double-validation idempotente, pour ne pas spammer).
				if (result.applied) void notifyDisputeResolved(lobbyId, false);
				res.json({ ok: true, eloDelta: result.eloDelta });
			} catch (err) {
				console.error("[ranked] /admin/validate failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// POST /api/admin/lobbies/:id/cancel — admin annule le match (AUCUN ELO appliqué)
		app.post("/api/admin/lobbies/:id/cancel", async (req, res) => {
			const gate = await authorizeStaff(req, true);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			const lobbyId = Number(req.params.id);
			if (!Number.isFinite(lobbyId)) {
				res.status(400).json({ error: "invalid_lobby_id" });
				return;
			}
			try {
				const ok = await cancelLobby(lobbyId);
				if (!ok) {
					res.status(409).json({ error: "not_cancellable" });
					return;
				}
				void logMatchEvent({ type: "admin_cancelled", lobbyId, userId: gate.actorId });
				// Notif temps réel des 2 joueurs : match annulé, aucun impact sur le rang.
				void notifyDisputeResolved(lobbyId, true);
				res.json({ ok: true });
			} catch (err) {
				console.error("[ranked] /admin/cancel failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// GET /api/admin/ranked/telemetry — journal du flow des matchs (Modérateur+)
		// Filtres optionnels : ?lobbyId= ?roomCode= ?userId= ?limit=
		app.get("/api/admin/ranked/telemetry", async (req, res) => {
			const gate = await authorizeStaff(req, false);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				const lobbyId = req.query.lobbyId ? Number(req.query.lobbyId) : null;
				const roomCode = typeof req.query.roomCode === "string" ? req.query.roomCode : null;
				const userId = typeof req.query.userId === "string" ? req.query.userId : null;
				const limit = req.query.limit ? Number(req.query.limit) : 200;
				const events = await listMatchEvents({
					lobbyId: Number.isFinite(lobbyId as number) ? lobbyId : null,
					roomCode,
					userId,
					limit,
				});
				res.json(
					events.map((e) => ({
						id: e.id,
						createdAt: e.created_at,
						lobbyId: e.lobby_id,
						roomCode: e.room_code,
						mode: e.mode,
						userId: e.user_id,
						displayName: e.display_name,
						type: e.event_type,
						detail: e.detail,
					}))
				);
			} catch (err) {
				console.error("[ranked] /admin/telemetry failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// ================================================================
		// SAISONS RANKED — administration depuis le dashboard (pilotage sans
		// coder) : créer / modifier / activer / clôturer une saison + reset
		// du ladder. Lecture Modérateur+, mutations Admin+.
		// ================================================================

		// Normalise + borne la config Elo d'une saison (jamais de valeur aberrante en base).
		const parseSeasonConfig = (raw: unknown): SeasonConfigInput => {
			const c = (raw ?? {}) as Partial<SeasonConfigInput>;
			const bound = (v: unknown, def: number, min: number, max: number): number => {
				const n = Number(v);
				return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
			};
			return {
				kFactor: Math.round(bound(c.kFactor, 32, 1, 200)),
				baseRating: Math.round(bound(c.baseRating, 0, 0, 100000)),
				decayRate: bound(c.decayRate, 0, 0, 1000),
			};
		};

		// GET /api/admin/seasons — liste des saisons (Modérateur+).
		app.get("/api/admin/seasons", async (req, res) => {
			const gate = await authorizeStaff(req, false);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				res.json(await listSeasonsAdmin());
			} catch (err) {
				console.error("[ranked] /admin/seasons list failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// POST /api/admin/seasons — crée une saison 'Upcoming' (Admin+).
		app.post("/api/admin/seasons", async (req, res) => {
			const gate = await authorizeStaff(req, true);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			const body = (req.body ?? {}) as {
				name?: string;
				startsAt?: string;
				endsAt?: string;
				config?: unknown;
			};
			const name = (body.name ?? "").trim();
			const startsAt = body.startsAt ? new Date(body.startsAt) : null;
			const endsAt = body.endsAt ? new Date(body.endsAt) : null;
			if (!name) {
				res.status(400).json({ error: "name_required" });
				return;
			}
			if (
				!startsAt ||
				Number.isNaN(startsAt.getTime()) ||
				!endsAt ||
				Number.isNaN(endsAt.getTime())
			) {
				res.status(400).json({ error: "invalid_dates" });
				return;
			}
			if (endsAt <= startsAt) {
				res.status(400).json({ error: "ends_before_starts" });
				return;
			}
			try {
				const season = await createSeasonAdmin({
					name,
					startsAt: startsAt.toISOString(),
					endsAt: endsAt.toISOString(),
					config: parseSeasonConfig(body.config),
				});
				void logMatchEvent({
					type: "admin_season_created",
					userId: gate.actorId,
					detail: { seasonId: season.id, name },
				});
				res.json(season);
			} catch (err) {
				console.error("[ranked] /admin/seasons create failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// PATCH /api/admin/seasons/:id — modifie une saison (champs partiels) (Admin+).
		app.patch("/api/admin/seasons/:id", async (req, res) => {
			const gate = await authorizeStaff(req, true);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			const body = (req.body ?? {}) as {
				name?: string;
				startsAt?: string;
				endsAt?: string;
				state?: string;
				config?: unknown;
			};
			const patch: {
				name?: string;
				startsAt?: string;
				endsAt?: string;
				state?: SeasonStateValue;
				config?: SeasonConfigInput;
			} = {};
			if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
			if (body.startsAt) {
				const d = new Date(body.startsAt);
				if (!Number.isNaN(d.getTime())) patch.startsAt = d.toISOString();
			}
			if (body.endsAt) {
				const d = new Date(body.endsAt);
				if (!Number.isNaN(d.getTime())) patch.endsAt = d.toISOString();
			}
			if (typeof body.state === "string") {
				if (!SEASON_STATES.includes(body.state as SeasonStateValue)) {
					res.status(400).json({ error: "invalid_state" });
					return;
				}
				patch.state = body.state as SeasonStateValue;
			}
			if (body.config !== undefined) patch.config = parseSeasonConfig(body.config);
			try {
				const season = await updateSeasonAdmin(req.params.id, patch);
				if (!season) {
					res.status(404).json({ error: "not_found" });
					return;
				}
				void logMatchEvent({
					type: "admin_season_updated",
					userId: gate.actorId,
					detail: { seasonId: req.params.id },
				});
				res.json(season);
			} catch (err) {
				console.error("[ranked] /admin/seasons update failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// POST /api/admin/seasons/:id/activate — active la saison (clôt l'active courante) (Admin+).
		app.post("/api/admin/seasons/:id/activate", async (req, res) => {
			const gate = await authorizeStaff(req, true);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				const season = await activateSeasonAdmin(req.params.id);
				if (!season) {
					res.status(404).json({ error: "not_found" });
					return;
				}
				void logMatchEvent({
					type: "admin_season_activated",
					userId: gate.actorId,
					detail: { seasonId: season.id },
				});
				res.json(season);
			} catch (err) {
				console.error("[ranked] /admin/seasons activate failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// POST /api/admin/seasons/:id/reset — reset du ladder à la baseRating de la saison (Admin+).
		app.post("/api/admin/seasons/:id/reset", async (req, res) => {
			const gate = await authorizeStaff(req, true);
			if (!gate.ok) {
				res.status(gate.status).json({ error: gate.error });
				return;
			}
			try {
				const affected = await resetLadderForSeason(req.params.id);
				if (affected === null) {
					res.status(404).json({ error: "not_found" });
					return;
				}
				void logMatchEvent({
					type: "admin_ladder_reset",
					userId: gate.actorId,
					detail: { seasonId: req.params.id, affected },
				});
				res.json({ ok: true, affected });
			} catch (err) {
				console.error("[ranked] /admin/seasons reset failed", err);
				res.status(500).json({ error: "internal" });
			}
		});

		// FALLBACK PROXY : tout /api/* non géré par les handlers ci-dessus est
		// proxifié vers le bot TSed local (port :4000) qui expose les controllers
		// historiques (tournaments, clans, users/:id, notifications, etc.).
		// MUST être ajouté APRÈS tous les routes ranked spécifiques.
		const BOT_API_PORT = process.env.API_PORT ?? "4000";
		// Le bot TSed monte ses controllers sur `/` (pas `/api`). Le proxy
		// reçoit la requête sur `/api/...` (path déjà stripé du préfixe par
		// app.use("/api", ...)), il faut donc juste forwarder tel quel —
		// path-rewrite par défaut conserve le path après le mount prefix.
		app.use(
			"/api",
			createProxyMiddleware<express.Request, express.Response>({
				target: `http://127.0.0.1:${BOT_API_PORT}`,
				changeOrigin: true,
				on: {
					// express.json() above consumes the incoming stream. Re-emit the
					// parsed payload for the upstream; otherwise Bun's compatibility
					// layer tries to read an object/string as a ReadableStream.
					proxyReq: (proxyReq, req) => {
						if (!req.body || typeof req.body !== "object") return;
						const body = JSON.stringify(req.body);
						proxyReq.setHeader("content-type", "application/json");
						proxyReq.setHeader("content-length", Buffer.byteLength(body));
						proxyReq.write(body);
					},
					error: (err, _req, res) => {
						console.error("[ranked] bot proxy error:", err.message);
						// `headersSent` n'est pas fiable sur la réponse Bun/express du proxy
						// (il reste `false` alors que les en-têtes sont partis) : sans le
						// try/catch, chaque erreur amont produisait un second log parasite
						// « writeHead: headers were already sent. ».
						if (!res || !("writeHead" in res) || res.headersSent || res.writableEnded) return;
						try {
							res.writeHead(502, { "content-type": "application/json" });
							res.end(JSON.stringify({ error: "bot_unavailable" }));
						} catch {
							// réponse déjà engagée — rien à faire de plus
						}
					},
				},
			})
		);

		// Error-handler TERMINAL (4 args) — DOIT être le dernier middleware. Sans lui, une
		// erreur de body-parser/raw-body (ex. POST /dispute avec une image trop lourde →
		// 413 « entity.too.large ») remonte NON RATTRAPÉE jusqu'au fetch de Bun.serve
		// (BunWebSockets) → la requête ne reçoit jamais de réponse propre et l'upload reste
		// figé côté front (le « crash » ressenti). On la convertit en réponse JSON propre.
		app.use(
			(err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
				const e = err as { status?: number; statusCode?: number; type?: string } | null;
				const status = Number(e?.status ?? e?.statusCode) || 500;
				const tooLarge = e?.type === "entity.too.large" || status === 413;
				console.error("[ranked] requête en erreur (body-parser/middleware)", err);
				if (res.headersSent) return;
				res
					.status(tooLarge ? 413 : status >= 400 && status < 600 ? status : 500)
					.json({ error: tooLarge ? "too_large" : "bad_request" });
			}
		);
	},
});

// Filets de sécurité du sous-process ranked : une requête malformée (ex. la lib
// @colyseus/bun-websockets fait `new URL(req.url)` qui throw sur un req.url == "/" sans
// Host — sonde/scan direct du port) ne doit JAMAIS faire tomber le process ni polluer les
// logs d'une stack non gérée. On trace et on continue (le process reste up).
process.on("unhandledRejection", (reason) => {
	console.error("[ranked] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
	console.error("[ranked] uncaughtException", err);
});

await server.listen(PORT, HOST);
console.info(
	`[ranked] Colyseus server listening on ${HOST}:${PORT} (origins=${ALLOWED_ORIGINS.join(",")})`
);

// Nettoyage périodique des lobbies abandonnés (Ongoing >24h jamais finalisés) — préserve Contested.
const runLobbyCleanup = async () => {
	try {
		const n = await cleanupStaleOngoingLobbies(24);
		if (n > 0) console.info(`[ranked] ${n} lobby(s) Ongoing abandonné(s) annulé(s)`);
	} catch (err) {
		console.error("[ranked] cleanup lobbies failed", err);
	}
};
void runLobbyCleanup();
setInterval(() => void runLobbyCleanup(), 4 * 60 * 60 * 1000);
