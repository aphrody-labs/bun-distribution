import { NextResponse } from "next/server";

import { getCalendarEvents } from "@/lib/api/events";
import { getPgPool } from "@/lib/db/pg";
import type { CalendarEvent } from "@/types/api";
import type { StreamSchedule } from "@rosegriffon/types";

// Types pour notre réponse unifiée
interface ScheduleSegment {
	id: string;
	start_time: string;
	end_time?: string;
	title: string;
	streamer: string;
	type: "recurring" | "special";
}

export async function GET() {
	try {
		// 1. Récupérer le planning récurrent depuis Postgres (direct, bypass Data API Supabase)
		let recurringSchedules: StreamSchedule[] | null = null;
		try {
			const pool = getPgPool();
			const { rows } = await pool.query<StreamSchedule>(
				`SELECT * FROM stream_schedules WHERE status = $1`,
				["active"]
			);
			recurringSchedules = rows;
		} catch (dbError) {
			console.error("Erreur Postgres Schedule:", dbError);
		}

		// 2. Récupérer les événements ponctuels depuis Google Calendar
		let calendarEvents: CalendarEvent[] = [];

		// Vérification des variables d'environnement Google
		if (
			!process.env.GOOGLE_CLIENT_EMAIL ||
			!process.env.GOOGLE_PRIVATE_KEY ||
			!process.env.GOOGLE_EVENTS_CALENDAR_ID
		) {
			console.warn(
				"⚠️ Variables d'environnement Google Calendar manquantes. Le planning Google ne sera pas chargé."
			);
		}

		try {
			calendarEvents = await getCalendarEvents();
		} catch (calError) {
			console.error("Erreur Google Calendar:", calError);
		}

		// 3. Générer les segments pour les 7 prochains jours
		let segments: ScheduleSegment[] = [];
		const now = new Date();
		const nextWeek = new Date(now);
		nextWeek.setDate(now.getDate() + 7);

		// Traitement du planning récurrent (Supabase)
		if (recurringSchedules) {
			for (let i = 0; i < 7; i++) {
				const currentDate = new Date(now);
				currentDate.setDate(now.getDate() + i);
				const currentDayOfWeek = currentDate.getDay(); // 0 = Dimanche, 1 = Lundi...

				const daysStreams = recurringSchedules.filter((s) => s.day_of_week === currentDayOfWeek);

				daysStreams.forEach((stream) => {
					if (!stream.start_time) {
						return;
					}

					// Combiner la date courante avec l'heure du stream
					const [hours = "0", minutes = "0"] = stream.start_time.split(":");
					const startDate = new Date(currentDate);
					startDate.setHours(Number.parseInt(hours, 10), Number.parseInt(minutes, 10), 0, 0);

					// Calculer la date de fin (si end_time existe, sinon +2h par défaut)
					const endDate = new Date(startDate);
					if (stream.end_time) {
						const [endHours = "0", endMinutes = "0"] = stream.end_time.split(":");
						endDate.setHours(Number.parseInt(endHours, 10), Number.parseInt(endMinutes, 10), 0, 0);
						// Gérer le cas où la fin est le lendemain (ex: 23h -> 01h)
						if (endDate < startDate) {
							endDate.setDate(endDate.getDate() + 1);
						}
					} else {
						endDate.setHours(startDate.getHours() + 2);
					}

					segments.push({
						end_time: endDate.toISOString(),
						id: `recurring-${stream.id}-${i}`,
						start_time: startDate.toISOString(),
						streamer: stream.streamer_name || "Rose Griffon TV",
						title: stream.category || "Stream RGTV",
						type: "recurring",
					});
				});
			}
		}

		// Traitement des événements Google Calendar
		calendarEvents.forEach((event) => {
			const start = event.start?.dateTime || event.start?.date;
			const end = event.end?.dateTime || event.end?.date;

			if (!start) {
				return;
			}

			const startDate = new Date(start);
			const endDate = end ? new Date(end) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // +2h par défaut

			if (startDate >= now && startDate <= nextWeek) {
				segments.push({
					end_time: endDate.toISOString(),
					id: event.id || `cal-${Math.random()}`,
					start_time: startDate.toISOString(),
					streamer: "Event Spécial",
					title: event.summary || "Événement Spécial",
					type: "special",
				});
			}
		});

		// 3.5 Gestion des conflits : Les événements spéciaux (Google Cal) remplacent le planning récurrent
		// On filtre les événements récurrents qui chevauchent un événement spécial
		segments = segments.filter((segment) => {
			if (segment.type === "special") {
				return true;
			} // On garde toujours les spéciaux

			const segmentStart = new Date(segment.start_time).getTime();
			const segmentEnd = segment.end_time
				? new Date(segment.end_time).getTime()
				: segmentStart + 2 * 3_600_000;

			// Chercher un conflit avec un événement spécial
			const hasConflict = segments.some((special) => {
				if (special.type !== "special") {
					return false;
				}

				const specialStart = new Date(special.start_time).getTime();
				const specialEnd = special.end_time
					? new Date(special.end_time).getTime()
					: specialStart + 2 * 3_600_000;

				// Vérifier le chevauchement
				return segmentStart < specialEnd && segmentEnd > specialStart;
			});

			return !hasConflict;
		});

		// 4. Trier par date
		segments.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

		// 5. Retourner la réponse formatée
		const headers = {
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Origin": "*",
		};

		return NextResponse.json(
			{ data: { segments } }, // Structure compatible avec notre extension
			{ headers }
		);
	} catch (error) {
		console.error("Erreur globale API Schedule:", error);
		return NextResponse.json({ error: "Erreur interne serveur" }, { status: 500 });
	}
}

export async function OPTIONS() {
	return NextResponse.json(
		{},
		{
			headers: {
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Origin": "*",
			},
		}
	);
}
