import { singleton } from "tsyringe";
import { compareCastCandidates } from "@rosegriffon/achillea-core";

import { CastAttribution, CastAvailability, CastEvent, CastSlot } from "@/entities";
import {
	CastAvailabilityStatus,
	CastEventKind,
	CastEventStatus,
	CastSlotRole,
} from "@/utils/enums";

import { Database } from "./Database";
import { MetricsService } from "./MetricsService";

export interface CreateEventOpts {
	name: string;
	kind: CastEventKind;
	scheduledAt: Date;
	duration?: number;
	tournamentId?: string | null;
	twitchUrl?: string | null;
	description?: string | null;
	createdBy: string;
	slots: Array<{ role: CastSlotRole; required?: boolean }>;
}

export interface AutoAssignOpts {
	/** Plafond anti-saturation : un caster ne peut pas avoir plus de N attributions
	 *  sur les 7 derniers jours.  Défaut : 3. */
	maxSlotsPerCaster?: number;
}

export interface ChecklistItem {
	slot: CastSlot;
	attribution: CastAttribution | null;
	casterId: string | null;
	confirmed: boolean;
}

// Poids de scoring et décision de tri : @rosegriffon/achillea-core/casts.
const SCORE_BINOME_BONUS = 8;

/** Fenêtre anti-saturation en jours. */
const RECENT_CAST_WINDOW_DAYS = 7;

/**
 * CastService — T-2.2
 *
 * Gestion du cycle de vie des CastEvent :
 *   création → sondage disponibilités → auto-attribution → swap → confirmation.
 *
 * Toutes les méthodes utilisent `this.db.em.fork()` pour l'isolation par appel
 * (pattern Mikro-ORM recommandé hors requête HTTP).
 */
@singleton()
export class CastService {
	constructor(
		private db: Database,
		private metrics: MetricsService
	) {}

	// createEvent

	/**
	 * Crée un CastEvent ainsi que les CastSlot associés dans la même transaction.
	 */
	async createEvent(opts: CreateEventOpts): Promise<CastEvent> {
		const em = this.db.em.fork();

		return em.transactional(async (txEm) => {
			const now = new Date();
			const event = txEm.create(CastEvent, {
				name: opts.name,
				kind: opts.kind,
				scheduledAt: opts.scheduledAt,
				duration: opts.duration ?? 60,
				tournamentId: opts.tournamentId ?? null,
				twitchUrl: opts.twitchUrl ?? null,
				description: opts.description ?? null,
				createdBy: opts.createdBy,
				status: CastEventStatus.Planned,
				createdAt: now,
				updatedAt: now,
			});

			txEm.persist(event);

			for (const slotOpts of opts.slots) {
				const slot = txEm.create(CastSlot, {
					event,
					role: slotOpts.role,
					required: slotOpts.required ?? true,
				});
				txEm.persist(slot);
			}

			return event;
		});
	}

	// openSurvey

	/**
	 * Pour chaque user_id du pool, crée une CastAvailability avec status = unavailable
	 * (statut neutre initial). Idempotent : skip si déjà existante pour (userId, event).
	 *
	 * Met aussi le statut de l'event à OpenSignup.
	 */
	async openSurvey(eventId: string, casterPool: string[]): Promise<void> {
		const em = this.db.em.fork();

		const event = await em.findOneOrFail(CastEvent, { id: eventId });

		for (const userId of casterPool) {
			const existing = await em.findOne(CastAvailability, {
				userId,
				event: { id: eventId },
			});

			if (existing) continue;

			const avail = em.create(CastAvailability, {
				userId,
				event,
				status: CastAvailabilityStatus.Unavailable,
				declaredAt: new Date(),
			});
			em.persist(avail);
		}

		// Passer l'event en OpenSignup si ce n'est pas déjà le cas
		if (event.status === CastEventStatus.Planned) {
			event.status = CastEventStatus.OpenSignup;
		}

		await em.flush();
	}

	// recordAvailability

	/**
	 * Upsert : met à jour la disponibilité d'un caster pour un event.
	 * Met à jour declaredAt à chaque appel.
	 */
	async recordAvailability(
		userId: string,
		eventId: string,
		status: CastAvailabilityStatus,
		preferredRoles?: CastSlotRole[] | null
	): Promise<CastAvailability> {
		const em = this.db.em.fork();

		const event = await em.findOneOrFail(CastEvent, { id: eventId });

		let avail = await em.findOne(CastAvailability, {
			userId,
			event: { id: eventId },
		});

		if (avail) {
			avail.status = status;
			avail.declaredAt = new Date();
			if (preferredRoles !== undefined) avail.preferredRoles = preferredRoles ?? null;
		} else {
			avail = em.create(CastAvailability, {
				userId,
				event,
				status,
				preferredRoles: preferredRoles ?? null,
				declaredAt: new Date(),
			});
			em.persist(avail);
		}

		await em.flush();
		return avail;
	}

