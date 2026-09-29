import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ tableName: "audit_log" })
@Index({ properties: ["targetType", "targetId"] })
@Index({ properties: ["actorId"] })
@Index({ properties: ["ts"] })
export class AuditLog {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@Property({ nullable: true, type: "varchar", columnType: "varchar(255)" })
	actorId: string | null = null;

	@Property({ type: "varchar", columnType: "varchar(255)" })
	action!: string;

	@Property({ type: "varchar", columnType: "varchar(255)" })
	targetType!: string;

	@Property({ nullable: true, type: "varchar", columnType: "varchar(255)" })
	targetId: string | null = null;

	@Property({ type: "jsonb", nullable: true })
	payload: Record<string, unknown> | null = null;

	@Property({ nullable: true, type: "text" })
	reason: string | null = null;

	@Property({ nullable: true, type: "varchar", columnType: "varchar(64)" })
	ip: string | null = null;

	@Property({ type: "datetime", defaultRaw: "NOW()" })
	ts: Date = new Date();

	@Property({ nullable: true, type: "varchar", columnType: "varchar(64)" })
	prevSignature: string | null = null;

	@Property({ type: "varchar", columnType: "varchar(64)" })
	signature!: string;
}
