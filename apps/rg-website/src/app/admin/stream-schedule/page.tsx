import { AdminPageHeader } from "@rosegriffon/ui";
import { createPostgresClient } from "@rosegriffon/db/service";

import { StreamScheduleManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function StreamSchedulePage() {
  const { data: schedules } = await createPostgresClient()
    .from("stream_schedules")
    .select("*")
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  return (
    <div className="p-6 space-y-6">
      <AdminPageHeader title="Planning Streams" description="Gérez le planning de la Rose Griffon TV (Twitch)." />
      <StreamScheduleManager initialSchedules={schedules || []} />
    </div>
  );
}
