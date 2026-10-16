"use server";

import { getPgPool } from "@/lib/db/pg";
import { createLogger } from "@/lib/logger";
import type { StreamSchedule } from "@rosegriffon/types";

const logger = createLogger("stream-schedule");

const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function isValidTimeFormat(time: unknown): boolean {
	if (typeof time !== "string") {
		return false;
	}
	return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

/**
 * Récupère tous les horaires de stream groupés par jour
 *
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST) — cf. lib/db/pg.ts.
 */
export async function getSchedulesByDay(): Promise<Record<string, StreamSchedule[]>> {
	try {
		const pool = getPgPool();

		logger.debug("Récupération des horaires actifs");

		let schedules: StreamSchedule[];
		try {
			const result = await pool.query<StreamSchedule>(
				`SELECT * FROM stream_schedules WHERE status = $1 ORDER BY day_of_week ASC, start_time ASC`,
				["active"]
			);
			schedules = result.rows;
		} catch (error) {
			logger.error("Erreur lors de la récupération des horaires actifs:", error);
			return {};
		}

		// Grouper par jour
		const groupedByDay: Record<string, StreamSchedule[]> = {};

		schedules?.forEach((schedule) => {
			const dayIndex = schedule.day_of_week % 7; // Ensure valid index
			const dayName = DAYS[dayIndex];

			if (!dayName) {
				return;
			}

			if (!groupedByDay[dayName]) {
				groupedByDay[dayName] = [];
			}

			// Valider les formats de temps
			if (!isValidTimeFormat(schedule.start_time) || !isValidTimeFormat(schedule.end_time)) {
				logger.warn(`Format d'heure invalide pour ${schedule.streamer_name}`, {
					end_time: schedule.end_time,
					start_time: schedule.start_time,
				});
			}

			groupedByDay[dayName].push(schedule as unknown as StreamSchedule);
		});

		logger.debug(
			`${Object.keys(groupedByDay).length} jour(s) avec ${schedules?.length || 0} stream(s)`
		);

		// Ajouter les "à venir"
		let comingSoon: StreamSchedule[] | undefined;
		try {
			const result = await pool.query<StreamSchedule>(
				`SELECT * FROM stream_schedules WHERE status = $1 ORDER BY created_at DESC`,
				["coming_soon"]
			);
			comingSoon = result.rows;
		} catch (error) {
			logger.warn("Erreur lors de la récupération des streams à venir:", error);
		}

		if (comingSoon && comingSoon.length > 0) {
			logger.debug(`${comingSoon.length} stream(s) à venir`);
			groupedByDay.Prochainement = comingSoon as unknown as StreamSchedule[];
		}

		return groupedByDay;
	} catch (error) {
		logger.error("Exception dans getSchedulesByDay:", error);
		return {};
	}
}

/**
 * Récupère tous les horaires de stream sans groupement
 *
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST) — cf. lib/db/pg.ts.
 */
export async function getAllSchedules(): Promise<StreamSchedule[]> {
	try {
		const pool = getPgPool();

		logger.debug("Récupération de tous les horaires");

		let schedules: StreamSchedule[];
		try {
			const result = await pool.query<StreamSchedule>(
				`SELECT * FROM stream_schedules ORDER BY day_of_week ASC, start_time ASC`
			);
			schedules = result.rows;
		} catch (error) {
			logger.error("Erreur lors de la récupération de tous les horaires:", error);
			return [];
		}

		logger.debug(`${schedules?.length || 0} horaire(s) récupéré(s)`);
		return (schedules || []) as unknown as StreamSchedule[];
	} catch (error) {
		logger.error("Exception dans getAllSchedules:", error);
		return [];
	}
}
