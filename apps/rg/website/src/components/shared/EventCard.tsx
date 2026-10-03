"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { useClock } from "@/hooks/use-clock";

import { Button, Card } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { memo, useMemo } from "react";

import { ArrowRight, CalendarDays, MapPin } from "@/lib/icons-config";
import type { CalendarEvent } from "@/types/api";

interface EventCardProps {
  event: CalendarEvent;
}

function EventCard({ event }: EventCardProps) {
  const eventDate = useMemo(
    () => new Date(event.start?.dateTime || event.start?.date || ""),
    [event.start?.dateTime, event.start?.date],
  );
  const mounted = useHydrated();
  const now = useClock();
  const isUpcoming = !mounted || eventDate.getTime() > now;

  return (
    <Card
      key={event.id}
      className="group relative flex flex-col sm:flex-row items-start sm:items-center p-4 sm:p-5 hover:shadow-2xl transition-all duration-300 border-l-4 overflow-hidden hover:scale-[1.02]"
      style={{ borderLeftColor: "#a14b3f" }}
    >
      {/* Background gradient effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none"
        style={{
          background: "linear-gradient(to right, #a14b3f, transparent)",
        }}
      />

      {/* Icon avec background coloré */}
      <div className="relative shrink-0 mb-3 sm:mb-0 sm:mr-4 md:mr-5">
        <div
          className="relative p-2 sm:p-3 rounded-xl transition-transform duration-300 group-hover:scale-110"
          style={{ backgroundColor: "rgba(161, 75, 63, 0.1)" }}
        >
          <CalendarDays className="size-6 sm:w-7 sm:h-7" style={{ color: "#a14b3f" }} />
          {isUpcoming && (
            <div
              className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full animate-pulse"
              style={{ backgroundColor: "#a14b3f" }}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative grow w-full sm:w-auto">
        <h3 className="text-base sm:text-lg font-bold mb-1 group-hover:text-[#a14b3f] transition-colors duration-300 line-clamp-2">
          {event.summary}
        </h3>
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <p className="text-xs sm:text-sm font-medium" style={{ color: "#a14b3f" }}>
            📅 {format(eventDate, "EEEE dd MMMM yyyy", { locale: fr })}
          </p>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            🕐 {mounted ? format(eventDate, "HH:mm", { locale: fr }) : "00:00"}
          </p>
          {event.location && (
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center mt-0.5 sm:mt-1">
              <MapPin className="size-3 sm:w-4 sm:h-4 mr-1 shrink-0" />
              <span className="truncate">{event.location}</span>
            </p>
          )}
        </div>
      </div>

      {/* Button */}
      {event.extendedProperties?.shared?.eventLink && (
        <Button
          asChild
          size="sm"
          className="relative mt-3 sm:mt-4 md:mt-0 md:ml-4 text-white hover:scale-105 transition-all duration-300 shadow-md hover:shadow-lg group/btn overflow-hidden w-full sm:w-auto"
          style={{ backgroundColor: "#a14b3f" }}
        >
          <Link
            href={event.extendedProperties.shared.eventLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="absolute inset-0 bg-white opacity-0 group-hover/btn:opacity-20 transition-opacity duration-300" />
            <span className="relative flex items-center justify-center text-xs sm:text-sm">
              Rejoindre l&apos;événement
              <ArrowRight className="ml-2 size-3 sm:h-4 sm:w-4 shrink-0 group-hover/btn:translate-x-1 transition-transform duration-300" />
            </span>
          </Link>
        </Button>
      )}
    </Card>
  );
}

export default memo(EventCard);
