import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL?.trim()) {
	throw new Error("DATABASE_URL must be provided by the local or infrastructure environment.");
}

async function main() {
	const sql = postgres(DATABASE_URL, { max: 1 });
	const revs = await sql`
		SELECT id, "tableName", "rowId", action, label, "editorName", "createdAt"
		FROM public.wiki_revisions
		ORDER BY "createdAt" DESC
		LIMIT 10
	`;
	console.table(revs);
	await sql.end();
}

main().catch(console.error);
