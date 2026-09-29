import type { GuildMember, User } from "discord.js";

/**
 * Transformer pour @SlashOption de type User.
 *
 * `discordx` renvoie le `GuildMember` quand disponible, puis fallback
 * sur `User`. Or nos handlers typent `target: User | undefined` et accèdent
 * à `username`/`tag` — propriétés absentes de `GuildMember`.
 *
 * Usage : `@SlashOption({ ... }, userTransformer)`
 */
export const userTransformer = (value: User | GuildMember | null | undefined): User | undefined => {
	if (!value) return undefined;
	return "user" in value ? value.user : value;
};
