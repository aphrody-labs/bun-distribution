// oxlint-disable react-hooks/rules-of-hooks -- `useResponseCache` est un greffon
// GraphQL Yoga, pas un crochet React : la règle ne va que sur son préfixe `use`.
import { useResponseCache } from "@graphql-yoga/plugin-response-cache";
import { createSchema, createYoga } from "graphql-yoga";
import { wikiService } from "@/lib/wiki-service";

const typeDefs = `
  scalar JSON

  type LocalizedString {
    fr: String
    en: String
    ja: String
  }

  type Stats {
    kick: Int
    control: Int
    technique: Int
    pressure: Int
    physical: Int
    agility: Int
    intelligence: Int
  }

  type CharacterVariant {
    charaParamId: ID!
    position: String
    element: String
    rarity: String
    stats: Stats
    image: String
  }

  type Character {
    id: ID!
    internalCode: String
    name: LocalizedString
    gender: Int
    nickname: String
    ageGroup: String
    schoolYear: String
    image: String
    variants: [CharacterVariant]
    sheetData: JSON
    auras: [Aura]
  }

  type Tweet {
    id: ID!
    text: String
    createdAt: String
    authorUsername: String
    authorName: String
    media: JSON
  }

  type Item {
    id: ID!
    name: LocalizedString
    description: String
    category: String
    rarity: Int
    image: String
    sheetData: JSON
  }

  type Skill {
    id: ID!
    name: LocalizedString
    description: String
    category: String
    element: String
    power: String
    tension: Int
    image: String
    sheetData: JSON
  }

  type Aura {
    id: ID!
    name: String
    passive: String
    hissatsu: String
    element: String
    image: String
    type: String
    sheetData: JSON
  }

  type Query {
    characters(page: Int, limit: Int, q: String, element: String, position: String, rarity: String, team: String, series: String, ageGroup: String): [Character]
    character(id: ID!): Character
    items(page: Int, limit: Int, q: String, category: String): [Item]
    item(id: ID!): Item
    skills(page: Int, limit: Int, q: String, category: String, element: String): [Skill]
    skill(id: ID!): Skill
    auras(page: Int, limit: Int, q: String, element: String, typeSlug: String!): [Aura]
    tweets(limit: Int): [Tweet]
    tweet(id: ID!): Tweet
  }
`;

