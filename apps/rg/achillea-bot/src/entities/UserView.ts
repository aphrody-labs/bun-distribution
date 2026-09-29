import { Entity, Enum, Property } from "@mikro-orm/decorators/legacy";

import { UserRole } from "../utils/enums";

@Entity({ expression: `select * from user_view` })
export class UserView {
	@Property()
	id!: string;

	@Property()
	username!: string;

	@Property()
	lastInteract!: Date;

	@Enum(() => UserRole)
	role: UserRole;

	@Property()
	currentLevel: number;

	@Property()
	totalXp: number;

	@Property({ nullable: true })
	clanId?: number;

	@Property()
	solo_elo?: number;

	@Property()
	solo_key?: string;

	@Property()
	duo_elo?: number;

	@Property()
	duo_key?: string;

	@Property()
	hasTwitch: boolean;

	@Property()
	hasChallonge: boolean;

	@Property()
	hasYoutube: boolean;

	@Property()
	displayName: string;

	@Property()
	normalizedDisplayName: string;

	@Property()
	isBlacklisted: boolean;
}