	// autoAssign

	/**
	 * Algorithme d'attribution automatique (MVP — à affiner post-prod).
	 *
	 * Scoring par candidat pour chaque slot non attribué :
	 *   +SCORE_PREFERRED_ROLE  si le rôle est dans preferredRoles
	 *   +SCORE_AVAILABILITY_YES si status === available (vs maybe)
	 *   -SCORE_RECENT_CAST_PENALTY * nbCastsRécents (7 jours, plafond maxSlotsPerCaster)
	 *   +SCORE_BINOME_BONUS si le candidat a un historique commun avec un caster
	 *                        déjà assigné sur cet event (comptage attributions partagées
	 *                        sur events passés — approche MVP)
	 *
	 * Retourne les CastAttribution créées (assignedBy = 'system', confirmedAt = null).
	 */
	async autoAssign(eventId: string, opts?: AutoAssignOpts): Promise<CastAttribution[]> {
		const maxSlots = opts?.maxSlotsPerCaster ?? 3; // plafond anti-saturation (à ajuster)
		const em = this.db.em.fork();

		// 1. Charger les slots de l'event sans attribution ou avec userId null
		const allSlots = await em.find(CastSlot, { event: { id: eventId } }, { populate: ["event"] });

		const existingAttributions = await em.find(
			CastAttribution,
			{ slot: { event: { id: eventId } } },
			{ populate: ["slot"] }
		);

		const assignedSlotIds = new Set(
			existingAttributions.filter((a) => a.userId !== null).map((a) => a.slot.id)
		);

		const unassignedSlots = allSlots.filter((s) => !assignedSlotIds.has(s.id));
		if (unassignedSlots.length === 0) return [];

		// 2. Charger les disponibilités available + maybe pour cet event
		const availabilities = await em.find(CastAvailability, {
			event: { id: eventId },
			status: { $in: [CastAvailabilityStatus.Available, CastAvailabilityStatus.Maybe] },
		});

		if (availabilities.length === 0) return [];

		// 3. Compter les attributions récentes par caster (anti-saturation)
		const windowStart = new Date(Date.now() - RECENT_CAST_WINDOW_DAYS * 24 * 60 * 60 * 1000);

		// Cast récents pour tous les casters du pool
		const candidateIds = [...new Set(availabilities.map((a) => a.userId))];

		const recentCountMap = new Map<string, number>();
		for (const candidateId of candidateIds) {
			const count = await em.count(CastAttribution, {
				userId: candidateId,
				assignedAt: { $gte: windowStart },
			});
			recentCountMap.set(candidateId, count);
		}

		// 4. Casters déjà assignés sur cet event (pour bonus binôme)
		const alreadyAssignedOnEvent: string[] = existingAttributions
			.filter((a) => a.userId !== null)
			.map((a) => a.userId as string);

		// Map userId → nb events communs avec chaque caster déjà assigné (bonus binôme)
		// MVP : on compte les attributions sur les events où les deux casters ont été assignés.
		// Requête basée sur sous-sélection d'event_ids partagés.
		const binomeScoreMap = new Map<string, number>();

		if (alreadyAssignedOnEvent.length > 0) {
			for (const candidateId of candidateIds) {
				let binomeScore = 0;
				for (const existingCaster of alreadyAssignedOnEvent) {
					// Nombre d'events passés où les deux ont été co-assignés
					// On requête via COUNT sur CastAttribution avec un sous-ensemble :
					// events où existingCaster a une attribution → parmi eux, combien le candidat aussi
					const sharedCount = await em.getConnection().execute<Array<{ count: string }>>(
						`
              SELECT COUNT(DISTINCT a1.slot_id) AS count
              FROM cast_attribution a1
              JOIN cast_slot s1 ON s1.id = a1.slot_id
              JOIN cast_attribution a2 ON a2.user_id = $1
              JOIN cast_slot s2 ON s2.id = a2.slot_id AND s2.event_id = s1.event_id
              WHERE a1.user_id = $2
                AND s1.event_id != $3
              `,
						[candidateId, existingCaster, eventId]
					);

					const count = parseInt(sharedCount[0]?.count ?? "0", 10);
					if (count > 0) binomeScore += SCORE_BINOME_BONUS;
				}
				binomeScoreMap.set(candidateId, binomeScore);
			}
		}

		// 5. Attribution greedy : pour chaque slot, trouver le meilleur candidat disponible
		const created: CastAttribution[] = [];
		// Casters déjà utilisés dans cette passe (éviter double-attribution même slot)
		const usedInThisRun = new Set<string>();

		for (const slot of unassignedSlots) {
			const candidates = availabilities.filter((a) => {
				const recentCount = recentCountMap.get(a.userId) ?? 0;
				// Exclure si plafond atteint
				if (recentCount >= maxSlots) return false;
				// Exclure si déjà assigné dans cette passe
				if (usedInThisRun.has(a.userId)) return false;
				return true;
			});

			if (candidates.length === 0) continue;

			// Calcul des scores
			const scored = candidates.map((avail) => ({ avail }));

			// Trier par score décroissant, puis alphabétique sur userId pour déterminisme
			scored.sort((a, b) => compareCastCandidates(
				{
					userId: a.avail.userId,
					status: a.avail.status,
					preferredRoles: a.avail.preferredRoles,
					recentAssignments: recentCountMap.get(a.avail.userId) ?? 0,
					binomeBonus: binomeScoreMap.get(a.avail.userId) ?? 0,
				},
				{
					userId: b.avail.userId,
					status: b.avail.status,
					preferredRoles: b.avail.preferredRoles,
					recentAssignments: recentCountMap.get(b.avail.userId) ?? 0,
					binomeBonus: binomeScoreMap.get(b.avail.userId) ?? 0,
				},
				slot.role,
			));

			const winner = scored[0];
			if (!winner) continue;

			const attribution = em.create(CastAttribution, {
				slot,
				userId: winner.avail.userId,
				assignedBy: "system",
				confirmedAt: null,
				assignedAt: new Date(),
				notifiedJ2: false,
				notifiedH2: false,
			});
			em.persist(attribution);
			created.push(attribution);
			usedInThisRun.add(winner.avail.userId);

			// Incrémenter le compteur récent en mémoire pour la prochaine itération
			const prev = recentCountMap.get(winner.avail.userId) ?? 0;
			recentCountMap.set(winner.avail.userId, prev + 1);
		}

		if (created.length > 0) {
			await em.flush();

			// Passer l'event en Attributed si tous les slots requis sont pourvus
			const event = await em.findOneOrFail(CastEvent, { id: eventId });
			const requiredSlots = allSlots.filter((s) => s.required);
			const allAttributions = await em.find(CastAttribution, {
				slot: { event: { id: eventId } },
				userId: { $ne: null },
			});
			const assignedSlotIdsAfter = new Set(allAttributions.map((a) => a.slot.id));
			const allRequiredCovered = requiredSlots.every((s) => assignedSlotIdsAfter.has(s.id));
			if (allRequiredCovered) {
				event.status = CastEventStatus.Attributed;
				await em.flush();
			}
		}

		for (const attribution of created) {
			const kind = attribution.slot?.event?.kind ?? "unknown";
			this.metrics.increment("achillea_casts_attributed_total", { eventType: kind });
		}

		return created;
	}

