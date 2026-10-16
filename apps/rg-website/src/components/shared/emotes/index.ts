/**
 * Rose Griffon Emote System
 * Système complet de gestion et d'affichage des emotes
 *
 * @module @/components/shared/emotes
 */

// Hooks
export {
	useEmoteHistory,
	useEmoteRotation,
	useEmotes,
	useEmoteValidation,
} from "@/hooks/useEmotes";
// Types et constantes depuis @/lib/emotes
export type { Emote } from "@/lib/emotes";
export {
	EMOTES,
	getEmote,
	getEmotesByCategory,
	getEmotesByCharacter,
	getRandomEmote,
	getRandomEmoteByCharacter,
} from "@/lib/emotes";
// Composants
export { default as EmotePicker } from "./EmotePicker";
export {
	default as EmoteRenderer,
	getTextWithoutEmotes,
	stripEmotes,
	useEmotesFromText,
} from "./EmoteRenderer";
export { default as RgEmote, RgEmoteGrid, RgEmoteLine } from "./RgEmote";
