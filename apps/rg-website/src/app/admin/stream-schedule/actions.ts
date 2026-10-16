"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPostgresClient } from "@rosegriffon/db/service";
import { fetchGoogleCalendarEvents } from "@/app/(sousdossiers)/rose-griffon-tv/google-calendar-actions";
import { logAdminAction } from "@/lib/admin-logger";
import { getServerUser } from "@/lib/auth-helpers";

const scheduleSchema = z.object({
	category: z.string().optional(),
	day_of_week: z.coerce.number().min(0).max(6),
	end_time: z
		.string()
		.regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format invalide (HH:MM)")
		.optional()
		.nullable(),
	notes: z.string().optional().nullable(),
	start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format invalide (HH:MM)"),
	status: z.enum(["active", "inactive", "coming_soon"]).default("active"),
	streamer_name: z.string().min(1, "Le nom du streamer est requis"),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;

async function checkAdmin() {
	const supabase = createPostgresClient();
	const user = await getServerUser();

	if (!user) {
		return { error: "Non authentifié", user: null };
	}

	const { data: profile } = await supabase
		.from("profiles")
		.select("role")
		.eq("id", user.id)
		.single();

	if (profile?.role !== "admin") {
		return { error: "Non autorisé", user: null };
	}

	return { error: null, user };
}

export async function addSchedule(data: ScheduleInput) {
	const { error: authError, user } = await checkAdmin();
	if (authError || !user) {
		return { success: false, error: authError };
	}

	const validation = scheduleSchema.safeParse(data);
	if (!validation.success) {
		return { error: "Données invalides", success: false };
	}

	const supabase = createPostgresClient();
	const { data: newSchedule, error } = await supabase
		.from("stream_schedules")
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.insert([validation.data as any])
		.select()
		.single();

	if (error) {
		return { error: error.message, success: false };
	}

	await logAdminAction("create", "stream_schedule", newSchedule.id, data);

	revalidatePath("/admin/stream-schedule");
	revalidatePath("/rose-griffon-tv");
	return { success: true };
}

export async function updateSchedule(id: string, data: Partial<ScheduleInput>) {
	const { error: authError, user } = await checkAdmin();
	if (authError || !user) {
		return { success: false, error: authError };
	}

	const supabase = createPostgresClient();
	const { error } = await supabase.from("stream_schedules").update(data).eq("id", id);

	if (error) {
		return { error: error.message, success: false };
	}

	await logAdminAction("update", "stream_schedule", id, data);

	revalidatePath("/admin/stream-schedule");
	revalidatePath("/rose-griffon-tv");
	return { success: true };
}

export async function deleteSchedule(id: string) {
	const { error: authError, user } = await checkAdmin();
	if (authError || !user) {
		return { success: false, error: authError };
	}

	const supabase = createPostgresClient();
	const { error } = await supabase.from("stream_schedules").delete().eq("id", id);

	if (error) {
		return { error: error.message, success: false };
	}

	await logAdminAction("delete", "stream_schedule", id, {});

	revalidatePath("/admin/stream-schedule");
	revalidatePath("/rose-griffon-tv");
	return { success: true };
}

export async function syncWithGoogleCalendar() {
	const { error: authError, user } = await checkAdmin();
	if (authError || !user) {
		return { success: false, error: authError };
	}

	try {
		const supabase = createPostgresClient();
		const events = await fetchGoogleCalendarEvents(14); // 2 semaines

		// Supprimer l'ancien planning (tout ce qui a un jour valide)
		const { error: deleteError } = await supabase
			.from("stream_schedules")
			.delete()
			.gte("day_of_week", 0);

		if (deleteError) {
			throw deleteError;
		}

		// Insérer le nouveau planning
		if (events.length > 0) {
			const { error: insertError } = await supabase.from("stream_schedules").insert(
				events.map((e) => ({
					category: e.category,
					day_of_week: e.day_of_week,
					start_time: e.start_time!,
					status: "active",
					streamer_name: e.streamer_name,
				}))
			);

			if (insertError) {
				throw insertError;
			}
		}

		await logAdminAction("sync", "stream_schedule", "google-calendar", {
			count: events.length,
		});

		revalidatePath("/admin/stream-schedule");
		revalidatePath("/rose-griffon-tv");
		return { count: events.length, success: true };
	} catch (error) {
		console.error("Erreur sync Google Calendar:", error);
		return {
			error: `Erreur lors de la synchronisation: ${error instanceof Error ? error.message : String(error)}`,
			success: false,
		};
	}
}
