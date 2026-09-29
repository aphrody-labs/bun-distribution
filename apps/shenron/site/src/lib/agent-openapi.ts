/**
 * agent-openapi — le contrat de l'API agents, écrit une fois.
 *
 * Le schéma vit dans un module plutôt que dans la route pour pouvoir être
 * consommé par trois surfaces : `/api/agent/v1/openapi.json` (ce que lit un
 * agent), la page `/admin/api-docs` (ce que lit un humain) et les tests (qui vérifient
 * que chaque route déclarée existe vraiment). Une documentation qui promet une
 * route absente est pire qu'une absence de documentation.
 *
 * OpenAPI 3.1 : c'est la version que lisent les générateurs de clients actuels
 * et les orchestrateurs d'agents.
 */
import { AGENT_SCOPES } from "@/db/schema";
import { SCOPE_DESCRIPTIONS } from "@/lib/agent-scopes";

export const AGENT_API_VERSION = "1.0.0";

// Les descriptions de portées sont définies une fois dans `lib/agent-scopes.ts`
// (client-safe) et réexportées ici : la documentation publique, l'écran
// d'administration et le schéma OpenAPI doivent dire la même chose.
export { SCOPE_DESCRIPTIONS };

export function buildOpenApiDocument(origin: string): Record<string, unknown> {
	const bearer = [{ bearerAuth: [] as string[] }];

	return {
		openapi: "3.1.0",
		info: {
			title: "API agents — Dragon Ball France",
			version: AGENT_API_VERSION,
			description:
				"API d'écriture du site dragonballfr.com pour les agents (IA ou outils). " +
				"Authentification par clé d'agent à portées explicites, créée depuis /admin/agents. " +
				"Les propositions de correction du wiki n'écrivent rien : elles entrent dans la file " +
				"de modération et un humain tranche. Les articles déposés par un agent sont des " +
				"brouillons, sauf portée `publish:articles`.",
			contact: { url: `${origin}/credits` },
			license: { name: "Contenu sous licence du site", url: `${origin}/licence` },
		},
		servers: [{ url: `${origin}/api/agent/v1` }],
		security: bearer,
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description:
						"`Authorization: Bearer dbfr_agent_…`. La clé n'est affichée qu'une fois, " +
						"à sa création ; seul son hachage est conservé.",
				},
			},
			schemas: {
				Error: {
					type: "object",
					required: ["ok", "error", "message"],
					properties: {
						ok: { type: "boolean", const: false },
						error: {
							type: "string",
							enum: [
								"auth_required",
								"scope_missing",
								"rate_limited",
								"bad_request",
								"not_found",
								"conflict",
								"server_error",
							],
						},
						message: { type: "string" },
					},
				},
				FeedEntry: {
					type: "object",
					properties: {
						id: { type: "string" },
						kind: { type: "string", enum: ["article", "wiki", "contribution", "discussion"] },
						at: { type: "string", format: "date-time" },
						badge: { type: "string" },
						title: { type: "string" },
						href: { type: ["string", "null"] },
						summary: { type: ["string", "null"] },
						actor: { type: ["string", "null"] },
						fields: { type: "array", items: { type: "string" } },
						likes: { type: "integer" },
						comments: { type: "integer" },
					},
				},
				Comment: {
					type: "object",
					properties: {
						id: { type: "string" },
						body: { type: "string" },
						createdAt: { type: "string", format: "date-time" },
						authorName: { type: "string" },
						agentName: { type: ["string", "null"] },
						likes: { type: "integer" },
						replyCount: { type: "integer" },
					},
				},
			},
		},
		paths: {
			"/whoami": {
				get: {
					summary: "Identité et portées de la clé",
					description:
						"Première requête à faire : elle dit ce que la clé autorise et combien " +
						"d'écritures restent sur l'heure en cours.",
					security: bearer,
					responses: {
						200: { description: "Identité de l'agent" },
						401: {
							description: "Jeton absent ou invalide",
							content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
						},
					},
				},
			},
			"/feed": {
				get: {
					summary: "Fil d'actualité unifié",
					description:
						"Articles, fiches modifiées, contributions acceptées et discussions, " +
						"dans l'ordre chronologique. Mêmes règles de visibilité que les pages publiques.",
					parameters: [
						{
							name: "filter",
							in: "query",
							schema: {
								type: "string",
								enum: ["tout", "articles", "wiki", "communaute", "discussions"],
								default: "tout",
							},
						},
						{ name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 25 } },
						{
							name: "perPage",
							in: "query",
							schema: { type: "integer", minimum: 5, maximum: 50, default: 20 },
						},
					],
					responses: {
						200: {
							description: "Page du fil",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											ok: { type: "boolean" },
											data: {
												type: "object",
												properties: {
													entries: {
														type: "array",
														items: { $ref: "#/components/schemas/FeedEntry" },
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
			"/articles": {
				get: {
					summary: "Liste des articles",
					parameters: [
						{
							name: "status",
							in: "query",
							schema: { type: "string", enum: ["published", "draft", "all"], default: "published" },
						},
						{ name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
						{
							name: "perPage",
							in: "query",
							schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
						},
					],
					responses: { 200: { description: "Articles" } },
				},
				post: {
					summary: "Créer un article",
					description:
						"Le corps est du **markdown** : il est converti en document éditorial puis " +
						"re-rendu côté serveur (aucun HTML fourni par un client n'atteint une page " +
						"publique). Sans la portée `publish:articles`, l'article est enregistré en " +
						"brouillon même si `status` vaut `published`.",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["title", "markdown"],
									properties: {
										title: { type: "string", minLength: 3, maxLength: 180 },
										markdown: { type: "string", maxLength: 120_000 },
										slug: { type: "string", maxLength: 80 },
										excerpt: { type: "string", maxLength: 320 },
										cover: { type: "string", maxLength: 600 },
										coverAlt: { type: "string", maxLength: 300 },
										tags: { type: "array", items: { type: "string" }, maxItems: 8 },
										status: {
											type: "string",
											enum: ["draft", "scheduled", "published"],
											default: "draft",
										},
										publishedAt: { type: "string", format: "date-time" },
										seoTitle: { type: "string", maxLength: 70 },
										seoDescription: { type: "string", maxLength: 180 },
									},
								},
								example: {
									title: "Daima : ce que révèle l'épisode 12",
									markdown: "## Ce qu'on apprend\n\nTexte de l'article…",
									tags: ["Daima", "Anime"],
									status: "draft",
								},
							},
						},
					},
					responses: {
						201: { description: "Article créé" },
						400: {
							description: "Requête invalide",
							content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
						},
						403: { description: "Portée `write:articles` absente" },
					},
				},
			},
			"/comments": {
				get: {
					summary: "Fil de discussion d'une cible",
					parameters: [
						{
							name: "target",
							in: "query",
							required: true,
							description: "`post:<id>`, `wiki:<table>#<rowId>`, `databook:<id>`, `tierlist:<id>`.",
							schema: { type: "string" },
						},
						{
							name: "sort",
							in: "query",
							schema: { type: "string", enum: ["recent", "ancien", "populaire"] },
						},
						{ name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
					],
					responses: {
						200: {
							description: "Messages",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											data: {
												type: "object",
												properties: {
													comments: {
														type: "array",
														items: { $ref: "#/components/schemas/Comment" },
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
				post: {
					summary: "Publier un message (signé du nom de l'agent)",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["target", "body"],
									properties: {
										target: { type: "string" },
										body: { type: "string", maxLength: 4000 },
										parentId: {
											type: "string",
											description: "Répondre à un message racine (un seul niveau).",
										},
									},
								},
							},
						},
					},
					responses: { 201: { description: "Message publié" }, 403: { description: "Portée `comment` absente" } },
				},
				patch: {
					summary: "Modérer un message",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["id", "action"],
									properties: {
										id: { type: "string" },
										action: { type: "string", enum: ["hide", "restore", "pin", "unpin"] },
									},
								},
							},
						},
					},
					responses: { 200: { description: "Message modéré" } },
				},
			},
			"/wiki/contributions": {
				get: {
					summary: "File des propositions de correction",
					parameters: [
						{
							name: "status",
							in: "query",
							schema: {
								type: "string",
								enum: ["pending", "accepted", "rejected", "superseded", "withdrawn"],
								default: "pending",
							},
						},
						{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
					],
					responses: { 200: { description: "Propositions" } },
				},
				post: {
					summary: "Proposer une correction du wiki",
					description:
						"N'écrit RIEN dans le wiki : la proposition entre dans la file de modération " +
						"avec son diff et ses sources, et un humain l'accepte ou la refuse. Les sources " +
						"sont facultatives mais la réponse indique si la proposition en porte — la " +
						"doctrine du site interdit d'inventer une donnée éditoriale.",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["table", "rowId", "column", "valueAfter"],
									properties: {
										table: { type: "string", example: "db_characters" },
										rowId: { type: ["string", "integer"], example: 42 },
										column: { type: "string", example: "article" },
										valueAfter: { type: "string" },
										comment: { type: "string" },
										sources: {
											type: "string",
											description: "Tome + planche, databook + page, interview datée…",
										},
										path: { type: "string", description: "URL publique de la fiche." },
									},
								},
							},
						},
					},
					responses: {
						201: { description: "Proposition déposée" },
						403: { description: "Portée `contribute` absente" },
					},
				},
			},
			"/wiki/contribution-schema": {
				get: {
					summary: "Schéma des cibles wiki contributives",
					description:
						"Première étape avant une proposition : retourne les tables, clés primaires et champs " +
						"que la modération accepte réellement, plus les cibles spéciales de transcription. " +
						"Ne retourne aucune donnée privée ni accès SQL direct.",
					responses: {
						200: { description: "Contrat de contribution versionné" },
						403: { description: "Portée `read` absente" },
					},
				},
			},
			"/wiki/entities": {
				get: {
					summary: "Résoudre les identifiants des fiches contributives",
					description:
						"Après lecture du contrat, retourne les `rowId` et libellés des fiches visibles " +
						"d'une table. Utiliser la recherche publique ou le MCP pour lire la fiche ; ce " +
						"catalogue ne divulgue ni les champs éditoriaux ni les fiches masquées.",
					parameters: [
						{ name: "table", in: "query", required: true, schema: { type: "string" } },
						{ name: "q", in: "query", schema: { type: "string", maxLength: 120 } },
						{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
					],
					responses: { 200: { description: "Cibles visibles" } },
				},
			},
		},
		"x-scopes": Object.fromEntries(
			AGENT_SCOPES.map((s) => [s, SCOPE_DESCRIPTIONS[s]])
		) as Record<string, string>,
	};
}
