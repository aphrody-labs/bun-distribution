export interface RealtimeEvent {
  schema: string;
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
  truncated?: boolean;
}

const PUBLIC_TABLES = new Set([
  "comments",
  "settings",
  "profiles",
  "discord_channels",
  "discord_messages",
  "discord_polls",
  "discord_poll_options",
]);

export function isPublicSubscription(schema: string, table: string): boolean {
  return schema === "public" && PUBLIC_TABLES.has(table);
}

/** Account rows are private; public subscribers only need an invalidation key. */
export function publicEvent(event: RealtimeEvent): RealtimeEvent | null {
  if (!isPublicSubscription(event.schema, event.table)) return null;
  if (event.table === "settings") {
    return { schema: event.schema, table: event.table, eventType: event.eventType, truncated: true };
  }
  if (event.table === "profiles") {
    const idOnly = (row: Record<string, unknown> | null | undefined) => (row?.id == null ? null : { id: row.id });
    return {
      schema: event.schema,
      table: event.table,
      eventType: event.eventType,
      new: idOnly(event.new),
      old: idOnly(event.old),
      truncated: true,
    };
  }
  return event;
}
