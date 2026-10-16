import { UserRole } from "@rosegriffon/achillea-types";

/**
 * AchilleaRole — 4 rôles globaux RBAC Achilléa.
 *
 * Hiérarchie : owner > admin > staff > member
 */
export enum AchilleaRole {
	member = "member",
	staff = "staff",
	admin = "admin",
	owner = "owner",
}

/**
 * Mappe un UserRole (enum legacy) vers un AchilleaRole.
 *
 * UserRole.User               → member
 * UserRole.Moderator          → staff
 * UserRole.Administrator      → admin
 * UserRole.SuperAdministrator → owner
 */
export function userRoleToAchilleaRole(role: UserRole): AchilleaRole {
	switch (role) {
		case UserRole.SuperAdministrator:
			return AchilleaRole.owner;
		case UserRole.Administrator:
			return AchilleaRole.admin;
		case UserRole.Moderator:
			return AchilleaRole.staff;
		case UserRole.User:
		default:
			return AchilleaRole.member;
	}
}

/** Mappe un AchilleaRole vers le UserRole legacy le plus proche. */
export function achilleaRoleToUserRole(role: AchilleaRole): UserRole {
	switch (role) {
		case AchilleaRole.owner:
			return UserRole.SuperAdministrator;
		case AchilleaRole.admin:
			return UserRole.Administrator;
		case AchilleaRole.staff:
			return UserRole.Moderator;
		case AchilleaRole.member:
		default:
			return UserRole.User;
	}
}
