import { type Rel } from "@mikro-orm/core";
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { LicenseStatus } from "@/utils/enums";

import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ tableName: "license" })
@Index({ properties: ["user"] })
@Index({ properties: ["status"] })
export class License extends CustomBaseEntity {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@ManyToOne(() => User, { fieldName: "user_id" })
	user!: Rel<User>;

	@Property({ type: "varchar", columnType: "varchar(64)", unique: true })
	licenseNumber!: string;

	@Property({ type: "timestamptz", defaultRaw: "NOW()" })
	issuedAt: Date = new Date();

	@Property({ type: "timestamptz" })
	validUntil!: Date;

	@Enum({ items: () => LicenseStatus, default: LicenseStatus.Active })
	status: LicenseStatus = LicenseStatus.Active;

	@Property({ type: "text", nullable: true })
	pdfUrl: string | null = null;

	@Property({ type: "varchar", columnType: "varchar(64)", unique: true })
	qrSecret!: string;
}
