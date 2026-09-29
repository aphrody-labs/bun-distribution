import { Collection, EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	OneToMany,
	OneToOne,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";
import type { User as DiscordUser } from "discord.js";

import type { MatchMode } from "@/utils/enums";
import { UserRole } from "@/utils/enums";
import { freshDiscordAvatarUrl } from "../utils/functions/discordAvatar";
import { normalizeNames } from "../utils/functions/normalizeName";

import { CustomBaseEntity } from "./BaseEntity";
import { Blacklist } from "./Blacklist";
import { UserConnection } from "./UserConnection";
import { UserElo } from "./UserElo";
import { UserExperience } from "./UserExperience";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ repository: () => UserRepository })
export class User extends CustomBaseEntity {
	[EntityRepositoryType]?: UserRepository;

	@PrimaryKey({ autoincrement: false })
	id!: string;

	@Property()
	lastInteract: Date = new Date();

	@Enum(() => UserRole)
	role: UserRole = UserRole.User;

	@OneToMany(() => UserElo, (elo) => elo.user)
	elos = new Collection<UserElo>(this);

	@OneToMany(() => UserConnection, (connection) => connection.user)
	connections = new Collection<UserConnection>(this);

	@OneToOne(() => UserExperience, (ex) => ex.user, { orphanRemoval: true })
	xp: Rel<UserExperience>;

	@Property({ nullable: true })
	username: string;

	@Property({ persist: false })
	sim: number;

	@Property({ nullable: true })
	avatar: string;

	@Property({ default: "" })
	displayName: string;

	@Property({ default: "" })
	normalizedDisplayName: string;

	@OneToOne(() => Blacklist, { nullable: true })
	blacklist?: Rel<Blacklist> | null;

	@Property({ type: "text", nullable: true })
	bio: string | null = null;

	@Property({ type: "varchar", columnType: "varchar(255)", nullable: true })
	twitchUrl: string | null = null;

	getElo(mode: MatchMode): UserElo | undefined {
		return this.elos.find((elo) => elo.mode === mode);
	}
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class UserRepository extends EntityRepository<User> {
	async updateLastInteract(discordUser: DiscordUser): Promise<void> {
		const user = await this.findOne({ id: discordUser.id });

		if (user) {
			user.lastInteract = new Date();
			user.avatar = freshDiscordAvatarUrl(discordUser);
			user.username = discordUser.username;
			user.displayName = discordUser.displayName;
			user.normalizedDisplayName = normalizeNames(discordUser.displayName);
			await this.em.flush();
		}
	}

	async isUserBotAdmin(userId: string): Promise<boolean> {
		return (await this.findOne({ id: userId, role: UserRole.Administrator })) !== null;
	}

	async isBotModerator(userId: string): Promise<boolean> {
		return (await this.findOne({ id: userId, role: UserRole.Moderator })) !== null;
	}

	async setBotSuperAdmin(userId: string, isSuperAdmin: boolean): Promise<void> {
		const user = await this.findOne({ id: userId });

		if (user) {
			user.role = isSuperAdmin ? UserRole.SuperAdministrator : UserRole.User;
			await this.em.flush();
		}
	}

	async setBotAdmin(userId: string, isAdmin: boolean): Promise<void> {
		const user = await this.findOne({ id: userId });

		if (user) {
			user.role = isAdmin ? UserRole.Administrator : UserRole.User;
			await this.em.flush();
		}
	}

	async setBotModerator(userId: string, isModerator: boolean): Promise<void> {
		const user = await this.findOne({ id: userId });

		if (user) {
			user.role = isModerator ? UserRole.Moderator : UserRole.User;
			await this.em.flush();
		}
	}
}
