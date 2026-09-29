import { Property, Required } from "@tsed/schema";
import { Exclude, Expose } from "class-transformer";

import type { Suggestion, UserDTO } from "@/services";
import type { SocialMediaDTO } from "@/utils/functions";

import type { OrganizationState } from "../../../utils/enums/organizationState";
import type { Country } from "../../../utils/types/country";

@Exclude()
export class OrganizationDTO {
	@Expose() id?: string;
	@Expose() state?: OrganizationState;
	@Expose() name: string;
	@Expose() normalizedName: string;
	@Expose() logo: string;
	@Expose() description: string;
	@Expose() preapproved: boolean;
	@Expose() origin: Country;
	@Expose() createdAt: Date;
	@Expose() updatedAt: Date;

	// extra & computed data
	@Expose() owner: UserDTO;
	@Expose() orgManagers: UserDTO[] | Suggestion[];
	@Expose() socialMedias: SocialMediaDTO[];
	@Expose() broadcastMedias: SocialMediaDTO[];
}

export class NewOrganizationDTO {
	@Required()
	@Property()
	name: string;

	@Required()
	@Property()
	normalizedName: string;

	@Required()
	@Property()
	logo: string; // url

	@Required()
	@Property()
	description: string;

	@Required()
	@Property()
	owner: UserDTO;

	@Required()
	@Property()
	orgManagers: Suggestion[];

	@Required()
	@Property()
	socialMedias: SocialMediaDTO[];

	@Required()
	@Property()
	broadcastMedias: SocialMediaDTO[];

	@Required()
	@Property()
	origin: Country;
}
