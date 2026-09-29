import { Property } from "@mikro-orm/decorators/legacy";

export abstract class CustomBaseEntity {
	@Property()
	createdAt: Date = new Date();

	@Property({ onUpdate: () => new Date() })
	updatedAt: Date = new Date();
}
