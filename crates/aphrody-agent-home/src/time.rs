// SPDX-License-Identifier: Apache-2.0
//! UTC timestamps without a calendar dependency.
//!
//! Uses the public-domain `civil_from_days` algorithm (the same one as
//! `oc_cmd.rs::current_iso8601`). The integer casts operate on bounded day/era
//! counts that never overflow or change sign for any realistic timestamp.

use std::time::{SystemTime, UNIX_EPOCH};

/// Seconds since the Unix epoch for `t` (0 before the epoch).
#[must_use]
pub fn unix_secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) of `secs` since the epoch.
#[must_use]
#[allow(clippy::cast_possible_wrap, clippy::cast_sign_loss)]
pub fn iso8601(secs: u64) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (hour, min, sec) = (rem / 3_600, (rem % 3_600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

/// Current ISO-8601 UTC timestamp.
#[must_use]
pub fn now_iso8601() -> String {
    iso8601(unix_secs(SystemTime::now()))
}

/// Compact, file-name safe UTC stamp (`YYYYMMDDTHHMMSSZ`) plus the process id
/// and a nanosecond suffix so two backups taken in the same second never
/// collide.
#[must_use]
pub fn file_stamp() -> String {
    let now = SystemTime::now();
    let nanos = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let iso = iso8601(unix_secs(now)).replace([':', '-'], "");
    format!("{iso}-{}-{nanos:09}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_known_instants() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(1_000_000_000), "2001-09-09T01:46:40Z");
        assert_eq!(iso8601(1_709_208_000), "2024-02-29T12:00:00Z");
    }

    #[test]
    fn file_stamp_has_no_path_separators_or_colons() {
        let s = file_stamp();
        assert!(
            !s.contains(':') && !s.contains('/') && !s.contains('\\'),
            "{s}"
        );
    }
}
