import { NextResponse } from "next/server";

import { getPgPool } from "@/lib/db/pg";
import type { StreamSchedule } from "@rosegriffon/types";

// Planning hebdo — change rarement, 1h ISR suffit.
export const revalidate = 3600;

export async function GET() {
	try {
		const pool = getPgPool();

		// Récupérer le planning actif
		// On suppose que la table stream_schedules contient les créneaux de la semaine
		const { rows: schedule } = await pool.query<StreamSchedule>(
			`SELECT * FROM stream_schedules ORDER BY day_of_week ASC, start_time ASC`
		);

		return NextResponse.json({
			count: schedule.length,
			data: schedule,
			success: true,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Erreur inconnue";
		return NextResponse.json({ error: message, success: false }, { status: 500 });
	}
}
