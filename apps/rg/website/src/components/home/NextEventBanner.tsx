"use client";

import { useClock } from "@/hooks/use-clock";
import { ArrowRight, Clock, MapPin } from "lucide-react";
import Link from "next/link";

import type { CalendarEvent } from "@/types/api";

interface NextEventBannerProps {
  event: CalendarEvent;
}

export function NextEventBanner({ event }: NextEventBannerProps) {
  const now = useClock();
  if (!event?.start) {
    return null;
  }

  // Sécurisation des dates
  const startDateStr = event.start.dateTime || event.start.date;

  if (!startDateStr) {
    return null;
  }

  const startDate = new Date(startDateStr);

  // Formatage
  const day = startDate.toLocaleDateString("fr-FR", { day: "numeric" });
  const month = startDate.toLocaleDateString("fr-FR", { month: "short" });
  const time = event.start.dateTime
    ? startDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const isToday = new Date(now).toDateString() === startDate.toDateString();

  return (
    <section className="w-full px-4 min-[600px]:px-0">
      <div className="flex min-h-16 items-center gap-3 bg-linear-to-r from-violet-600 to-indigo-600 px-4 py-2 text-white">
        <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-white/15">
          <span className="text-lg font-bold leading-none">{day}</span>
          <span className="text-[10px] font-medium uppercase">{month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-indigo-100">
            <span>{isToday ? "En ce moment" : "Prochain événement"}</span>
            {time && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {time}
              </span>
            )}
          </div>
          <h2 className="truncate text-sm font-bold min-[600px]:text-base">{event.summary}</h2>
          {event.location && (
            <span className="hidden items-center gap-1 truncate text-xs text-indigo-100 min-[600px]:flex">
              <MapPin className="size-3" aria-hidden />
              {event.location}
            </span>
          )}
        </div>
        <Link
          href="/evenements"
          aria-label={`Voir l'événement ${event.summary}`}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 hover:bg-indigo-50"
        >
          <ArrowRight className="size-5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export default NextEventBanner;
