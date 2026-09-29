import type { ChangeSet, EventSubscriber, FlushEventArgs } from "@mikro-orm/core";
import { ChangeSetType } from "@mikro-orm/core";
import { container } from "tsyringe";

import type {
	CastAttribution,
	CastAvailability,
	CastEvent,
	CastSlot,
	Clan,
	License,
	Organization,
	Ruleset,
	Sanction,
	Season,
	Tournament,
	TournamentPhase,
	Transaction,
	User,
	Wallet,
} from "@/entities";

import { AuditLogService } from "./AuditLogService";

// Sensitive entity class names — any write to these is auto-logged
const SENSITIVE_ENTITY_NAMES = [
	"User",
	"Tournament",
	"Organization",
	"Clan",
	"Sanction",
	"CastEvent",
	"CastSlot",
	"CastAvailability",
	"CastAttribution",
	"Ruleset",
	"License",
	"TournamentPhase",
	"Season",
	"Wallet",
	"Transaction",
] as const;

type SensitiveEntity =
	| User
	| Tournament
	| Organization
	| Clan
	| Sanction
	| CastEvent
	| CastSlot
	| CastAvailability
	| CastAttribution
	| Ruleset
	| License
	| TournamentPhase
	| Season
	| Wallet
	| Transaction;

function isSensitive(obj: object): obj is SensitiveEntity {
	return SENSITIVE_ENTITY_NAMES.includes(obj.constructor.name as any);
}

function changeSetTypeToAction(type: ChangeSetType): string {
	switch (type) {
		case ChangeSetType.CREATE:
			return "entity.create";
		case ChangeSetType.UPDATE:
			return "entity.update";
		case ChangeSetType.DELETE:
			return "entity.delete";
		case ChangeSetType.UPDATE_EARLY:
			return "entity.update_early";
		case ChangeSetType.DELETE_EARLY:
			return "entity.delete_early";
		default:
			return "entity.unknown";
	}
}

function getEntityName(entity: SensitiveEntity): string {
	return entity.constructor.name;
}

function getEntityId(entity: SensitiveEntity): string | null {
	const record = entity as unknown as Record<string, unknown>;
	const pk = record["id"];
	if (pk === undefined || pk === null) return null;
	return String(pk);
}

/**
 * Mikro-ORM EventSubscriber that auto-logs writes to sensitive entities.
 *
 * Registered via `subscribers: [new AuditLogSubscriber()]` in mikroORMConfig.
 * AuditLogService is resolved from the DI container (not constructor-injected)
 * to avoid circular dependency issues at boot time.
 *
 * IMPORTANT: Never call em.flush() inside a hook — use args.uow.computeChangeSet()
 * to register the new AuditLog record within the same Unit of Work.
 */
export class AuditLogSubscriber implements EventSubscriber {
	async onFlush(args: FlushEventArgs): Promise<void> {
		const changeSets = args.uow.getChangeSets() as ChangeSet<object>[];

		const relevantChangeSets = changeSets.filter(
			(cs) =>
				isSensitive(cs.entity) &&
				(cs.type === ChangeSetType.CREATE ||
					cs.type === ChangeSetType.UPDATE ||
					cs.type === ChangeSetType.DELETE ||
					cs.type === ChangeSetType.UPDATE_EARLY ||
					cs.type === ChangeSetType.DELETE_EARLY)
		);

		if (relevantChangeSets.length === 0) return;

		// Resolve AuditLogService lazily to avoid DI boot-order issues
		let auditLogService: AuditLogService;
		try {
			auditLogService = container.resolve(AuditLogService);
		} catch {
			// If DI not yet bootstrapped (e.g. during migrations), skip
			return;
		}

		for (const cs of relevantChangeSets) {
			const entity = cs.entity as SensitiveEntity;
			const targetType = getEntityName(entity);
			const targetId = getEntityId(entity);
			const action = changeSetTypeToAction(cs.type);

			// Build payload from changeset — only the changed properties
			const payload: Record<string, unknown> = {};
			if (cs.payload && Object.keys(cs.payload).length > 0) {
				Object.assign(payload, cs.payload);
			}

			try {
				// Create the record via em.create + uow.computeChangeSet so that
				// the AuditLog is persisted in the same transaction without calling flush()
				const em = args.em;
				const { AuditLog } = await import("@/entities");

				const last = await em.findOne(AuditLog, {}, { orderBy: { ts: "DESC" } });

				const ts = new Date();
				const hasher = new Bun.CryptoHasher("sha256");
				const signContent =
					(last?.signature ?? "") +
					JSON.stringify({
						actor_id: null,
						action,
						target_type: targetType,
						target_id: targetId,
						payload,
						ts: ts.toISOString(),
					});
				hasher.update(signContent);
				const signature = hasher.digest("hex");

				const record = em.create(AuditLog, {
					actorId: null,
					action,
					targetType,
					targetId,
					payload,
					reason: null,
					ip: null,
					ts,
					prevSignature: last?.signature ?? null,
					signature,
				});

				args.uow.computeChangeSet(record);
			} catch {
				// Subscriber errors must never break the original transaction
			}
		}
	}
}
