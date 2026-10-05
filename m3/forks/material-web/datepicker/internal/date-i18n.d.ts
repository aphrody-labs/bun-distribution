/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/** A resolved bundle of localized display strings for one locale. */
export interface DateLocaleData {
    /** Full month names, January-first (length 12). */
    months: readonly string[];
    /** Narrow weekday headers, Sunday-first (length 7). */
    weekdays: readonly string[];
}
/** Resolves (and memoises) month/weekday labels for a locale, EN fallback. */
export declare function getDateLocaleData(locale: string): DateLocaleData;
/** A long month name for the given 0-based month index in `locale`. */
export declare function monthName(locale: string, month: number): string;
/**
 * Formats a `Date` for the editable field. When an explicit `format` mask is
 * given it is honoured verbatim; otherwise the locale's short numeric date
 * format (via `Intl`) is used, falling back to `MM/DD/YYYY`.
 */
export declare function formatDisplayLocale(date: Date, locale: string, format: string): string;
/** A locale-appropriate placeholder mask, e.g. `MM/DD/YYYY`. */
export declare function placeholderMask(locale: string, format: string): string;
/**
 * Parses a user-typed value robustly. Accepts ISO `YYYY-MM-DD`, the explicit
 * `format` mask (when supplied), and the locale's numeric order inferred from
 * `Intl`. Falls back to the common `M/D/Y` and `D/M/Y` numeric forms so input
 * never silently fails across locales.
 */
export declare function parseDisplayLocale(value: string, locale: string, format: string): Date | null;
