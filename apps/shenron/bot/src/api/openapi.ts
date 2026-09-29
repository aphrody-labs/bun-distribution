/**
 * openapi.ts — Spécification OpenAPI 3.1 de l'API publique Dragon Ball France.
 *
 * Décrit la surface REST publique (`/api/public/*`) : wiki, RAG hybride, stats,
 * personas, économie, médias. Servie à `/api/openapi.json`, explorable via
 * l'UI Scalar à `/api/docs`. Source de vérité = les handlers de `server.ts`.
 *
 * Document statique (pas de génération runtime) — à tenir à jour avec les
 * routes. Volontairement ciblé sur les endpoints publics stables.
 */

const SITE = "https://dragonballfr.com";

/** Filtres de métadonnées communs aux routes RAG (`/rag/search`, `/rag/context`). */
const ragFilterParams = [
	{
		name: "lang",
		in: "query",
		schema: { type: "string", enum: ["fr", "en", "ja"] },
		description: "Langue du passage.",
	},
	{
		name: "entity",
		in: "query",
		schema: { type: "string" },
		description: "Entité canonique indexée (ex. « Vegeta »).",
	},
	{
		name: "sourceId",
		in: "query",
		schema: { type: "string" },
		description:
			"Corpus : db_characters, db_wiki_sections, db_battles, db_items, db_dragons, db_timeline_events, db_power_levels, canon_references, wiki_pages, manga, databooks…",
	},
	{
		name: "kind",
		in: "query",
		schema: { type: "string" },
		description: "Type de passage : character, technique, manga_page, canon, battle, item…",
	},
];

// Schémas réutilisables (composants).
const schemas = {
	Character: {
		type: "object",
		properties: {
			id: { type: "integer" },
			name: { type: "string" },
			name_ja: { type: "string", nullable: true },
			name_romaji: { type: "string", nullable: true },
			image: { type: "string", nullable: true },
			ki: { type: "string", nullable: true },
			max_ki: { type: "string", nullable: true },
			race: { type: "string", nullable: true },
			gender: { type: "string", nullable: true },
			affiliation: { type: "string", nullable: true },
			description: { type: "string", nullable: true },
			origin_planet_id: { type: "integer", nullable: true },
		},
	},
	Planet: {
		type: "object",
		properties: {
			id: { type: "integer" },
			name: { type: "string" },
			name_ja: { type: "string", nullable: true },
			image: { type: "string", nullable: true },
			is_destroyed: { type: "integer", description: "0 | 1" },
			description: { type: "string", nullable: true },
		},
	},
	Saga: {
		type: "object",
		properties: {
			id: { type: "integer" },
			slug: { type: "string" },
			name: { type: "string" },
			name_ja: { type: "string", nullable: true },
			series: { type: "string", nullable: true },
			order_idx: { type: "integer", nullable: true },
			description: { type: "string", nullable: true },
			image: { type: "string", nullable: true },
		},
	},
	Episode: {
		type: "object",
		properties: {
			id: { type: "integer" },
			series: { type: "string" },
			number_in_series: { type: "integer" },
			title: { type: "string" },
			title_ja: { type: "string", nullable: true },
			synopsis: { type: "string", nullable: true },
			image: { type: "string", nullable: true },
			air_date: { type: "string", nullable: true },
		},
	},
	Technique: {
		type: "object",
		properties: {
			id: { type: "integer" },
			slug: { type: "string" },
			name: { type: "string" },
			name_ja: { type: "string", nullable: true },
			type: { type: "string", nullable: true },
			description: { type: "string", nullable: true },
			creator_id: { type: "integer", nullable: true },
		},
	},
	Transformation: {
		type: "object",
		properties: {
			id: { type: "integer" },
			name: { type: "string" },
			image: { type: "string", nullable: true },
			ki: { type: "string", nullable: true },
			character_id: { type: "integer", nullable: true },
		},
	},
	Movie: {
		type: "object",
		properties: {
			id: { type: "integer" },
			slug: { type: "string" },
			title: { type: "string" },
			series: { type: "string", nullable: true },
			synopsis: { type: "string", nullable: true },
			poster: { type: "string", nullable: true },
			trailer_url: { type: "string", nullable: true },
			release_date: { type: "string", nullable: true },
		},
	},
	Game: {
		type: "object",
		properties: {
			id: { type: "integer" },
			slug: { type: "string" },
			title: { type: "string" },
			platforms: { type: "string", nullable: true },
			publisher: { type: "string", nullable: true },
			developer: { type: "string", nullable: true },
			cover: { type: "string", nullable: true },
		},
	},
	Race: {
		type: "object",
		properties: {
			id: { type: "integer" },
			slug: { type: "string" },
			name: { type: "string" },
			name_ja: { type: "string", nullable: true },
			description: { type: "string", nullable: true },
		},
	},
	RagHit: {
		type: "object",
		properties: {
			rowid: { type: "integer", description: "Identifiant du passage dans l'index." },
			kind: {
				type: "string",
				description:
					"character | character_section | character_variant | power_profile | planet | race | technique | transformation | saga | arc | movie | game | episode | manga_volume | manga_chapter | manga_page | battle | item | dragon | wish | timeline_event | power_level | canon | article | databook | author | tool | source",
			},
			title: { type: "string" },
			url: {
				type: "string",
				description: "Chemin relatif au site (préfixer par le domaine), ou URL absolue.",
			},
			snippet: { type: "string" },
			score: {
				type: "number",
				description: "Pertinence [0,1], comparable uniquement au sein d'une même réponse.",
			},
			sourceId: { type: "string", description: "Corpus d'origine (db_characters, manga, databooks…)." },
			lang: { type: "string", description: "Langue du passage (fr, en, ja)." },
		},
	},
	RagResponse: {
		type: "object",
		properties: {
			q: { type: "string" },
			mode: { type: "string", enum: ["hybrid+rerank", "hybrid", "lexical"] },
			results: { type: "array", items: { $ref: "#/components/schemas/RagHit" } },
		},
	},
	RagContext: {
		type: "object",
		properties: {
			q: { type: "string" },
			mode: { type: "string", enum: ["hybrid+rerank", "hybrid", "lexical"] },
			context: {
				type: "string",
				description: "Passages intégraux numérotés [n], chacun suivi de son URL absolue.",
			},
			sources: {
				type: "array",
				items: {
					type: "object",
					properties: {
						n: { type: "integer" },
						rowid: { type: "integer" },
						title: { type: "string" },
						url: { type: "string" },
						kind: { type: "string" },
						sourceId: { type: "string" },
						lang: { type: "string" },
						score: { type: "number" },
					},
				},
			},
		},
	},
	Persona: {
		type: "object",
		properties: {
			id: { type: "string" },
			name: { type: "string" },
			online: { type: "boolean" },
		},
	},
	MangaPage: {
		type: "object",
		properties: {
			series: { type: "string", description: "DB | DBS" },
			tome: { type: "string", description: "vol1 | ch1321 | t901" },
			planche: { type: "integer" },
			lang: { type: "string", enum: ["fr", "ja"] },
			hasJa: { type: "boolean" },
			lineCount: { type: "integer" },
			lines: {
				type: "array",
				items: { type: "string" },
				description: "Bulles OCR en ordre de lecture (FR+JP).",
			},
			text: { type: "string" },
		},
	},
	MangaTome: {
		type: "object",
		properties: {
			series: { type: "string" },
			tome: { type: "string" },
			planches: { type: "integer" },
			lines: { type: "integer" },
			planchesWithJa: { type: "integer" },
			plancheRange: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
		},
	},
} as const;

