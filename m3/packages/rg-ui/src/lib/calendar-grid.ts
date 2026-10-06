// Grille de calendrier sans dépendance : dates locales, noms de mois et de jours via Intl.

export type DayRange = { from?: Date; to?: Date };

/** Début de journée locale (copie). */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

/** Ajoute des mois en restant dans le mois cible (31 janvier + 1 mois = 28/29 février). */
export function addMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Jour de début de semaine (0 = dimanche) : `Intl.Locale.getWeekInfo` quand disponible, lundi sinon. */
export function firstDayOfWeek(locale: string): number {
  try {
    const intlLocale = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // locale invalide : lundi
  }
  return 1;
}

/** Semaine ISO 8601 d'une date. */
export function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

export type CalendarDay = { date: Date; outside: boolean };

/** Semaines (tableaux de 7 jours) du mois, jours hors mois inclus pour compléter les semaines. */
export function monthGrid(month: Date, weekStartsOn: number): CalendarDay[][] {
  const first = startOfMonth(month);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  const start = addDays(first, -lead);
  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = addDays(start, week * 7 + day);
      return { date, outside: !isSameMonth(date, first) };
    }),
  );
}

/** Noms courts des jours dans l'ordre d'affichage (« lun. », « mar. »…). */
export function weekdayLabels(
  locale: string,
  weekStartsOn: number,
  width: "narrow" | "short" | "long" = "short",
): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: width });
  // 2023-01-01 était un dimanche.
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(2023, 0, 1 + ((weekStartsOn + i) % 7))),
  );
}

export function monthLabel(locale: string, month: Date): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
}

export function dayLabel(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date);
}

export function inRange(date: Date, range: DayRange | undefined): boolean {
  if (!range?.from) return false;
  const day = startOfDay(date).getTime();
  const from = startOfDay(range.from).getTime();
  const to = startOfDay(range.to ?? range.from).getTime();
  return day >= Math.min(from, to) && day <= Math.max(from, to);
}

/** Sélection d'un jour en mode plage, comme un sélecteur de dates usuel. */
export function nextRange(current: DayRange | undefined, picked: Date): DayRange | undefined {
  if (!current?.from) return { from: picked, to: undefined };
  if (!current.to) {
    if (isSameDay(current.from, picked)) return { from: picked, to: picked };
    return picked < current.from
      ? { from: picked, to: current.from }
      : { from: current.from, to: picked };
  }
  if (isSameDay(current.from, current.to) && isSameDay(current.from, picked)) return undefined;
  return { from: picked, to: undefined };
}
