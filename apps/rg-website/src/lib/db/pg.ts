/** Web compatibility boundary; pool creation is centralized in @rosegriffon/db. */
export {
	closePgPool,
	getDatabaseURL,
	getPgPool,
	getPgPoolOrNull,
	isDatabaseConfigured,
	type PgPoolOptions,
} from "@rosegriffon/db/pg";
