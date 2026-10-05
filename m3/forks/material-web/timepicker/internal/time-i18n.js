/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const EN = { am: "AM", pm: "PM" };
const cache = new Map();
/** Resolves (and memoises) AM/PM labels for a locale, EN fallback. */
export function getMeridiemLabels(locale) {
    const key = locale || "en";
    const cached = cache.get(key);
    if (cached) {
        return cached;
    }
    let labels = EN;
    try {
        const fmt = new Intl.DateTimeFormat(locale || undefined, {
            hour: "numeric",
            hour12: true,
        });
        const am = dayPeriod(fmt, new Date(2021, 0, 1, 9, 0));
        const pm = dayPeriod(fmt, new Date(2021, 0, 1, 21, 0));
        if (am && pm) {
            labels = { am, pm };
        }
    }
    catch {
        // Intl unavailable or invalid locale — keep EN fallback.
    }
    cache.set(key, labels);
    return labels;
}
/** Extracts the day-period (`AM`/`PM`) part from a formatted time. */
function dayPeriod(fmt, date) {
    for (const part of fmt.formatToParts(date)) {
        if (part.type === "dayPeriod") {
            return part.value;
        }
    }
    return "";
}
//# sourceMappingURL=time-i18n.js.map