	// swap

	/**
	 * Change le caster sur une attribution existante.
	 * Reset confirmedAt → null (la confirmation doit être refaite).
	 * Le subscriber AuditLogSubscriber loggue le changement automatiquement.
	 */
	async swap(slotId: string, newCasterId: string, swappedBy: string): Promise<CastAttribution> {
		const em = this.db.em.fork();

		const attribution = await em.findOneOrFail(
			CastAttribution,
			{ slot: { id: slotId } },
			{ populate: ["slot"] }
		);

		attribution.userId = newCasterId;
		attribution.confirmedAt = null;
		attribution.assignedBy = swappedBy;
		attribution.assignedAt = new Date();

		await em.flush();
		return attribution;
	}

	// confirmAttribution

	/**
	 * Confirme une attribution : vérifie que casterId === attribution.userId,
	 * puis set confirmedAt = now().
	 */
	async confirmAttribution(attributionId: string, casterId: string): Promise<CastAttribution> {
		const em = this.db.em.fork();

		const attribution = await em.findOneOrFail(CastAttribution, { id: attributionId });

		if (attribution.userId !== casterId) {
			throw new Error(
				`confirmAttribution: casterId mismatch — expected ${attribution.userId}, got ${casterId}`
			);
		}

		attribution.confirmedAt = new Date();
		await em.flush();
		return attribution;
	}

	// getEventChecklist

	/**
	 * Vue agrégée pour Discord embed / UI admin.
	 * Retourne la liste des slots avec leur attribution courante et statut de confirmation.
	 */
	async getEventChecklist(eventId: string): Promise<ChecklistItem[]> {
		const em = this.db.em.fork();

		const slots = await em.find(CastSlot, { event: { id: eventId } }, { populate: ["event"] });

		const attributions = await em.find(
			CastAttribution,
			{ slot: { event: { id: eventId } } },
			{ populate: ["slot"] }
		);

		const attributionBySlotId = new Map<string, CastAttribution>();
		for (const attr of attributions) {
			attributionBySlotId.set(attr.slot.id, attr);
		}

		return slots.map((slot) => {
			const attribution = attributionBySlotId.get(slot.id) ?? null;
			return {
				slot,
				attribution,
				casterId: attribution?.userId ?? null,
				confirmed: attribution?.confirmedAt !== null && attribution?.confirmedAt !== undefined,
			};
		});
	}
}
