// SPDX-License-Identifier: Apache-2.0
//! Loose version ordering and ranges shared by the system sources.
//!
//! Versions are dot/dash separated parts; numeric parts compare numerically,
//! others lexically, a missing part counts as `0` (`1.2` == `1.2.0`), and a
//! textual part sorts before a numeric one (`1.0-beta` < `1.0`).
//!
//! Ranges: `*`, `latest`, `""`, an exact version, comparators (`>=1.2 <2`),
//! `^1.2`, `~1.2`, `1.2.x`, alternatives joined with `||`.

use core::cmp::Ordering;

fn parts(v: &str) -> impl Iterator<Item = &str> {
    v.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+', '_']).filter(|p| !p.is_empty())
}

fn cmp_part(a: Option<&str>, b: Option<&str>) -> Ordering {
    let a = a.unwrap_or("0");
    let b = b.unwrap_or("0");
    match (a.parse::<u64>(), b.parse::<u64>()) {
        (Ok(x), Ok(y)) => x.cmp(&y),
        (Ok(_), Err(_)) => Ordering::Greater,
        (Err(_), Ok(_)) => Ordering::Less,
        (Err(_), Err(_)) => a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()),
    }
}

pub fn compare(a: &str, b: &str) -> Ordering {
    let mut ia = parts(a);
    let mut ib = parts(b);
    loop {
        match (ia.next(), ib.next()) {
            (None, None) => return Ordering::Equal,
            (x, y) => match cmp_part(x, y) {
                Ordering::Equal => continue,
                o => return o,
            },
        }
    }
}

fn numeric_prefix(v: &str) -> Vec<u64> {
    parts(v).map_while(|p| p.parse::<u64>().ok()).collect()
}

/// `1.2.x` / `1.2.*` / `1.2` as a prefix match on the given parts.
fn prefix_matches(pattern: &str, version: &str) -> bool {
    let pat: Vec<&str> = parts(pattern).take_while(|p| !matches!(*p, "x" | "X" | "*")).collect();
    let ver: Vec<&str> = parts(version).collect();
    pat.iter()
        .enumerate()
        .all(|(i, p)| ver.get(i).is_some_and(|v| cmp_part(Some(p), Some(v)) == Ordering::Equal))
}

fn bump_at(base: &[u64], idx: usize) -> String {
    let mut out: Vec<u64> = base.iter().take(idx + 1).copied().collect();
    while out.len() <= idx {
        out.push(0);
    }
    out[idx] += 1;
    out.iter().map(u64::to_string).collect::<Vec<_>>().join(".")
}

type Op = fn(Ordering) -> bool;

fn comparator_matches(c: &str, version: &str) -> bool {
    let c = c.trim();
    if c.is_empty() || c == "*" || c.eq_ignore_ascii_case("latest") {
        return true;
    }
    let ops: [(&str, Op); 6] = [
        (">=", |o| o != Ordering::Less),
        ("<=", |o| o != Ordering::Greater),
        (">", |o| o == Ordering::Greater),
        ("<", |o| o == Ordering::Less),
        ("==", |o| o == Ordering::Equal),
        ("=", |o| o == Ordering::Equal),
    ];
    for (op, f) in ops {
        if let Some(rest) = c.strip_prefix(op) {
            return f(compare(version, rest.trim()));
        }
    }
    if let Some(rest) = c.strip_prefix('^') {
        let base = numeric_prefix(rest);
        if compare(version, rest) == Ordering::Less {
            return false;
        }
        let first_nonzero =
            base.iter().position(|&n| n != 0).unwrap_or_else(|| base.len().saturating_sub(1));
        return compare(version, &bump_at(&base, first_nonzero)) == Ordering::Less;
    }
    if let Some(rest) = c.strip_prefix('~') {
        let base = numeric_prefix(rest);
        if compare(version, rest) == Ordering::Less {
            return false;
        }
        let idx = if base.len() >= 2 { 1 } else { 0 };
        return compare(version, &bump_at(&base, idx)) == Ordering::Less;
    }
    if c.split('.').any(|p| matches!(p, "x" | "X" | "*")) {
        return prefix_matches(c, version);
    }
    compare(version, c) == Ordering::Equal
}

/// Whether `version` satisfies `range`.
pub fn satisfies(range: &str, version: &str) -> bool {
    range.split("||").any(|alt| {
        let mut tokens = alt.split([' ', '\t']).filter(|t| !t.is_empty());
        let mut all = true;
        let mut any = false;
        while let Some(tok) = tokens.next() {
            // `>= 1.2` written with a space.
            let joined;
            let tok = if matches!(tok, ">=" | "<=" | ">" | "<" | "=" | "==" | "^" | "~") {
                match tokens.next() {
                    Some(next) => {
                        joined = format!("{tok}{next}");
                        joined.as_str()
                    },
                    None => tok,
                }
            } else {
                tok
            };
            any = true;
            all &= comparator_matches(tok, version);
        }
        !any || all
    })
}

/// `true` for ranges that pin one version (no operators or wildcards).
pub fn is_exact(range: &str) -> bool {
    let r = range.trim();
    !r.is_empty()
        && !r.eq_ignore_ascii_case("latest")
        && !r.contains(['*', 'x', 'X', '^', '~', '<', '>', '=', '|', ' '])
}

/// Highest version in `versions` satisfying `range`, by `cmp`.
pub fn best_match<'a>(
    versions: impl IntoIterator<Item = &'a str>,
    range: &str,
    cmp: impl Fn(&str, &str) -> Ordering,
) -> Option<&'a str> {
    let mut best: Option<&'a str> = None;
    for v in versions {
        if !satisfies(range, v) {
            continue;
        }
        best = match best {
            Some(b) if cmp(v, b) != Ordering::Greater => Some(b),
            _ => Some(v),
        };
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordering() {
        assert_eq!(compare("1.2", "1.2.0"), Ordering::Equal);
        assert_eq!(compare("1.10", "1.9"), Ordering::Greater);
        assert_eq!(compare("1.0-beta", "1.0"), Ordering::Less);
        assert_eq!(compare("v2.0", "2.0.0.0"), Ordering::Equal);
        assert_eq!(compare("0.101.2362.0", "0.100.0"), Ordering::Greater);
    }

    #[test]
    fn ranges() {
        assert!(satisfies("*", "3.4"));
        assert!(satisfies("", "3.4"));
        assert!(satisfies(">= 1.2 <2", "1.9.9"));
        assert!(!satisfies(">=1.2 <2", "2.0"));
        assert!(satisfies("^0.100", "0.100.5"));
        assert!(!satisfies("^0.100", "0.101.0"));
        assert!(satisfies("~1.2", "1.2.9"));
        assert!(!satisfies("~1.2", "1.3.0"));
        assert!(satisfies("1.2.x", "1.2.7"));
        assert!(satisfies("1.0 || 2.0", "2.0"));
        assert!(is_exact("1.2.3"));
        assert!(!is_exact("^1.2"));
        assert_eq!(best_match(["1.0.0", "1.2.0", "2.0.0"], "<2", compare), Some("1.2.0"));
        assert_eq!(best_match(["1.0.0"], "3", compare), None);
    }
}
