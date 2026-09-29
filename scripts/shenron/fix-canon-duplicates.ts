/**
 * Hide the duplicated `-2` rows of `public.canon_references` (soft delete, rule 9).
 *
 * Dry-run by default: it only logs which rows would change. Pass `--apply` to write.
 * Idempotent: it only touches rows that are still `visible = true`, so a second run
 * changes nothing. Nothing records which database it ran against; checking that the
 * production table was fixed is an operator-only task.
 *
 * Usage: DATABASE_URL=... bun scripts/fix-canon-duplicates.ts [--apply]
 */
import postgres from "postgres";

const DUPLICATE_IDS = [
	"l-echec-du-passage-de-flambeau-a-gohan-2",
	"la-relation-ambigue-avec-vegeta-2",
	"mr-satan-et-l-importance-du-gag-2",
	"mr-satan-hercule-et-l-importance-du-gag-2",
	"piccolo-le-personnage-prefere-de-l-auteur-2",
];

const PRIMARY_IDS = [
	"l-echec-du-passage-de-flambeau-a-gohan",
	"la-relation-ambigue-avec-vegeta",
	"mr-satan-et-l-importance-du-gag",
	"piccolo-le-personnage-prefere-de-l-auteur",
];

interface Row {
	id: string;
	year: number | null;
	document: string | null;
	visible: boolean;
}

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const sql = postgres(connectionString, { max: 1 });

const describe = (r: Row) => `[${r.id}] year=${r.year} doc="${r.document}" visible=${r.visible}`;

async function main(): Promise<void> {
	console.log(`=== canon_references -2 duplicates (${apply ? "APPLY" : "DRY-RUN"}) ===`);

	const rows = await sql<Row[]>`
		SELECT id, year, document, visible
		FROM public.canon_references
		WHERE id IN ${sql(DUPLICATE_IDS)}
		ORDER BY id
	`;
	const pending = rows.filter((r) => r.visible);
	const missing = DUPLICATE_IDS.filter((id) => !rows.some((r) => r.id === id));
	for (const r of rows) console.log(`${r.visible ? "would hide" : "already hidden"}: ${describe(r)}`);
	for (const id of missing) console.log(`absent: [${id}]`);

	if (pending.length === 0) {
		console.log("Nothing to change.");
	} else if (!apply) {
		console.log(`${pending.length} row(s) would be set visible=false. Re-run with --apply to write.`);
	} else {
		const updated = await sql<{ id: string }[]>`
			UPDATE public.canon_references
			SET visible = false, updated_at = NOW()
			WHERE id IN ${sql(pending.map((r) => r.id))} AND visible = true
			RETURNING id
		`;
		console.log(`Updated ${updated.length} row(s): ${updated.map((u) => u.id).join(", ")}`);
	}

	const primes = await sql<Row[]>`
		SELECT id, year, document, visible
		FROM public.canon_references
		WHERE id IN ${sql(PRIMARY_IDS)}
		ORDER BY id
	`;
	console.log("Primary citations (expected visible=true, year=1995):");
	for (const p of primes) console.log(`${p.visible && p.year === 1995 ? "ok" : "CHECK"}: ${describe(p)}`);
}

try {
	await main();
} finally {
	await sql.end();
}
