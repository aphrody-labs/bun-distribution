import {
	BodyParams,
	Context,
	Controller,
	Get,
	Patch,
	PathParams,
	Post,
	QueryParams,
	Res,
	UseBefore,
} from "@tsed/common";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@tsed/exceptions";
import { Default, Maximum, Minimum } from "@tsed/schema";
import type { Response } from "express";

import { CookieAuthorize } from "@/api/middlewares";
import { CastAttribution, CastAvailability, CastEvent, CastSlot, User } from "@/entities";
import { CastService, Database, UserService } from "@/services";
import { BaseController } from "@/utils/classes";
import {
	CastAvailabilityStatus,
	CastEventKind,
	CastEventStatus,
	CastSlotRole,
	UserRole,
} from "@/utils/enums";
import { resolveDependenciesSync } from "@/utils/functions";

// =============================================================================
// Corps des requêtes
// =============================================================================

interface CreateEventBody {
	name: string;
	kind: CastEventKind;
	scheduledAt: string;
	duration?: number;
	tournamentId?: string | null;
	twitchUrl?: string | null;
	description?: string | null;
	slots: Array<{ role: CastSlotRole; required?: boolean }>;
}

interface OpenSurveyBody {
	casterPool: string[];
}

interface RecordAvailabilityBody {
	status: CastAvailabilityStatus;
	preferredRoles?: CastSlotRole[] | null;
}

interface AutoAssignBody {
	maxSlotsPerCaster?: number;
}

interface SwapBody {
	newCasterId: string;
}

// =============================================================================
// Contrôleur
// =============================================================================

/**
 * CastsController — T-2.3
 *
 * Endpoints REST pour la cellule cast :
 *   - gestion des CastEvent (CRUD partiel)
 *   - sondage disponibilités
 *   - auto-assignation et swap
 *   - confirmation d'attribution
 *   - vitrine publique des casters
 *
 * Rôle sub-CP cast : en l'absence de rôle dédié dans UserRole,
 * Administrator est utilisé comme proxy (proxy documenté ici — à remplacer
 * si un rôle CastSubCP est introduit dans une future migration T-3.x).
 */
@Controller("/casts")
export class CastsController extends BaseController {
	private castService: CastService;
	private db: Database;
	private userService: UserService;

	constructor() {
		super();
		[this.castService, this.db, this.userService] = resolveDependenciesSync([
			CastService,
			Database,
			UserService,
		]);
	}

	// ---------------------------------------------------------------------------
	// GET /casts/events
	// ---------------------------------------------------------------------------

	/**
	 * Liste paginée des CastEvent avec filtres optionnels.
	 */
	@Get("/events")
	@UseBefore(CookieAuthorize)
	async listEvents(
		@QueryParams("status") status: CastEventStatus | undefined,
		@QueryParams("from") from: string | undefined,
		@QueryParams("to") to: string | undefined,
		@QueryParams("page") @Default(1) @Minimum(1) page: number,
		@QueryParams("pageSize") @Default(25) @Minimum(1) @Maximum(100) pageSize: number,
		@Res() res: Response
	) {
		const em = this.db.em.fork();

		const where: Record<string, unknown> = {};
		if (status) where["status"] = status;
		if (from || to) {
			where["scheduledAt"] = {};
			if (from) (where["scheduledAt"] as Record<string, unknown>)["$gte"] = new Date(from);
			if (to) (where["scheduledAt"] as Record<string, unknown>)["$lte"] = new Date(to);
		}

		const [items, total] = await em.findAndCount(CastEvent, where, {
			orderBy: { scheduledAt: "ASC" },
			limit: pageSize,
			offset: (page - 1) * pageSize,
		});

		return res.status(200).json({
			data: items,
			total,
			meta: { page, pageSize, pageCount: Math.ceil(total / pageSize) },
		});
	}

	// ---------------------------------------------------------------------------
	// GET /casts/events/:id
	// ---------------------------------------------------------------------------

	/**
	 * Détail d'un CastEvent : slots, attributions, checklist.
	 */
	@Get("/events/:id")
	@UseBefore(CookieAuthorize)
	async getEvent(@PathParams("id") id: string, @Res() res: Response) {
		const em = this.db.em.fork();

		const event = await em.findOne(CastEvent, { id });
		if (!event) throw new NotFound(`CastEvent ${id} introuvable`);

		const slots = await em.find(CastSlot, { event: { id } });
		const attributions = await em.find(
			CastAttribution,
			{ slot: { event: { id } } },
			{ populate: ["slot"] }
		);
		const checklist = await this.castService.getEventChecklist(id);

		return res.status(200).json({ event, slots, attributions, checklist });
	}

