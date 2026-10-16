"use server";

import { google } from "googleapis";

import { createLogger } from "@/lib/logger";
import type { StreamSchedule } from "@rosegriffon/types";


const logger = createLogger("google-calendar");

// Configuration
const CALENDAR_ID =
	process.env.GOOGLE_RGTV_CALENDAR_ID || // ← Calendrier RGTV
	"ddff4b7c1d7853215b8cce54fb1819abd1fd79b63f918fa2e6912868d416ff83@group.calendar.google.com";

// Jours de la semaine
const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

/**
 * Initialise le client Google Calendar via service account JWT.
 * Le service account doit avoir accès en lecture au calendar (partage explicite côté UI Google Calendar).
 */
function getCalendarClient() {
	const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	if (!credentialsPath) {
		throw new Error("GOOGLE_APPLICATION_CREDENTIALS non configurée");
	}

	const auth = new google.auth.GoogleAuth({
		keyFile: credentialsPath,
		scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
	});

	return google.calendar({
		auth,
		version: "v3",
	});
}

/**
 * Parse le titre de l'événement pour extraire le streamer et la catégorie
 * Format attendu: "Stream [STREAMER] - [CATÉGORIE]"
 * Exemples:
 *   "Stream Ethan - Inazuma Eleven GO" → { streamer: "Ethan", category: "Inazuma Eleven GO" }
 *   "Stream Roy - Ranked Online" → { streamer: "Roy", category: "Ranked Online" }
 */
function parseEventTitle(title: string): {
	streamer_name: string;
	category: string;
} {
	// Regex pour capturer "Stream [NOM] - [CATÉGORIE]"
	const match = title.match(/Stream\s+(.+?)\s*-\s*(.+)/i);

	if (match) {
		return {
			category: match[2]?.trim() ?? "Stream",
			streamer_name: match[1]?.trim() ?? "Inconnu",
		};
	}

	// Fallback: tout le titre comme streamer_name
	return {
		category: "Stream",
		streamer_name: title.replace(/Stream\s*/i, "").trim(),
	};
}

/**
 * Transforme un événement Google Calendar en StreamSchedule
 */
function transformEvent(event: unknown): StreamSchedule | null {
	const calendarEvent = event as Record<string, unknown>;
	try {
		if (!calendarEvent.start || !calendarEvent.end) {
			logger.warn("Événement sans dateTime, ignoré", {
				id: calendarEvent.id,
				summary: calendarEvent.summary,
			});
			return null;
		}

		const startInfo = calendarEvent.start as Record<string, string>;
		const endInfo = calendarEvent.end as Record<string, string>;

		if (!startInfo.dateTime || !endInfo.dateTime) {
			logger.warn("Événement sans dateTime, ignoré", {
				id: calendarEvent.id,
				summary: calendarEvent.summary,
			});
			return null;
		}

		const startDate = new Date(startInfo.dateTime);
		const endDate = new Date(endInfo.dateTime);

		// Parser le titre
		const { streamer_name, category } = parseEventTitle(
			(calendarEvent.summary as string) || "Stream"
		);

		// Formater les heures en HH:MM (fuseau horaire Europe/Paris)
		const start_time = startDate.toLocaleTimeString("fr-FR", {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
			timeZone: "Europe/Paris",
		});

		const end_time = endDate.toLocaleTimeString("fr-FR", {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
			timeZone: "Europe/Paris",
		});

		// Jour de la semaine (0-6) en Europe/Paris
		const day_of_week = new Date(
			startDate.toLocaleString("en-US", { timeZone: "Europe/Paris" })
		).getDay();

		return {
			category,
			created_at: (calendarEvent.created as string) || new Date().toISOString(),
			day_of_week,
			end_time,
			id: (calendarEvent.id as string) || `gcal-${Date.now()}`,
			notes: (calendarEvent.description as string) || null,
			start_time,
			status: "active",
			streamer_name,
			updated_at: (calendarEvent.updated as string) || new Date().toISOString(),
		};
	} catch (error) {
		logger.error("Erreur transformation événement", {
			error: error instanceof Error ? error.message : String(error),
			event: calendarEvent.summary,
		});
		return null;
	}
}

/**
 * Récupère les événements du Google Calendar
 * @param daysAhead Nombre de jours à récupérer (défaut: 7)
 */
export async function fetchGoogleCalendarEvents(daysAhead: number = 7): Promise<StreamSchedule[]> {
	try {
		if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
			logger.warn("GOOGLE_APPLICATION_CREDENTIALS non configurée");
			return [];
		}

		const calendar = getCalendarClient();

		// Calculer timeMin et timeMax
		const now = new Date();
		const timeMin = now.toISOString();
		const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

		logger.debug("Récupération événements Google Calendar", {
			calendarId: `${CALENDAR_ID.substring(0, 20)}...`,
			timeMax,
			timeMin,
		});

		const response = await calendar.events.list({
			calendarId: CALENDAR_ID,
			maxResults: 50,
			orderBy: "startTime",
			singleEvents: true,
			timeMax,
			timeMin,
		});

		const events = response.data.items || [];
		// Logger supprimé pour éviter les warnings en production

		// Transformer en StreamSchedule
		let schedules = events.map(transformEvent).filter((s): s is StreamSchedule => s !== null);

		// Déduplication: éliminer les événements en doublon basés sur streamer_name + start_time + day_of_week
		const uniqueSchedules = new Map<string, StreamSchedule>();
		schedules.forEach((schedule) => {
			const key = `${schedule.streamer_name}|${schedule.start_time}|${schedule.day_of_week}`;
			if (!uniqueSchedules.has(key)) {
				uniqueSchedules.set(key, schedule);
			}
		});
		schedules = [...uniqueSchedules.values()];

		logger.debug(
			`${schedules.length} événement(s) transformé(s) avec succès (après déduplication)`
		);

		return schedules;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error("Erreur lors de la récupération Google Calendar", {
			error: errorMessage,
			code:
				error instanceof Error && "code" in error
					? (error as Record<string, unknown>).code
					: undefined,
		});
		throw error;
	}
}

/**
 * Récupère les horaires groupés par jour depuis Google Calendar
 */
export async function getGoogleCalendarSchedulesByDay(): Promise<Record<string, StreamSchedule[]>> {
	try {
		const schedules = await fetchGoogleCalendarEvents(14); // 2 semaines

		// Grouper par jour
		const groupedByDay: Record<string, StreamSchedule[]> = {};

		schedules.forEach((schedule) => {
			const dayName = DAYS[schedule.day_of_week] ?? "Inconnu";
			if (!groupedByDay[dayName]) {
				groupedByDay[dayName] = [];
			}
			groupedByDay[dayName]?.push(schedule);
		});

		// Trier chaque jour par heure de début
		Object.keys(groupedByDay).forEach((day) => {
			groupedByDay[day]?.sort((a, b) => {
				if (!a.start_time || !b.start_time) {
					return 0;
				}
				return a.start_time.localeCompare(b.start_time);
			});
		});

		logger.info(`Planning groupé: ${Object.keys(groupedByDay).length} jour(s) avec streams`);

		return groupedByDay;
	} catch (error) {
		logger.error("Erreur dans getGoogleCalendarSchedulesByDay", error);
		return {};
	}
}

/**
 * Vérifie si l'API Google Calendar est configurée (service account JSON présent)
 */
export async function isGoogleCalendarConfigured(): Promise<boolean> {
	return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}
