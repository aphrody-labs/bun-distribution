import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ repository: () => GuildRepository })
export class Guild extends CustomBaseEntity {
	[EntityRepositoryType]?: GuildRepository;

	@PrimaryKey({ autoincrement: false })
	id!: string;

	@Property({ nullable: true, type: "string" })
	prefix: string | null;

	@Property()
	deleted: boolean = false;

	@Property()
	lastInteract: Date = new Date();

	@Property({ nullable: true, type: "string" })
	broadcastChannel: string | null;

	@Property({ default: false })
	rankedEnabled: boolean;

	@Property({ nullable: true, type: "varchar", columnType: "varchar(255)" })
	auditLogChannelId: string | null = null;
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class GuildRepository extends EntityRepository<Guild> {
	async updateLastInteract(guildId?: string): Promise<void> {
		const guild = await this.findOne({ id: guildId });

		if (guild) {
			guild.lastInteract = new Date();
			await this.em.flush();
		}
	}

	async getActiveGuilds() {
		return this.find({ deleted: false });
	}
}
