declare enum AdditionalLocaleString {
	English = "en",
}

type TranslationsNestedPaths = NestedPaths<import("@/i18n").Translations>;

type LocalizationMap = Partial<
	Record<`${import("discord-api-types/v9").Locale | AdditionalLocaleString}`, string>
>;

type SanitizedOptions = {
	descriptionLocalizations?: LocalizationMap;
	nameLocalizations?: LocalizationMap;
	localizationSource?: TranslationsNestedPaths;
};

type Sanitization<K> = Modify<K, SanitizedOptions>;

type ApplicationCommandOptions = Sanitization<
	WithOptional<import("@aphrody/discordx").ApplicationCommandOptions<string, string>, "description">
>;

type SlashGroupOptions = Sanitization<
	WithOptional<import("@aphrody/discordx").SlashGroupOptions<string, string, string>, "description">
>;

type SlashOptionOptions = Sanitization<
	WithOptional<import("@aphrody/discordx").SlashOptionOptions<string, string>, "description">
>;

type SlashChoiceOption = Modify<
	import("@aphrody/discordx").SlashChoiceType<string, string | number>,
	SanitizedOptions
>;

type ContextMenuOptionsX = Omit<
	import("@aphrody/discordx").ApplicationCommandOptions<
		import("@aphrody/discordx").NotEmpty<string>,
		string
	> & {
		type: Exclude<
			import("discord.js").ApplicationCommandType,
			import("discord.js").ApplicationCommandType.ChatInput
		>;
	},
	"description" | "descriptionLocalizations"
>;

type ContextMenuOptions = Modify<
	Modify<ContextMenuOptionsX, SanitizedOptions>,
	{
		type: ContextMenuOptionsX["type"] | "USER" | "MESSAGE";
	}
>;