const limitParam = (def: number, max: number) => ({
	name: "limit",
	in: "query",
	required: false,
	schema: { type: "integer", default: def, minimum: 1, maximum: max },
});
const offsetParam = {
	name: "offset",
	in: "query",
	required: false,
	schema: { type: "integer", default: 0, minimum: 0 },
};

const listResp = (ref: string, key: string) => ({
	"200": {
		description: "OK",
		content: {
			"application/json": {
				schema: {
					type: "object",
					properties: { [key]: { type: "array", items: { $ref: `#/components/schemas/${ref}` } } },
				},
			},
		},
	},
});
const itemResp = (ref: string) => ({
	"200": {
		description: "OK",
		content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } },
	},
	"404": { description: "Introuvable" },
});

export const openapiSpec = {
	openapi: "3.1.0",
	info: {
		title: "Dragon Ball France — API publique",
		version: "1.0.0",
		description:
			"API REST publique du wiki Dragon Ball France (personnages, planètes, sagas, " +
			"épisodes, techniques, films, jeux), recherche RAG hybride (BM25 + embeddings " +
			"sémantiques), statistiques du bot et médias générés.\n\n" +
			`Une **API GraphQL** équivalente (read-only) est aussi disponible sur \`/graphql\` ` +
			"(GraphiQL inclus).\n\nLecture seule, sans authentification. Rate-limit 60 req/min/IP, " +
			"CORS restreint. Données canon, sourcées.",
		contact: { name: "Dragon Ball France", url: SITE },
		license: { name: "Données sous attributions multiples (voir /api/public/sources)" },
	},
	servers: [{ url: "https://bot.dragonballfr.com", description: "Production" }],
	tags: [
		{ name: "RAG", description: "Recherche sémantique hybride sur les archives." },
		{ name: "Wiki", description: "Entités encyclopédiques Dragon Ball." },
		{ name: "Insights", description: "Statistiques bot, personas, commandes." },
		{ name: "Médias", description: "Images générées (cartes de profil)." },
		{ name: "Manga", description: "Transcriptions OCR des planches manga (bilingue FR+JP)." },
	],
	paths: {
		"/api/public/manga/tomes": {
			get: {
				tags: ["Manga"],
				summary: "Liste des tomes manga transcrits",
				parameters: [
					{
						name: "series",
						in: "query",
						required: false,
						schema: { type: "string", enum: ["DB", "DBS"] },
					},
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										count: { type: "integer" },
										tomes: { type: "array", items: { $ref: "#/components/schemas/MangaTome" } },
									},
								},
							},
						},
					},
				},
			},
		},
		"/api/public/manga/tomes/{series}/{tome}": {
			get: {
				tags: ["Manga"],
				summary: "Planches d'un tome (ordre de lecture)",
				parameters: [
					{ name: "series", in: "path", required: true, schema: { type: "string" } },
					{ name: "tome", in: "path", required: true, schema: { type: "string" } },
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										series: { type: "string" },
										tome: { type: "string" },
										planches: { type: "integer" },
										pages: { type: "array", items: { $ref: "#/components/schemas/MangaPage" } },
									},
								},
							},
						},
					},
					"404": { description: "Introuvable" },
				},
			},
		},
		"/api/public/manga/page/{series}/{tome}/{planche}": {
			get: {
				tags: ["Manga"],
				summary: "Une planche précise",
				parameters: [
					{ name: "series", in: "path", required: true, schema: { type: "string" } },
					{ name: "tome", in: "path", required: true, schema: { type: "string" } },
					{ name: "planche", in: "path", required: true, schema: { type: "integer" } },
				],
				responses: itemResp("MangaPage"),
			},
		},
		"/api/public/manga/search": {
			get: {
				tags: ["Manga"],
				summary: "Recherche plein-texte FTS5 (bilingue FR+JP)",
				parameters: [
					{
						name: "q",
						in: "query",
						required: true,
						schema: { type: "string", minLength: 2 },
						example: "kamehameha",
					},
					{
						name: "series",
						in: "query",
						required: false,
						schema: { type: "string", enum: ["DB", "DBS"] },
					},
					limitParam(20, 100),
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										q: { type: "string" },
										count: { type: "integer" },
										results: {
											type: "array",
											items: {
												type: "object",
												properties: {
													series: { type: "string" },
													tome: { type: "string" },
													planche: { type: "integer" },
													lang: { type: "string" },
													snippet: { type: "string" },
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		"/api/public/rag/search": {
			get: {
				tags: ["RAG"],
				summary: "Recherche RAG hybride",
				description:
					"Fusion RRF de BM25 (lexical) et d'embeddings denses multilingues (sémantique). " +
					"Idéale pour les questions en langage naturel. Dégrade en lexical si le moteur " +
					"sémantique est indisponible (`mode`).",
				parameters: [
					{
						name: "q",
						in: "query",
						required: true,
						schema: { type: "string", minLength: 2 },
						example: "comment Goku devient super saiyan",
					},
					limitParam(8, 25),
					...ragFilterParams,
					{
						name: "lexicalOnly",
						in: "query",
						schema: { type: "boolean" },
						description: "Force le BM25 seul (baseline reproductible).",
					},
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/RagResponse" } },
						},
					},
				},
			},
		},
		"/api/public/rag/context": {
			get: {
				tags: ["RAG"],
				summary: "Contexte d'ancrage pour LLM",
				description:
					"Mêmes passages que la recherche hybride, mais en texte intégral, numérotés [n] et " +
					"suivis de leur URL absolue, dans un budget de caractères. À injecter tel quel dans un " +
					"prompt : le modèle cite [n] sans relire chaque source.",
				parameters: [
					{
						name: "q",
						in: "query",
						required: true,
						schema: { type: "string", minLength: 2 },
						example: "pourquoi Vegeta laisse Cell absorber C-18",
					},
					limitParam(6, 12),
					{
						name: "maxChars",
						in: "query",
						schema: { type: "integer", minimum: 500, maximum: 16000, default: 6000 },
						description: "Budget total de caractères du contexte.",
					},
					...ragFilterParams,
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/RagContext" } },
						},
					},
				},
			},
		},
		"/api/public/wiki/characters": {
			get: {
				tags: ["Wiki"],
				summary: "Liste des personnages",
				parameters: [limitParam(50, 200), offsetParam],
				responses: listResp("Character", "characters"),
			},
		},
		"/api/public/wiki/characters/{id}": {
			get: {
				tags: ["Wiki"],
				summary: "Fiche personnage",
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
				responses: itemResp("Character"),
			},
		},
		"/api/public/wiki/planets": {
			get: {
				tags: ["Wiki"],
				summary: "Liste des planètes",
				responses: listResp("Planet", "planets"),
			},
		},
		"/api/public/wiki/planets/{id}": {
			get: {
				tags: ["Wiki"],
				summary: "Fiche planète",
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
				responses: itemResp("Planet"),
			},
		},
		"/api/public/wiki/races": {
			get: { tags: ["Wiki"], summary: "Liste des races", responses: listResp("Race", "races") },
		},
		"/api/public/wiki/techniques": {
			get: {
				tags: ["Wiki"],
				summary: "Liste des techniques",
				responses: listResp("Technique", "techniques"),
			},
		},
		"/api/public/wiki/transformations": {
			get: {
				tags: ["Wiki"],
				summary: "Liste des transformations",
				responses: listResp("Transformation", "transformations"),
			},
		},
		"/api/public/wiki/sagas": {
			get: { tags: ["Wiki"], summary: "Liste des sagas", responses: listResp("Saga", "sagas") },
		},
		"/api/public/wiki/episodes": {
			get: {
				tags: ["Wiki"],
				summary: "Liste des épisodes",
				parameters: [
					{ name: "series", in: "query", required: false, schema: { type: "string" } },
					limitParam(30, 100),
					offsetParam,
				],
				responses: listResp("Episode", "episodes"),
			},
		},
		"/api/public/wiki/movies": {
			get: { tags: ["Wiki"], summary: "Liste des films", responses: listResp("Movie", "movies") },
		},
		"/api/public/wiki/games": {
			get: { tags: ["Wiki"], summary: "Liste des jeux", responses: listResp("Game", "games") },
		},
		"/api/public/wiki/search": {
			get: {
				tags: ["Wiki"],
				summary: "Recherche plein-texte (entités wiki)",
				parameters: [
					{ name: "q", in: "query", required: true, schema: { type: "string" } },
					limitParam(20, 50),
				],
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/stats": {
			get: {
				tags: ["Insights"],
				summary: "Statistiques agrégées du bot",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/presence": {
			get: {
				tags: ["Insights"],
				summary: "Présence live du serveur (total membres, en ligne, échantillon)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/personas": {
			get: {
				tags: ["Insights"],
				summary: "État du bot Shenron unifié (anciens aliases conservés)",
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										personas: { type: "array", items: { $ref: "#/components/schemas/Persona" } },
									},
								},
							},
						},
					},
				},
			},
		},
		"/api/public/commands": {
			get: {
				tags: ["Insights"],
				summary: "Catalogue des commandes slash",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/leaderboard": {
			get: {
				tags: ["Insights"],
				summary: "Classement XP ou zéni, général ou mensuel",
				parameters: [
					{
						name: "metric",
						in: "query",
						required: false,
						schema: { type: "string", enum: ["xp", "zeni"] },
					},
					{
						name: "period",
						in: "query",
						required: false,
						schema: { type: "string", enum: ["general", "month"], default: "general" },
					},
					limitParam(10, 100),
				],
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/news": {
			get: {
				tags: ["Insights"],
				summary: "Actualités Dragon Ball",
				parameters: [
					{ name: "source", in: "query", required: false, schema: { type: "string" } },
					limitParam(20, 100),
				],
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/sources": {
			get: {
				tags: ["Insights"],
				summary: "Sources & licences des données (attribution)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/data/coverage": {
			get: {
				tags: ["Insights"],
				summary: "Couverture des données (index RAG, corpus, volumes wiki)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api/public/profile/{discordId}/card.png": {
			get: {
				tags: ["Médias"],
				summary: "Carte de profil (PNG canvas)",
				parameters: [{ name: "discordId", in: "path", required: true, schema: { type: "string" } }],
				responses: {
					"200": { description: "Image PNG", content: { "image/png": {} } },
					"404": { description: "Profil introuvable" },
				},
			},
		},
	},
	components: { schemas },
} as const;

/** Page HTML de l'UI Scalar (référence d'API interactive), CDN, zéro dépendance. */
export const scalarHtml = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dragon Ball France — API</title>
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script>
      var c = document.getElementById('api-reference');
      c.dataset.configuration = JSON.stringify({ theme: 'purple', layout: 'modern', hideDownloadButton: false });
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