const resolvers = {
	Character: {
		auras: async (c: any) => {
			const paramId = c.variants?.[0]?.charaParamId || c.id;
			const results = await wikiService.getCharacterAuras(c.id, paramId);
			return results.map((a: any) => ({
				id: a.id,
				name: a.name,
				passive: null,
				hissatsu: null,
				element: a.element?.fr || a.element?.en,
				image: a.imageUrl,
				type: a.type,
				sheetData: null,
			}));
		},
	},
	Query: {
		auras: async (_: any, args: any) => {
			const { data } = await wikiService.getAurasList(args);
			return data.map((a: any) => ({
				id: a.id,
				name: a.name,
				passive: a.passive,
				hissatsu: a.hissatsu_name,
				element: a.element,
				image: a.image_url,
				type: a.type,
				sheetData: a.sheet_data || a.sheetData,
			}));
		},
		character: async (_: any, { id }: any) => {
			const c =
				(await wikiService.getCharacterByBaseSlug(id)) ||
				(await wikiService.getCharacterBySlug(id)) ||
				(await wikiService.getCharacter(id));
			if (!c) return null;
			return {
				id: c.charaId,
				internalCode: c.internalCode,
				name: c.names,
				gender: c.gender,
				nickname: c.nickname,
				ageGroup: c.ageGroup,
				schoolYear: c.schoolYear,
				image: c.image,
				variants: c.variants.map((v: any) => ({
					charaParamId: v.charaParamId,
					position: v.position,
					element: v.element,
					rarity: v.rarity,
					stats: v.stats?.lv99 || v.stats,
					image: v.image,
				})),
				sheetData: c.sheetData,
			};
		},
		characters: async (_: any, args: any) => {
			const { data } = await wikiService.getCharactersList(args);
			return data.map((c: any) => ({
				id: c.charaId,
				internalCode: c.internalCode,
				name: c.names,
				gender: c.gender,
				nickname: c.nickname,
				ageGroup: c.ageGroup,
				schoolYear: c.schoolYear,
				image: c.image,
				variants: c.variants.map((v: any) => ({
					charaParamId: v.charaParamId,
					position: v.position,
					element: v.element,
					rarity: v.rarity,
					stats: v.stats?.lv99 || v.stats,
					image: v.image,
				})),
				sheetData: c.sheetData,
			}));
		},
		item: async (_: any, { id }: any) => {
			const i: any = await wikiService.getItem(id);
			if (!i) return null;
			return {
				id: i.itemId,
				name: i.names,
				description: i.description,
				category: i.category,
				rarity: i.rarity,
				image: i.image,
				sheetData: i.sheetData,
			};
		},
		items: async (_: any, args: any) => {
			const { data } = await wikiService.getItemsList(args);
			return data.map((i: any) => ({
				id: i.itemId,
				name: i.names,
				description: i.description,
				category: i.category,
				rarity: i.rarity,
				image: i.image,
				sheetData: i.sheetData,
			}));
		},
		skill: async (_: any, { id }: any) => {
			const s: any = await wikiService.getSkill(id);
			if (!s) return null;
			return {
				id: s.skillId,
				name: s.names,
				description: s.descriptions?.fr || "",
				category: s.categoryName?.fr || "Unknown",
				element: s.elementName?.fr || "Unknown",
				power: `${s.power_min}-${s.power_max}`,
				tension: s.consumeTp,
				image: s.image,
				sheetData: s.sheetData,
			};
		},
		skills: async (_: any, args: any) => {
			const { data } = await wikiService.getSkillsList(args);
			return data.map((s: any) => ({
				id: s.skillId,
				name: s.names,
				description: s.descriptions?.fr || "",
				category: s.categoryName?.fr || "Unknown",
				element: s.elementName?.fr || "Unknown",
				power: `${s.power_min}-${s.power_max}`,
				tension: s.consumeTp,
				image: s.image,
				sheetData: s.sheetData,
			}));
		},
		tweet: async (_: any, { id }: any) => {
			const t = await wikiService.getTweetById(id);
			if (!t) return null;
			return {
				id: t.id,
				text: t.text,
				createdAt: t.created_at,
				authorUsername: t.author_username,
				authorName: t.author_name,
				media: t.media,
			};
		},
		tweets: async (_: any, { limit }: any) => {
			const data = await wikiService.getTweets(limit || 20);
			return data.map((t: any) => ({
				id: t.id,
				text: t.text,
				createdAt: t.created_at,
				authorUsername: t.author_username,
				authorName: t.author_name,
				media: t.media,
			}));
		},
	},
};

const { handleRequest } = createYoga({
	schema: createSchema({
		resolvers,
		typeDefs,
	}),
	graphqlEndpoint: "/api/graphql",
	fetchAPI: { Response },
	plugins: [
		// `useGraphQlJit()` a été RETIRÉ : il rendait l'API GraphQL entièrement
		// inutilisable en production. Le compilateur `graphql-jit` levait
		// `unsupported type: String!` au moment de compiler le schéma, donc AVANT
		// d'exécuter quoi que ce soit — même `{ __typename }` répondait 500. Un
		// greffon d'optimisation qui fait tomber 100 % des requêtes coûte
		// infiniment plus que les millisecondes qu'il fait gagner.
		//
		// Le cache de réponse ci-dessous couvre déjà le vrai coût de ces requêtes
		// (15 minutes sur des données de jeu qui ne bougent qu'au dump nocturne).
		// Ne le réintroduire qu'avec une requête de bout en bout qui prouve que la
		// compilation passe sur CE schéma.
		useResponseCache({
			session: () => null, // Global cache
			ttl: 900_000, // 15 minutes
		}),
	],
});

export const GET = (request: Request) => handleRequest(request, {});
export const POST = (request: Request) => handleRequest(request, {});
export const OPTIONS = (request: Request) => handleRequest(request, {});
