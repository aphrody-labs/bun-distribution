/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Locale-aware AM/PM (day-period) labels for the time picker, resolved through
 * `Intl` with a hard EN fallback. The picker's canonical value stays a 24-hour
 * `HH:MM` string regardless of locale.
 */
/** Resolved meridiem labels for a locale. */
export interface MeridiemLabels {
    am: string;
    pm: string;
}
/** Resolves (and memoises) AM/PM labels for a locale, EN fallback. */
export declare function getMeridiemLabels(locale: string): MeridiemLabels;
