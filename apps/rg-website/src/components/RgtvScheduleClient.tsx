"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";
import Image from "next/image";

import { useTheme } from "@/contexts/theme-context";
import { AlertCircle, CalendarDays, Clock, Zap } from "@/lib/icons-config";
import { createLogger } from "@/lib/logger";
import type { StreamSchedule } from "@rosegriffon/types";

const logger = createLogger("RgtvSchedule");

// Ordre de tri des jours pour cohérence (Lundi en premier, Dimanche en dernier)
const DAY_ORDER = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche", "Prochainement"];

// Cache et revalidation - Récupérer les données toutes les heures
// Maintenant géré par le wrapper serveur

interface RgtvScheduleClientProps {
  scheduleByDay: Record<string, StreamSchedule[]>;
  error: unknown;
}

function formatTime(time: string | null): string {
  if (!time) {
    logger.debug("formatTime: temps null reçu");
    return "??";
  }

  // Valider que c'est un format HH:MM valid
  if (!/^\d{2}:\d{2}/.test(time)) {
    logger.warn(`formatTime: format invalide reçu: ${time}`);
    return "??";
  }

  const formatted = time.slice(0, 5); // "HH:MM"
  logger.debug(`formatTime: ${time} -> ${formatted}`);
  return formatted;
}

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  const range = `${start}${endTime ? ` - ${end}` : " - ??"}`;
  logger.debug(`formatTimeRange: ${startTime} - ${endTime} -> ${range}`);
  return range;
}

/**
 * Trie les jours de manière cohérente (lun-dim)
 * Logging amélioré pour déboguer les anomalies de tri
 */
function sortDaysByOrder(days: string[]): string[] {
  logger.debug(`sortDaysByOrder: tri de ${days.length} jour(s)`, { days });

  const sorted = days.toSorted((a, b) => {
    const indexA = DAY_ORDER.indexOf(a);
    const indexB = DAY_ORDER.indexOf(b);

    // Si le jour n'est pas dans DAY_ORDER, le placer à la fin
    if (indexA === -1) {
      logger.warn(`sortDaysByOrder: jour inconnu: ${a}`);
      return 1;
    }
    if (indexB === -1) {
      logger.warn(`sortDaysByOrder: jour inconnu: ${b}`);
      return -1;
    }

    return indexA - indexB;
  });

  logger.debug(`sortDaysByOrder: résultat`, { sorted });
  return sorted;
}

/**
 * Trie les streams par heure de début au sein d'une même journée
 */
function sortSchedulesByTime(schedules: StreamSchedule[]): StreamSchedule[] {
  logger.debug(`sortSchedulesByTime: tri de ${schedules.length} stream(s)`);

  return schedules.toSorted((a, b) => {
    // Si aucune heure de début, placer à la fin
    if (!a.start_time) {
      return 1;
    }
    if (!b.start_time) {
      return -1;
    }

    const [aH = 0, aM = 0] = a.start_time.split(":").map(Number);
    const [bH = 0, bM = 0] = b.start_time.split(":").map(Number);

    const aMinutes = aH * 60 + aM;
    const bMinutes = bH * 60 + bM;

    return aMinutes - bMinutes;
  });
}

