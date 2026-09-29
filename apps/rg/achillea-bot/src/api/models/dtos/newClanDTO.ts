// src/dtos/SubmitFormDto.ts
import { Property, Required } from "@tsed/schema";

import type { Country } from "../../../utils/types/country";

export class NewClanDTO {
	@Required()
	@Property()
	founders: any[];

	@Property()
	logo: string; // base64 or file reference

	@Required()
	@Property()
	name: string;

	@Required()
	@Property()
	normalizedName: string;

	@Required()
	@Property()
	shortName: string;

	@Required()
	@Property()
	normalizedShortName: string;

	@Required()
	@Property()
	description: string;

	@Property()
	twitter?: string;

	@Property()
	instagram?: string;

	@Property()
	tiktok?: string;

	@Property()
	origin?: Country;

	@Property()
	languages?: Country[];
}
