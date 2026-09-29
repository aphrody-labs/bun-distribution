import { OptionalProps, type Rel } from "@mikro-orm/core";
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { TransactionType } from "@/utils/enums";
import { User } from "./User";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ tableName: "transaction" })
@Index({ properties: ["toUser"] })
@Index({ properties: ["fromUser"] })
export class Transaction {
	[OptionalProps]?: "createdAt" | "reason" | "fromUser" | "toUser" | "metadata";

	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@Enum({ items: () => TransactionType })
	type!: TransactionType;

	@Property({ type: "decimal", columnType: "decimal(12,2)" })
	amount!: string;

	@Property({ type: "text", nullable: true })
	reason: string | null = null;

	@ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
	fromUser: Rel<User> | null = null;

	@ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
	toUser: Rel<User> | null = null;

	@Property({ type: "jsonb", nullable: true })
	metadata: Record<string, unknown> | null = null;

	@Property({ type: "timestamptz", defaultRaw: "NOW()" })
	createdAt: Date = new Date();
}
