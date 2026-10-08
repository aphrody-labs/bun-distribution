// SPDX-License-Identifier: Apache-2.0
//! Native Semantic Versioning parser and range evaluator from Bun (`bun_semver`).
//! Handles semantic version parsing, prereleases, caret (`^`), tilde (`~`), and comparison ranges.

use std::cmp::Ordering;
use std::fmt;

/// Semantic version structure (MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]).
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub pre: Option<String>,
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if let Some(ref pre) = self.pre {
            write!(f, "-{pre}")?;
        }
        Ok(())
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.major.cmp(&other.major) {
            Ordering::Equal => match self.minor.cmp(&other.minor) {
                Ordering::Equal => match self.patch.cmp(&other.patch) {
                    Ordering::Equal => match (&self.pre, &other.pre) {
                        (None, None) => Ordering::Equal,
                        (Some(_), None) => Ordering::Less, // 1.0.0-alpha < 1.0.0
                        (None, Some(_)) => Ordering::Greater,
                        (Some(a), Some(b)) => a.cmp(b),
                    },
                    ord => ord,
                },
                ord => ord,
            },
            ord => ord,
        }
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Version {
    /// Parses a semantic version string (e.g. `1.2.3`, `v2.0.0-beta.1`).
    pub fn parse(s: &str) -> Option<Self> {
        let clean = s.trim().strip_prefix('v').unwrap_or(s.trim());
        let (ver_part, pre) = if let Some((v, p)) = clean.split_once('-') {
            (v, Some(p.split('+').next()?.to_string()))
        } else {
            (clean.split('+').next()?, None)
        };

        let parts: Vec<&str> = ver_part.split('.').collect();
        if parts.len() > 3 || parts.is_empty() {
            return None;
        }

        let major: u64 = parts[0].parse().ok()?;
        let minor: u64 = if parts.len() > 1 { parts[1].parse().ok()? } else { 0 };
        let patch: u64 = if parts.len() > 2 { parts[2].parse().ok()? } else { 0 };

        Some(Self {
            major,
            minor,
            patch,
            pre,
        })
    }
}

/// Version constraint range requirement (e.g. `^1.2.0`, `~2.1.0`, `>=1.0.0 <2.0.0`).
#[derive(Debug, Clone)]
pub enum VersionReq {
    Any,
    Exact(Version),
    Caret(Version),
    Tilde(Version),
    Gte(Version),
    Lte(Version),
    Range(Version, Version), // [min, max)
}

impl VersionReq {
    /// Parses a version requirement.
    pub fn parse(req: &str) -> Option<Self> {
        let req = req.trim();
        if req == "*" || req.is_empty() || req == "latest" {
            return Some(Self::Any);
        }

        if let Some(stripped) = req.strip_prefix('^') {
            let v = Version::parse(stripped)?;
            return Some(Self::Caret(v));
        }

        if let Some(stripped) = req.strip_prefix('~') {
            let v = Version::parse(stripped)?;
            return Some(Self::Tilde(v));
        }

        if let Some(stripped) = req.strip_prefix(">=") {
            let v = Version::parse(stripped)?;
            return Some(Self::Gte(v));
        }

        if let Some(stripped) = req.strip_prefix("<=") {
            let v = Version::parse(stripped)?;
            return Some(Self::Lte(v));
        }

        if let Some(stripped) = req.strip_prefix('=') {
            let v = Version::parse(stripped)?;
            return Some(Self::Exact(v));
        }

        Version::parse(req).map(Self::Exact)
    }

    /// Tests if a concrete `Version` satisfies this requirement.
    pub fn matches(&self, ver: &Version) -> bool {
        match self {
            Self::Any => true,
            Self::Exact(target) => ver == target,
            Self::Gte(min) => ver >= min,
            Self::Lte(max) => ver <= max,
            Self::Caret(base) => {
                if ver < base {
                    return false;
                }
                if base.major > 0 {
                    ver.major == base.major
                } else if base.minor > 0 {
                    ver.major == 0 && ver.minor == base.minor
                } else {
                    ver.major == 0 && ver.minor == 0 && ver.patch == base.patch
                }
            }
            Self::Tilde(base) => {
                if ver < base {
                    return false;
                }
                ver.major == base.major && ver.minor == base.minor
            }
            Self::Range(min, max) => ver >= min && ver < max,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semver_parse_and_ord() {
        let v1 = Version::parse("1.2.3").unwrap();
        let v2 = Version::parse("1.2.4").unwrap();
        let v_pre = Version::parse("1.2.3-alpha.1").unwrap();

        assert!(v1 < v2);
        assert!(v_pre < v1);
    }

    #[test]
    fn test_semver_caret_tilde() {
        let req_caret = VersionReq::parse("^1.2.3").unwrap();
        assert!(req_caret.matches(&Version::parse("1.2.3").unwrap()));
        assert!(req_caret.matches(&Version::parse("1.9.0").unwrap()));
        assert!(!req_caret.matches(&Version::parse("2.0.0").unwrap()));
        assert!(!req_caret.matches(&Version::parse("1.2.2").unwrap()));

        let req_tilde = VersionReq::parse("~1.2.3").unwrap();
        assert!(req_tilde.matches(&Version::parse("1.2.9").unwrap()));
        assert!(!req_tilde.matches(&Version::parse("1.3.0").unwrap()));
    }
}
