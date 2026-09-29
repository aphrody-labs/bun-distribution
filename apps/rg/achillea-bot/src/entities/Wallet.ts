import { OptionalProps, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/legacy";

import { User } from "./User";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ tableName: "wallet" })
export class Wallet {
	[OptionalProps]?: "createdAt" | "updatedAt" | "balance" | "currency";

	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@ManyToOne(() => User, { deleteRule: "cascade" })
	@Unique()
	user!: Rel<User>;

	@Property({ type: "decimal", columnType: "decimal(12,2)", default: "0.00" })
	balance: string = "0.00";

	@Property({ type: "varchar", columnType: "varchar(10)", default: "ACH" })
	currency: string = "ACH";

	@Property({ type: "timestamptz", defaultRaw: "NOW()" })
	createdAt: Date = new Date();

	@Property({ type: "timestamptz", defaultRaw: "NOW()", onUpdate: () => new Date() })
	updatedAt: Date = new Date();
}
