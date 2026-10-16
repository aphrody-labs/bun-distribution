"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logAdminAction } from "@/lib/admin-logger";
import { getCalendarEvents } from "@/lib/api/events";
import { getServerUser } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";
import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import type { Insert } from "@rosegriffon/db";

async function ensureAdmin() {
  const user = await getServerUser();
  if (!user) {
    throw new Error("Non authentifié");
  }
  const adminClient = createPostgresClient();
  const profile = await resolveProfile(adminClient, user);
  if (!profile || !isAdmin(profile.role)) {
    throw new Error("Accès refusé");
  }
  return user;
}

const eventSchema = z.object({
  description: z.string().optional(),
  end_time: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: "Date de fin invalide",
    }),
  image_url: z.string().optional(),
  location: z.string().optional(),
  start_time: z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: "Date de début invalide",
  }),
  title: z.string().min(3, "Le titre doit contenir au moins 3 caractères"),
});

interface ActionState {
  message?: string;
  errors?: Record<string, string[]>;
  success?: boolean;
}

export async function syncGoogleEvents() {
  await ensureAdmin();
  const db = createPostgresClient();
  const googleEvents = await getCalendarEvents();

  const validEvents = googleEvents.filter((event) => event.summary && event.start);
  if (validEvents.length === 0) {
    return { imported: 0, skipped: 0, success: true };
  }

  // Extract all start times
  const startTimes = validEvents
    .map((event) => event.start?.dateTime || event.start?.date)
    .filter(Boolean) as string[];

  if (startTimes.length === 0) {
    return { imported: 0, skipped: 0, success: true };
  }

  // Sort to get min and max boundary for query optimization
  const sortedTimes = [...startTimes].sort();
  const minTime = sortedTimes[0];
  const maxTime = sortedTimes[sortedTimes.length - 1];

  // Fetch all existing events within this time boundary
  const { data: existingEvents, error: fetchError } = await db
    .from("events")
    .select("id, title, start_time")
    .gte("start_time", minTime)
    .lte("start_time", maxTime);

  if (fetchError) {
    console.error("Error fetching existing events:", fetchError);
    return { imported: 0, skipped: 0, success: false };
  }

  const existingSet = new Set(
    (existingEvents || []).map(
      (e: { title: string; start_time: string }) => `${e.title}|${e.start_time}`,
    ),
  );

  const eventsToInsert: Insert<"events">[] = [];
  let skippedCount = 0;

  for (const event of validEvents) {
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;

    if (!startTime) {
      skippedCount++;
      continue;
    }

    const key = `${event.summary}|${startTime}`;
    if (existingSet.has(key)) {
      skippedCount++;
      continue;
    }

    eventsToInsert.push({
      title: event.summary!,
      description: event.description || "",
      location: event.location || "",
      start_time: startTime,
      end_time: endTime || startTime,
      image_url: null,
    });
  }

  let importedCount = 0;
  if (eventsToInsert.length > 0) {
    const { error: insertError } = await db.from("events").insert(eventsToInsert);

    if (insertError) {
      console.error("Error batch inserting events:", insertError);
      return { imported: 0, skipped: skippedCount, success: false };
    }
    importedCount = eventsToInsert.length;
  }

  const user = await getServerUser();
  if (user) {
    await logAdminAction("sync", "events", undefined, {
      imported: importedCount,
      skipped: skippedCount,
    });
  }

  revalidatePath("/admin/events");
  return { imported: importedCount, skipped: skippedCount, success: true };
}

export async function createEvent(_prevState: ActionState, formData: FormData) {
  try {
    await ensureAdmin();
  } catch {
    return {
      message: "Accès refusé",
    };
  }
  const db = createPostgresClient();

  const rawData = {
    description: formData.get("description"),
    end_time: formData.get("end_time") || null,
    image_url: formData.get("image_url"),
    location: formData.get("location"),
    start_time: formData.get("start_time"),
    title: formData.get("title"),
  };

  const validatedFields = eventSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Erreur de validation des champs",
    };
  }

  // Casting validatedFields.data to Insert<"events"> to ensure compatibility
  // Zod schema should match DB schema but sometimes optional vs null can vary
  const eventData: Insert<"events"> = {
    description: validatedFields.data.description,
    end_time: validatedFields.data.end_time || validatedFields.data.start_time,
    image_url: validatedFields.data.image_url,
    location: validatedFields.data.location,
    start_time: validatedFields.data.start_time,
    title: validatedFields.data.title,
  };

  const { error } = await db.from("events").insert([eventData]);

  if (error) {
    return {
      message: `Erreur lors de la création de l'événement: ${error.message}`,
    };
  }

  const user = await getServerUser();

  if (user) {
    await logAdminAction("create", "event", undefined, validatedFields.data);
  }

  revalidatePath("/admin/events");
  redirect("/admin/events");
}

export async function updateEvent(id: string, _prevState: ActionState, formData: FormData) {
  try {
    await ensureAdmin();
  } catch {
    return {
      message: "Accès refusé",
    };
  }
  const db = createPostgresClient();

  const rawData = {
    description: formData.get("description"),
    end_time: formData.get("end_time") || null,
    image_url: formData.get("image_url"),
    location: formData.get("location"),
    start_time: formData.get("start_time"),
    title: formData.get("title"),
  };

  const validatedFields = eventSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Erreur de validation des champs",
    };
  }

  // Clean the data to match Update<"events"> (remove nulls for fields that don't allow it)
  const updateData = {
    ...validatedFields.data,
    end_time: validatedFields.data.end_time || undefined,
  };

  const { error } = await db.from("events").update(updateData).eq("id", id);

  if (error) {
    return {
      message: `Erreur lors de la mise à jour de l'événement: ${error.message}`,
    };
  }

  const user = await getServerUser();

  if (user) {
    await logAdminAction("update", "event", id, validatedFields.data);
  }

  revalidatePath("/admin/events");
  redirect("/admin/events");
}

export async function deleteEvent(id: string) {
  try {
    await ensureAdmin();
  } catch {
    return {
      message: "Accès refusé",
      success: false,
    };
  }
  const db = createPostgresClient();

  const { error } = await db.from("events").delete().eq("id", id);

  if (error) {
    return {
      message: `Erreur lors de la suppression de l'événement: ${error.message}`,
    };
  }

  const user = await getServerUser();

  if (user) {
    await logAdminAction("delete", "event", id, {});
  }

  revalidatePath("/admin/events");
  return { success: true };
}
