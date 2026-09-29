//! Dependency-free date normalization to ISO-8601.
//!
//! Supported inputs: ISO-8601 / RFC 3339 (`2025-06-10`, `2025-06-10T08:30`,
//! `2025-06-10 08:30:00+02:00`, `20250610`), slash dates (`2025/06/10`),
//! RFC 2822 (`Tue, 10 Jun 2025 08:30:00 GMT`), and English / French long
//! forms (`June 10, 2025`, `10 June 2025`, `10 juin 2025`, `le 3 mars 2024 à 14h05`).
//! Output is `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS[Z|±HH:MM]`.

fn month_from_word(w: &str) -> Option<u32> {
    let w = w.trim_end_matches('.').to_lowercase();
    let m = match w.as_str() {
        "jan" | "january" | "janv" | "janvier" => 1,
        "feb" | "february" | "fév" | "fev" | "févr" | "fevr" | "février" | "fevrier" => 2,
        "mar" | "march" | "mars" => 3,
        "apr" | "april" | "avr" | "avril" => 4,
        "may" | "mai" => 5,
        "jun" | "june" | "juin" => 6,
        "jul" | "july" | "juil" | "juillet" => 7,
        "aug" | "august" | "août" | "aout" => 8,
        "sep" | "sept" | "september" | "septembre" => 9,
        "oct" | "october" | "octobre" => 10,
        "nov" | "november" | "novembre" => 11,
        "dec" | "december" | "déc" | "decembre" | "décembre" => 12,
        _ => return None,
    };
    Some(m)
}

fn valid_ymd(y: i64, m: u32, d: u32) -> bool {
    (1000..=9999).contains(&y) && (1..=12).contains(&m) && (1..=31).contains(&d)
}

fn digits(s: &[u8], start: usize, len: usize) -> Option<u32> {
    let slice = s.get(start..start + len)?;
    let mut v = 0u32;
    for &b in slice {
        if !b.is_ascii_digit() {
            return None;
        }
        v = v * 10 + u32::from(b - b'0');
    }
    Some(v)
}

/// Parses the ISO / RFC 3339 family. Returns the normalized string.
fn parse_iso(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let (y, m, d, mut pos) = if b.len() >= 10 && (b[4] == b'-' || b[4] == b'/') && b[7] == b[4] {
        (digits(b, 0, 4)?, digits(b, 5, 2)?, digits(b, 8, 2)?, 10)
    } else if b.len() >= 8
        && b[..8].iter().all(u8::is_ascii_digit)
        && (b.len() == 8 || b[8] == b'T')
    {
        (digits(b, 0, 4)?, digits(b, 4, 2)?, digits(b, 6, 2)?, 8)
    } else {
        return None;
    };
    if !valid_ymd(i64::from(y), m, d) {
        return None;
    }
    let date = format!("{y:04}-{m:02}-{d:02}");
    if pos >= b.len() || !(b[pos] == b'T' || b[pos] == b' ' || b[pos] == b't') {
        return Some(date);
    }
    pos += 1;
    let hh = match digits(b, pos, 2) {
        Some(v) => v,
        None => return Some(date),
    };
    let mm =
        if b.get(pos + 2) == Some(&b':') { digits(b, pos + 3, 2) } else { digits(b, pos + 2, 2) };
    let Some(mm) = mm else { return Some(date) };
    pos += if b.get(pos + 2) == Some(&b':') { 5 } else { 4 };
    let mut ss = 0;
    if b.get(pos) == Some(&b':') {
        if let Some(v) = digits(b, pos + 1, 2) {
            ss = v;
            pos += 3;
        }
    }
    if hh > 23 || mm > 59 || ss > 60 {
        return Some(date);
    }
    // Fractional seconds are dropped.
    if b.get(pos) == Some(&b'.') || b.get(pos) == Some(&b',') {
        pos += 1;
        while pos < b.len() && b[pos].is_ascii_digit() {
            pos += 1;
        }
    }
    while b.get(pos) == Some(&b' ') {
        pos += 1;
    }
    let tz = parse_tz(&s[pos.min(s.len())..]);
    Some(format!("{date}T{hh:02}:{mm:02}:{ss:02}{}", tz.unwrap_or_default()))
}

fn parse_tz(rest: &str) -> Option<String> {
    let r = rest.trim();
    if r.is_empty() {
        return None;
    }
    let upper = r.to_ascii_uppercase();
    if upper.starts_with('Z') || upper.starts_with("UTC") || upper.starts_with("GMT") {
        let tail = r.get(if upper.starts_with('Z') { 1 } else { 3 }..).unwrap_or("").trim();
        if tail.starts_with('+') || tail.starts_with('-') {
            return parse_tz(tail);
        }
        return Some("Z".to_string());
    }
    let b = r.as_bytes();
    let sign = match b.first() {
        Some(b'+') => '+',
        Some(b'-') => '-',
        _ => return None,
    };
    let h = digits(b, 1, 2)?;
    let m = if b.get(3) == Some(&b':') {
        digits(b, 4, 2).unwrap_or(0)
    } else {
        digits(b, 3, 2).unwrap_or(0)
    };
    if h > 14 || m > 59 {
        return None;
    }
    if h == 0 && m == 0 {
        return Some("Z".to_string());
    }
    Some(format!("{sign}{h:02}:{m:02}"))
}

