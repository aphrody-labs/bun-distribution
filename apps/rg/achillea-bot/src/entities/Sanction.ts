import { Entity, Enum, Index, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { SanctionIssuerType, SanctionType } from "@/utils/enums";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ tableName: "sanction" })
@Index({ properties: ["userId"] })
@Index({ properties: ["guildId", "userId"] })
export class Sanction {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@Property({ type: "varchar", columnType: "varchar(255)" })
	userId!: string;

	@Property({ type: "varchar", columnType: "varchar(255)" })
	guildId!: string;

	@Enum({ items: () => SanctionType })
	type!: SanctionType;

	@Property({ type: "text", nullable: true })
	reason: string | null = null;

	@Property({ type: "int", nullable: true, unsigned: true })
	durationSec: number | null = null;

	@Property({ type: "varchar", columnType: "varchar(255)" })
	issuedBy!: string;

	@Enum({ items: () => SanctionIssuerType, default: SanctionIssuerType.Staff })
	issuedByType: SanctionIssuerType = SanctionIssuerType.Staff;

	@Property({ type: "timestamptz", nullable: true })
	expiresAt: Date | null = null;

	@Property({ type: "timestamptz", nullable: true })
	revokedAt: Date | null = null;

	@Property({ type: "varchar", columnType: "varchar(255)", nullable: true })
	revokedBy: string | null = null;

	@Property({ type: "text", nullable: true })
	revokeReason: string | null = null;

	@Property({ type: "jsonb", nullable: true })
	evidence: Record<string, unknown>[] | null = null;

	@Property({ type: "timestamptz", defaultRaw: "NOW()" })
	createdAt: Date = new Date();
}
