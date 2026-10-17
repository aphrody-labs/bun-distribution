// SPDX-License-Identifier: Apache-2.0
//! Windows timestamps (`FILETIME` ticks, CIM `DATETIME` strings) rendered as RFC 3339 UTC, the
//! format the WinClean tools return. Pure proleptic-Gregorian arithmetic, no time zone database.

/// 100 ns `FILETIME` ticks between 1601-01-01 and the Unix epoch.
const FILETIME_UNIX_EPOCH: i64 = 116_444_736_000_000_000;
const TICKS_PER_SECOND: i64 = 10_000_000;

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant, `days_from_civil`).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year =
        (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Proleptic Gregorian `(year, month, day)` of a day count since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn rfc3339(unix_seconds: i64, fraction: &str) -> String {
    let (year, month, day) = civil_from_days(unix_seconds.div_euclid(86_400));
    let seconds_of_day = unix_seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}{fraction}Z",
        seconds_of_day / 3600,
        seconds_of_day % 3600 / 60,
        seconds_of_day % 60
    )
}

/// `FILETIME` ticks (100 ns since 1601-01-01 UTC) as `YYYY-MM-DDTHH:MM:SS.fffffffZ`, the
/// `SystemTime` rendering of the event log.
pub(crate) fn filetime_to_rfc3339(ticks: u64) -> String {
    let unix_ticks = i64::try_from(ticks).unwrap_or(i64::MAX) - FILETIME_UNIX_EPOCH;
    let seconds = unix_ticks.div_euclid(TICKS_PER_SECOND);
    let fraction = unix_ticks.rem_euclid(TICKS_PER_SECOND);
    rfc3339(seconds, &format!(".{fraction:07}"))
}

/// A CIM `DATETIME` (`yyyymmddHHMMSS.mmmmmmsUUU`, `UUU` = UTC offset in minutes) converted to
/// UTC as `YYYY-MM-DDTHH:MM:SS.ffffffZ`. Returns `None` for malformed or wildcard values.
pub(crate) fn cim_datetime_to_rfc3339(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() != 25 || !value.is_ascii() || value.as_bytes()[14] != b'.' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let digits = value.get(range)?;
        digits
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| digits.parse().ok())?
    };
    let (year, month, day) = (number(0..4)?, number(4..6)?, number(6..8)?);
    let (hour, minute, second) = (number(8..10)?, number(10..12)?, number(12..14)?);
    let micros = number(15..21)?;
    let offset = number(22..25)?;
    let offset = match value.as_bytes()[21] {
        b'+' => offset,
        b'-' => -offset,
        _ => return None,
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    let local = days_from_civil(year, month as u32, day as u32) * 86_400
        + hour * 3600
        + minute * 60
        + second.min(60);
    Some(rfc3339(local - offset * 60, &format!(".{micros:06}")))
}

#[cfg(test)]
mod tests {
    use super::{cim_datetime_to_rfc3339, civil_from_days, days_from_civil, filetime_to_rfc3339};

    #[test]
    fn civil_day_conversions_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        for days in [-719_468, -1, 0, 59, 11_016, 20_000, 2_932_896] {
            let (year, month, day) = civil_from_days(days);
            assert_eq!(
                days_from_civil(year, month, day),
                days,
                "{year}-{month}-{day}"
            );
        }
    }

    #[test]
    fn filetime_renders_like_the_event_log_system_time() {
        assert_eq!(
            filetime_to_rfc3339(116_444_736_000_000_000),
            "1970-01-01T00:00:00.0000000Z"
        );
        // 2024-02-29T12:34:56.1234567Z
        let ticks = 116_444_736_000_000_000u64 + 1_709_210_096 * 10_000_000 + 1_234_567;
        assert_eq!(filetime_to_rfc3339(ticks), "2024-02-29T12:34:56.1234567Z");
        assert_eq!(filetime_to_rfc3339(0), "1601-01-01T00:00:00.0000000Z");
    }

    #[test]
    fn cim_datetimes_are_normalised_to_utc() {
        assert_eq!(
            cim_datetime_to_rfc3339("20260925101552.918543+120").as_deref(),
            Some("2026-09-25T08:15:52.918543Z")
        );
        assert_eq!(
            cim_datetime_to_rfc3339("20251231233000.000000-060").as_deref(),
            Some("2026-01-01T00:30:00.000000Z")
        );
        assert_eq!(cim_datetime_to_rfc3339("********101552.918543+120"), None);
        assert_eq!(cim_datetime_to_rfc3339("not a date"), None);
        assert_eq!(cim_datetime_to_rfc3339("20261325101552.918543+120"), None);
    }
}
