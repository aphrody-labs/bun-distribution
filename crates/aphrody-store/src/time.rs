// SPDX-License-Identifier: Apache-2.0
//! Wall-clock helpers without a calendar dependency.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current Unix time in milliseconds (0 before the epoch).
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// `(year, month, day)` of a Unix timestamp in seconds, UTC (civil-from-days algorithm).
#[must_use]
pub fn civil_date(unix_secs: i64) -> (i64, u32, u32) {
    let days = unix_secs.div_euclid(86_400) + 719_468;
    let era = days.div_euclid(146_097);
    let doe = days.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// `YYYY-MM-DD` of a Unix timestamp in milliseconds, UTC.
#[must_use]
pub fn date_string(unix_ms: i64) -> String {
    let (y, m, d) = civil_date(unix_ms.div_euclid(1000));
    format!("{y:04}-{m:02}-{d:02}")
}

/// `YYYYMMDDTHHMMSSZ` of a Unix timestamp in milliseconds, UTC.
#[must_use]
pub fn compact_timestamp(unix_ms: i64) -> String {
    let secs = unix_ms.div_euclid(1000);
    let (y, m, d) = civil_date(secs);
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_and_known_dates() {
        assert_eq!(civil_date(0), (1970, 1, 1));
        // 2026-10-06T12:34:56Z
        assert_eq!(civil_date(1_791_290_096), (2026, 10, 6));
        assert_eq!(date_string(1_791_290_096_000), "2026-10-06");
        assert_eq!(compact_timestamp(1_791_290_096_000), "20261006T123456Z");
        // leap day
        assert_eq!(civil_date(951_782_400), (2000, 2, 29));
    }
}