	// ---------------------------------------------------------------------------
	// POST /casts/events
	// ---------------------------------------------------------------------------

	/**
	 * Créer un CastEvent. Auth : Administrator (proxy sub-CP cast).
	 */
	@Post("/events")
	@UseBefore(CookieAuthorize)
	async createEvent(
		@BodyParams() body: CreateEventBody,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = ctx.get("user");
		if (!user) throw new Unauthorized("Non authentifié");
		if ((user.role ?? 0) < UserRole.Administrator) {
			throw new Forbidden("Réservé aux administrateurs (sub-CP cast)");
		}

		if (!body.name || !body.kind || !body.scheduledAt) {
			throw new BadRequest("name, kind et scheduledAt sont requis");
		}

		if (!Object.values(CastEventKind).includes(body.kind)) {
			throw new BadRequest(`kind invalide : ${body.kind}`);
		}

		if (!Array.isArray(body.slots) || body.slots.length === 0) {
			throw new BadRequest("Au moins un slot est requis");
		}

		for (const slot of body.slots) {
			if (!Object.values(CastSlotRole).includes(slot.role)) {
				throw new BadRequest(`Rôle de slot invalide : ${slot.role}`);
			}
		}

		const event = await this.castService.createEvent({
			name: body.name,
			kind: body.kind,
			scheduledAt: new Date(body.scheduledAt),
			duration: body.duration,
			tournamentId: body.tournamentId ?? null,
			twitchUrl: body.twitchUrl ?? null,
			description: body.description ?? null,
			createdBy: user.id,
			slots: body.slots,
		});

		return res.status(201).json(event);
	}

	// ---------------------------------------------------------------------------
	// POST /casts/events/:id/survey
	// ---------------------------------------------------------------------------

	/**
	 * Ouvre le sondage de disponibilités. Auth : Administrator (proxy sub-CP cast).
	 */
	@Post("/events/:id/survey")
	@UseBefore(CookieAuthorize)
	async openSurvey(
		@PathParams("id") id: string,
		@BodyParams() body: OpenSurveyBody,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = ctx.get("user");
		if (!user) throw new Unauthorized("Non authentifié");
		if ((user.role ?? 0) < UserRole.Administrator) {
			throw new Forbidden("Réservé aux administrateurs (sub-CP cast)");
		}

		const em = this.db.em.fork();
		const event = await em.findOne(CastEvent, { id });
		if (!event) throw new NotFound(`CastEvent ${id} introuvable`);

		if (!Array.isArray(body.casterPool) || body.casterPool.length === 0) {
			throw new BadRequest("casterPool doit contenir au moins un identifiant");
		}

		await this.castService.openSurvey(id, body.casterPool);

		return res.status(200).json({ success: true, eventId: id, poolSize: body.casterPool.length });
	}

	// ---------------------------------------------------------------------------
	// POST /casts/events/:id/availability
	// ---------------------------------------------------------------------------

	/**
	 * Enregistre la disponibilité du caster connecté. Auth : caster lui-même.
	 */
	@Post("/events/:id/availability")
	@UseBefore(CookieAuthorize)
	async recordAvailability(
		@PathParams("id") eventId: string,
		@BodyParams() body: RecordAvailabilityBody,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = ctx.get("user");
		if (!user) throw new Unauthorized("Non authentifié");

		if (!body.status || !Object.values(CastAvailabilityStatus).includes(body.status)) {
			throw new BadRequest(
				`status invalide. Valeurs acceptées : ${Object.values(CastAvailabilityStatus).join(", ")}`
			);
		}

		if (body.preferredRoles) {
			for (const r of body.preferredRoles) {
				if (!Object.values(CastSlotRole).includes(r)) {
					throw new BadRequest(`Rôle préféré invalide : ${r}`);
				}
			}
		}

		const em = this.db.em.fork();
		const event = await em.findOne(CastEvent, { id: eventId });
		if (!event) throw new NotFound(`CastEvent ${eventId} introuvable`);

		const avail = await this.castService.recordAvailability(
			user.id,
			eventId,
			body.status,
			body.preferredRoles ?? null
		);

		return res.status(200).json(avail);
	}

	// ---------------------------------------------------------------------------
	// POST /casts/events/:id/auto-assign
	// ---------------------------------------------------------------------------