export function RgtvScheduleClient({ scheduleByDay, error }: RgtvScheduleClientProps) {
  const { colors } = useTheme();

  const isEmpty = Object.keys(scheduleByDay || {}).length === 0;
  const sortedDays = sortDaysByOrder(Object.keys(scheduleByDay || {}));

  logger.debug(`RgtvSchedule: isEmpty=${isEmpty}, jours triés=${sortedDays.length}`);

  return (
    <Card
      className="border-2 shadow-2xl relative overflow-hidden group hover:shadow-lg transition-all duration-500"
      style={{
        backgroundColor: `${colors.background}F0`,
        borderColor: "#345182" + "80",
      }}
    >
      {/* Effet de ligne d'énergie */}
      <div
        className="absolute top-0 left-0 w-full h-1 opacity-50"
        style={{
          background: `linear-gradient(to right, transparent, #d63901, transparent)`,
        }}
      />
      <div
        className="absolute -top-20 -right-20 size-40 rounded-full blur-3xl group-hover:opacity-30 transition-all duration-500 opacity-10"
        style={{ backgroundColor: "#d63901" }}
      />

      <CardHeader className="relative z-10 pb-4">
        <CardTitle
          className="text-2xl flex items-center gap-2"
          style={{
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            background: `linear-gradient(to right, #345182, #d63901, #345182)`,
            backgroundClip: "text",
          }}
        >
          <Image src="/rgtv/rgtv.webp" alt="RGTV" width={24} height={24} className="size-6 shrink-0" />
          <span>Planning des Streams</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="relative z-10">
        {error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="p-4 bg-red-500/20 rounded-lg">
              <AlertCircle className="size-10 text-red-400 mx-auto mb-2" />
            </div>
            <div className="text-center">
              <p className="text-red-300 text-sm font-semibold mb-1">Erreur lors du chargement du planning</p>
              <p className="text-red-300/60 text-xs">Veuillez rafraîchir la page</p>
            </div>
          </div>
        ) : isEmpty ? (
          <div className="relative">
            <div
              className="absolute inset-0 opacity-10 bg-cover bg-center rounded-lg"
              style={{
                backgroundImage: "url(/rgtv/axel.webp)",
                filter: "blur(2px)",
              }}
            />
            <div className="flex flex-col items-center justify-center py-12 gap-4 relative z-10">
              <div className="p-4 bg-purple-500/20 rounded-lg">
                <Zap className="size-10 text-purple-400 mx-auto mb-2" />
              </div>
              <div className="text-center">
                <p className="text-purple-300 text-sm font-semibold mb-1">Planning à venir !</p>
                <p className="text-purple-300/60 text-xs">Les horaires des streams seront disponibles très bientôt</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {sortedDays.map(day => {
              const rawSchedules = scheduleByDay[day] || [];
              const schedules = sortSchedulesByTime(rawSchedules);
              const totalMinutesStreamed = schedules.reduce((acc, schedule) => {
                if (!schedule.start_time || !schedule.end_time) return acc;
                const [startH = 0, startM = 0] = schedule.start_time.split(":").map(Number);
                const [endH = 0, endM = 0] = schedule.end_time.split(":").map(Number);
                let diff = endH * 60 + endM - (startH * 60 + startM);
                if (diff < 0) {
                  diff += 1440; // Gère le passage à la journée suivante (24h * 60m)
                }
                return acc + diff;
              }, 0);
              const hoursStreamed = (totalMinutesStreamed / 60).toFixed(1);

              return (
                <div key={day} className="group/day">
                  <div
                    className="flex items-center gap-3 mb-3 pb-2 border-b group-hover/day:border-opacity-60 transition-colors"
                    style={{ borderColor: "#345182" + "50" }}
                  >
                    <CalendarDays className="size-5 shrink-0" style={{ color: "#d63901" }} />
                    <div className="flex-1 min-w-0">
                      <h3
                        className="font-bold text-lg truncate"
                        style={{
                          background: `linear-gradient(to right, #345182, #d63901)`,
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          backgroundClip: "text",
                        }}
                      >
                        {day}
                      </h3>
                    </div>
                    <div
                      className="text-right flex flex-col text-xs font-medium whitespace-nowrap opacity-70"
                      style={{ color: colors.text }}
                    >
                      <span>
                        {schedules.length} stream
                        {schedules.length > 1 ? "s" : ""}
                      </span>
                      {totalMinutesStreamed > 0 && (
                        <span className="flex items-center gap-1 justify-end mt-0.5">
                          <Clock className="size-3" />
                          {hoursStreamed}h
                        </span>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-2 ml-4 border-l-2 pl-6" style={{ borderColor: "#345182" + "50" }}>
                    {schedules.map(schedule => (
                      <li
                        key={schedule.id}
                        className="flex flex-col md:flex-row md:justify-between md:items-start gap-2 md:gap-3 p-3 md:p-4 rounded-lg transition-all duration-300 border group/stream"
                        style={{
                          backgroundColor: "#345182" + "0D",
                          borderColor: "#345182" + "33",
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm md:text-base word-break" style={{ color: colors.text }}>
                            🎮 {schedule.streamer_name}
                          </p>
                          {schedule.category && schedule.category !== "Gameplay" && (
                            <p
                              className="text-xs mt-1.5 w-fit px-2 py-1 rounded inline-block opacity-70"
                              style={{
                                color: colors.text,
                                backgroundColor: "#345182" + "33",
                              }}
                            >
                              {schedule.category}
                            </p>
                          )}
                          {schedule.notes && (
                            <p className="text-xs mt-2 italic opacity-60" style={{ color: colors.text }}>
                              {schedule.notes}
                            </p>
                          )}
                        </div>
                        <p
                          className="text-sm font-semibold text-right md:text-right whitespace-nowrap shrink-0"
                          style={{ color: "#d63901" }}
                        >
                          {formatTimeRange(schedule.start_time, schedule.end_time)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
