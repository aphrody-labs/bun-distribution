import { Button } from "@rosegriffon/ui";
import Link from "next/link";

import { EventForm } from "@/components/admin/events/event-form";

import { ArrowLeft } from "@/lib/icons-config";

export default function NewEventPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center space-x-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/events">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Nouvel Événement</h1>
      </div>

      <EventForm />
    </div>
  );
}
