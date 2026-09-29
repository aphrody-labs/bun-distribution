import { Exclude, Expose } from "class-transformer";

import type { SanctionIssuerType, SanctionType } from "@/utils/enums";

@Exclude()
export class SanctionDTO {
	@Expose() id!: string;
	@Expose() userId!: string;
	@Expose() guildId!: string;
	@Expose() type!: SanctionType;
	@Expose() reason!: string | null;
	@Expose() durationSec!: number | null;
	@Expose() issuedBy!: string;
	@Expose() issuedByType!: SanctionIssuerType;
	@Expose() expiresAt!: Date | null;
	@Expose() revokedAt!: Date | null;
	@Expose() revokedBy!: string | null;
	@Expose() revokeReason!: string | null;
	@Expose() evidence!: Record<string, unknown>[] | null;
	@Expose() createdAt!: Date;
}
