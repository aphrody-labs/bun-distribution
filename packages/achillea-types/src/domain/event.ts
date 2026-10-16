import type { EventTypeEnum } from "../enums/eventEnums";

/** Racine commune à tout évènement compétitif (tournoi, interclan, ranked). */
export interface EventEntity {
	id: number;
	name: string;
	description: string;
	type: EventTypeEnum;
	createdAt: Date;
	updatedAt: Date;
}