	/**
	 * Lance l'auto-assignation. Auth : Administrator (proxy sub-CP cast).
	 */
	@Post("/events/:id/auto-assign")
	@UseBefore(CookieAuthorize)
	async autoAssign(
		@PathParams("id") id: string,
		@BodyParams() body: AutoAssignBody,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = ctx.get("user");
		if (!user) throw new Unauthorized("Non authentifié");
		if ((user.role ?? 0) < UserRole.Administrator) {
			throw new Forbidden("Réservé aux administrateurs (sub-CP cast)");
		}

		const em = this.db.em.fork();
		const event = await em.findOne(CastEvent, { id });
		if (!event) throw new NotFound(`CastEvent ${id} introuvable`);

		const attributions = await this.castService.autoAssign(id, {
			maxSlotsPerCaster: body.maxSlotsPerCaster,
		});

		return res.status(200).json({
			created: attributions.length,
			attributions,
		});
	}

	// ---------------------------------------------------------------------------
	// PATCH /casts/attributions/:id
	// ---------------------------------------------------------------------------

	/**
	 * Swap le caster sur une attribution. Auth : Administrator (proxy sub-CP cast).
	 * Note : le paramètre `id` reçu dans l'URL est l'attribution.id (UUID),
	 * et CastService.swap attend un slotId. On charge l'attribution pour récupérer slot.id.
	 */
	@Patch("/attributions/:id")
	@UseBefore(CookieAuthorize)
	async swap(
		@PathParams("id") attributionId: string,
		@BodyParams() body: SwapBody,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = ctx.get("user");
		if (!user) throw new Unauthorized("Non authentifié");
		if ((user.role ?? 0) < UserRole.Administrator) {
			throw new Forbidden("Réservé aux administrateurs (sub-CP cast)");
		}

		if (!body.newCasterId) {
			throw new BadRequest("newCasterId est requis");
		}

		const em = this.db.em.fork();
		const attribution = await em.findOne(
			CastAttribution,
			{ id: attributionId },
			{ populate: ["slot"] }
		);
		if (!attribution) throw new NotFound(`CastAttribution ${attributionId} introuvable`);

		const updated = await this.castService.swap(attribution.slot.id, body.newCasterId, user.id);

		return res.status(200).json(updated);
	}

	// ---------------------------------------------------------------------------
	// POST /casts/attributions/:id/confirm
	// ---------------------------------------------------------------------------

	/**
	 * Confirmation par le caster assigné. Auth : caster lui-même (vérifié dans CastService).
	 */
	@Post("/attributions/:id/confirm")
	@UseBefore(CookieAuthorize)
	async confirm(
		@PathParams("id") attributionId: string,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const user = ctx.get("user");
		if (!user) throw new Unauthorized("Non authentifié");

		const em = this.db.em.fork();
		const attribution = await em.findOne(CastAttribution, { id: attributionId });
		if (!attribution) throw new NotFound(`CastAttribution ${attributionId} introuvable`);

		if (attribution.userId !== user.id) {
			throw new Forbidden("Seul le caster assigné peut confirmer cette attribution");
		}

		const updated = await this.castService.confirmAttribution(attributionId, user.id);

		return res.status(200).json(updated);
	}

	// ---------------------------------------------------------------------------
	// GET /casts/casters — vitrine publique (sans auth)
	// ---------------------------------------------------------------------------

	/**
	 * Retourne la liste des casters ayant au moins une disponibilité ou attribution.
	 * Endpoint public (pas de CookieAuthorize).
	 */
	@Get("/casters")
	async listCasters(@Res() res: Response) {
		const em = this.db.em.fork();

		// Casters avec au moins une CastAvailability
		const availabilities = await em.find(CastAvailability, {});
		const attributions = await em.find(CastAttribution, { userId: { $ne: null } });

		// Union des userId
		const userIds = new Set<string>([
			...availabilities.map((a) => a.userId),
			...attributions.map((a) => a.userId as string),
		]);

		// Fenêtre "récents" : 30 derniers jours
		const recentWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

		const casters = await Promise.all(
			[...userIds].map(async (userId) => {
				const recentCasts = await em.count(CastAttribution, {
					userId,
					assignedAt: { $gte: recentWindow },
				});

				// Récupérer les infos Discord via UserService
				let displayName = userId;
				let avatar: string | null = null;
				let bio: string | null = null;
				let twitchUrl: string | null = null;

				try {
					const dto = await this.userService.getUserDTO(userId);
					displayName = dto.username ?? userId;
					avatar = dto.avatar ?? null;
				} catch {
					// user Discord inconnu — on retourne l'id comme fallback
				}

				const userRow = await em.findOne(User, { id: userId });
				if (userRow) {
					bio = userRow.bio;
					twitchUrl = userRow.twitchUrl;
				}

				return {
					id: userId,
					displayName,
					avatar,
					bio,
					twitchUrl,
					recentCasts,
				};
			})
		);

		// Trier par nombre de casts récents décroissant
		casters.sort((a, b) => b.recentCasts - a.recentCasts);

		return res.status(200).json(casters);
	}
}
