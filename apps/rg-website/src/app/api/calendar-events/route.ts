import { getCalendarEvents } from "@/lib/api/events";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getPgPool } from "@/lib/db/pg";
import { createLogger } from "@/lib/logger";
import { withRateLimit } from "@/lib/rate-limit";
import type { CalendarEvent } from "@/types/api";

// Configuration du cache - revalider toutes les 5 minutes
export const revalidate = 300;

const logger = createLogger("calendar-events");

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

async function calendarEventsHandler() {
  try {
    logger.debug("Fetching calendar events via API route");

    // 1. Try fetching from Postgres direct (Source of Truth)
    let dbEvents: EventRow[] = [];
    try {
      const pool = getPgPool();
      const { rows } = await pool.query<EventRow>("SELECT * FROM events ORDER BY start_time ASC");
      dbEvents = rows;
    } catch (error) {
      logger.error("Error fetching events from Postgres", error);
      dbEvents = [];
    }

    if (dbEvents.length > 0) {
      logger.info(`${dbEvents.length} event(s) retrieved from Postgres (DB Source)`);

      const mappedEvents: CalendarEvent[] = dbEvents.map(e => ({
        description: e.description,
        end: {
          dateTime: e.end_time, // Assumes ISO string stored in text column
          timeZone: "Europe/Paris",
        },
        id: e.id,
        location: e.location,
        start: {
          dateTime: e.start_time, // Assumes ISO string stored in text column
          timeZone: "Europe/Paris",
        },
        summary: e.title,
      }));

      return apiSuccess({ events: mappedEvents });
    }

    // 2. Fallback to Google Calendar if DB is empty
    logger.info("Postgres events empty or error, falling back to Google Calendar");
    const events = await getCalendarEvents();

    // Amorçage unique : la table locale devient la source de vérité dès la
    // première récupération réussie. Les événements passés restent donc
    // consultables même si le calendrier Google est ensuite indisponible.
    if (events.length > 0) {
      try {
        const pool = getPgPool();
        const rows = events
          .map(event => ({
            description: event.description ?? null,
            endTime: event.end?.dateTime ?? event.end?.date,
            location: event.location ?? null,
            startTime: event.start?.dateTime ?? event.start?.date,
            title: event.summary ?? "Événement sans titre",
          }))
          .filter(event => event.startTime && event.endTime);

        if (rows.length > 0) {
          await pool.query(
            `INSERT INTO events (title, description, start_time, end_time, location)
						 SELECT item.title, item.description, item.start_time, item.end_time, item.location
						 FROM jsonb_to_recordset($1::jsonb) AS item(
							title text, description text, start_time timestamptz, end_time timestamptz, location text
						 )
						 WHERE NOT EXISTS (SELECT 1 FROM events)`,
            [
              JSON.stringify(
                rows.map(({ endTime, startTime, ...event }) => ({
                  ...event,
                  end_time: endTime,
                  start_time: startTime,
                })),
              ),
            ],
          );
          logger.info(`${rows.length} event(s) Google préchargé(s) dans Postgres`);
        }
      } catch (error) {
        // La réponse Google reste disponible : l'amorçage ne doit jamais
        // empêcher l'affichage public du calendrier.
        logger.error("Impossible de précharger les événements dans Postgres", error);
      }
    }
    logger.info(`${events.length} event(s) retrieved from Google`);
    return apiSuccess({ events });
  } catch (error) {
    logger.error("Error in calendar events API route", error);
    return apiError("Impossible de récupérer les événements du calendrier", 500, "CALENDAR_FETCH_ERROR");
  }
}

// Appliquer le rate limiting: 20 requêtes par minute
export const GET = withRateLimit(calendarEventsHandler, {
  limit: 20,
  windowMs: 60_000,
});