fn parse_clock(words: &[&str]) -> Option<(u32, u32, u32, Option<String>)> {
    for (i, w) in words.iter().enumerate() {
        let w = w.trim_matches(|c: char| c == ',' || c == '(' || c == ')');
        let normalized = w.replace('h', ":");
        let parts: Vec<&str> = normalized.split(':').collect();
        if parts.len() >= 2
            && parts
                .iter()
                .take(2)
                .all(|p| !p.is_empty() && p.len() <= 2 && p.bytes().all(|c| c.is_ascii_digit()))
        {
            let hh: u32 = parts[0].parse().ok()?;
            let mm: u32 = parts[1].parse().ok()?;
            let ss: u32 =
                parts.get(2).and_then(|p| p.get(..2)).and_then(|p| p.parse().ok()).unwrap_or(0);
            if hh > 23 || mm > 59 || ss > 60 {
                return None;
            }
            let tz = words.get(i + 1).and_then(|t| parse_tz(t));
            return Some((hh, mm, ss, tz));
        }
    }
    None
}

fn parse_words(s: &str) -> Option<String> {
    let words: Vec<&str> =
        s.split(|c: char| c.is_whitespace() || c == ',').filter(|w| !w.is_empty()).collect();
    let mut day: Option<u32> = None;
    let mut month: Option<u32> = None;
    let mut year: Option<i64> = None;
    for w in &words {
        let t = w.trim_matches(|c: char| c == '.' || c == '(' || c == ')');
        let t = t
            .trim_end_matches("st")
            .trim_end_matches("nd")
            .trim_end_matches("rd")
            .trim_end_matches("th")
            .trim_end_matches("er");
        if month.is_none() {
            if let Some(m) = month_from_word(w.trim_matches(|c: char| c == '(' || c == ')')) {
                month = Some(m);
                continue;
            }
        }
        if t.bytes().all(|b| b.is_ascii_digit()) && !t.is_empty() {
            if t.len() == 4 && year.is_none() {
                year = t.parse().ok();
            } else if t.len() <= 2 && day.is_none() {
                day = t.parse().ok();
            }
        }
    }
    let (y, m, d) = (year?, month?, day?);
    if !valid_ymd(y, m, d) {
        return None;
    }
    let date = format!("{y:04}-{m:02}-{d:02}");
    match parse_clock(&words) {
        Some((hh, mm, ss, tz)) => {
            Some(format!("{date}T{hh:02}:{mm:02}:{ss:02}{}", tz.unwrap_or_default()))
        },
        None => Some(date),
    }
}

/// Normalizes a date string to ISO-8601, or `None` when it cannot be parsed.
pub fn normalize_date(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 200 {
        return None;
    }
    if let Some(v) = parse_iso(s) {
        return Some(v);
    }
    // Unix timestamps (seconds or milliseconds) are common in data attributes.
    if s.bytes().all(|b| b.is_ascii_digit()) && (s.len() == 10 || s.len() == 13) {
        let secs: i64 = s.parse().ok()?;
        let secs = if s.len() == 13 { secs / 1000 } else { secs };
        return Some(unix_to_iso(secs));
    }
    parse_words(s)
}

/// Civil-from-days (Howard Hinnant's algorithm).
fn unix_to_iso(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::normalize_date;

    #[test]
    fn iso_family() {
        assert_eq!(normalize_date("2025-06-10").as_deref(), Some("2025-06-10"));
        assert_eq!(
            normalize_date("2025-06-10T08:30:12.123+02:00").as_deref(),
            Some("2025-06-10T08:30:12+02:00")
        );
        assert_eq!(normalize_date("2025-06-10T08:30Z").as_deref(), Some("2025-06-10T08:30:00Z"));
        assert_eq!(normalize_date("2025/06/10").as_deref(), Some("2025-06-10"));
        assert_eq!(
            normalize_date("2025-06-10 08:30:00 +0000").as_deref(),
            Some("2025-06-10T08:30:00Z")
        );
        assert_eq!(normalize_date("20250610").as_deref(), Some("2025-06-10"));
    }

    #[test]
    fn long_forms() {
        assert_eq!(
            normalize_date("Tue, 10 Jun 2025 08:30:00 GMT").as_deref(),
            Some("2025-06-10T08:30:00Z")
        );
        assert_eq!(normalize_date("June 10, 2025").as_deref(), Some("2025-06-10"));
        assert_eq!(normalize_date("10th June 2025").as_deref(), Some("2025-06-10"));
        assert_eq!(normalize_date("10 juin 2025").as_deref(), Some("2025-06-10"));
        assert_eq!(normalize_date("1er mars 2024 à 14h05").as_deref(), Some("2024-03-01T14:05:00"));
        assert_eq!(normalize_date("1700000000").as_deref(), Some("2023-11-14T22:13:20Z"));
    }

    #[test]
    fn garbage() {
        assert_eq!(normalize_date(""), None);
        assert_eq!(normalize_date("yesterday"), None);
        assert_eq!(normalize_date("2025-13-40"), None);
        assert_eq!(normalize_date("\u{0}\u{0}"), None);
    }
}
