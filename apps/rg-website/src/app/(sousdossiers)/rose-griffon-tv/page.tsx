import { BreadcrumbSchema } from "@/components/shared/StructuredData";

import { RgtvPageClient } from "./_components/RgtvPageClient";
import { checkStreamerPermission } from "./actions";
import {
	getGoogleCalendarSchedulesByDay,
	isGoogleCalendarConfigured,
} from "./google-calendar-actions";
import { getSchedulesByDay } from "./stream-schedule-actions";

export const dynamic = "force-dynamic";

export default async function RoseGriffonTvPage() {
	let scheduleByDay;
	let scheduleError: unknown = null;
	let isStreamer = false;

	try {
		// Vérifier les permissions streamer
		isStreamer = await checkStreamerPermission();

		// Vérifier si Google Calendar est configuré
		const isGCalConfigured = await isGoogleCalendarConfigured();

		if (isGCalConfigured) {
			// Priorité: Google Calendar
			try {
				scheduleByDay = await getGoogleCalendarSchedulesByDay();
				// Console.log("✅ Planning chargé depuis Google Calendar");
			} catch (gcalError) {
				console.warn("⚠️ Google Calendar échoué, fallback sur Supabase", gcalError);
				// Fallback sur Supabase
				scheduleByDay = await getSchedulesByDay();
			}
		} else {
			// Pas de Google Calendar configuré, utiliser Supabase
			scheduleByDay = await getSchedulesByDay();
			// Console.log(
			//   "📊 Planning chargé depuis Supabase (Google Calendar non configuré)"
			// );
		}
	} catch (error) {
		scheduleError = error;
		scheduleByDay = {};
		console.error("❌ Erreur chargement planning:", error);
	}

	return (
		<>
			<BreadcrumbSchema
				items={[
					{ item: "/", name: "Accueil" },
					{ item: "/rose-griffon-tv", name: "Rose Griffon TV" },
				]}
			/>
			<RgtvPageClient
				scheduleByDay={scheduleByDay}
				scheduleError={scheduleError}
				isStreamer={isStreamer}
			/>
		</>
	);
}
