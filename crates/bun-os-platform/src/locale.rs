//! Locale negotiation: the shipped locales (`locales/locales.json`), the OS UI languages
//! (Windows `GetUserPreferredUILanguages`, POSIX `LANGUAGE`/`LC_ALL`/`LC_MESSAGES`/`LANG`) and a
//! user override (`BUN_OS_LOCALE`, then `settings.json`). Same rules as `lookupLocale` in
//! `packages/bun-os-platform/src/i18n/localizer.ts`.

use serde::Deserialize;

use crate::paths::Paths;

#[derive(Clone, Debug, Deserialize)]
pub struct LocaleInfo {
    pub tag: String,
    pub name: String,
    #[serde(default = "ltr")]
    pub direction: String,
    #[serde(default)]
    pub fallbacks: Vec<String>,
}

fn ltr() -> String {
    "ltr".into()
}

#[derive(Deserialize)]
struct Registry {
    default: String,
    locales: Vec<LocaleInfo>,
}

const EMBEDDED_REGISTRY: &str =
    include_str!("../../../packages/bun-os-platform/locales/locales.json");

/// The shipped locales and the default (`en`).
pub fn available(paths: &Paths) -> (String, Vec<LocaleInfo>) {
    let text = std::fs::read_to_string(paths.package.join("locales").join("locales.json"))
        .unwrap_or_else(|_| EMBEDDED_REGISTRY.to_string());
    let registry: Registry = serde_json::from_str(&text)
        .or_else(|_| serde_json::from_str(EMBEDDED_REGISTRY))
        .expect("embedded locale registry");
    (registry.default, registry.locales)
}

/// OS UI languages, most preferred first.
pub fn os_locales() -> Vec<String> {
    #[cfg(windows)]
    {
        use windows::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};
        use windows::core::PWSTR;
        let mut count = 0u32;
        let mut size = 0u32;
        // SAFETY: the first call only reports the buffer size; the second fills a buffer of it.
        unsafe {
            if GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, None, &mut size).is_ok()
                && size > 0
            {
                let mut buffer = vec![0u16; size as usize];
                if GetUserPreferredUILanguages(
                    MUI_LANGUAGE_NAME,
                    &mut count,
                    Some(PWSTR(buffer.as_mut_ptr())),
                    &mut size,
                )
                .is_ok()
                {
                    let list: Vec<String> = String::from_utf16_lossy(&buffer)
                        .split('\0')
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                        .collect();
                    if !list.is_empty() {
                        return list;
                    }
                }
            }
        }
    }
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let raw: Vec<String> = var("LANGUAGE").map_or_else(
        || {
            var("LC_ALL")
                .or_else(|| var("LC_MESSAGES"))
                .or_else(|| var("LANG"))
                .into_iter()
                .collect()
        },
        |l| l.split(':').map(str::to_string).collect(),
    );
    raw.into_iter()
        .map(|v| v.split(['.', '@']).next().unwrap_or("").replace('_', "-"))
        .filter(|v| !v.is_empty() && v != "C" && v != "POSIX")
        .collect()
}

fn script_of(tag: &str) -> Option<&'static str> {
    let lower = tag.to_ascii_lowercase();
    if !lower.starts_with("zh") {
        return None;
    }
    if lower.contains("hant") || ["-tw", "-hk", "-mo"].iter().any(|r| lower.ends_with(r)) {
        Some("zh-Hant")
    } else {
        Some("zh-Hans")
    }
}

/// BCP 47 lookup: exact (case-insensitive), Chinese script, language-region, then language.
pub fn lookup(requested: &[String], available: &[LocaleInfo]) -> Option<String> {
    let tags: Vec<&str> = available.iter().map(|l| l.tag.as_str()).collect();
    for raw in requested {
        let tag = raw.replace('_', "-");
        if let Some(t) = tags.iter().find(|t| t.eq_ignore_ascii_case(&tag)) {
            return Some((*t).to_string());
        }
        if let Some(script) = script_of(&tag)
            && tags.contains(&script)
        {
            return Some(script.to_string());
        }
        let mut parts = tag.split('-');
        let language = parts.next().unwrap_or("").to_ascii_lowercase();
        let region = parts.find(|p| p.len() == 2).map(str::to_ascii_uppercase);
        if let Some(region) = region
            && let Some(t) = tags
                .iter()
                .find(|t| t.eq_ignore_ascii_case(&format!("{language}-{region}")))
        {
            return Some((*t).to_string());
        }
        if let Some(t) = tags.iter().find(|t| {
            t.eq_ignore_ascii_case(&language)
                || t.to_ascii_lowercase().starts_with(&format!("{language}-"))
        }) {
            return Some((*t).to_string());
        }
    }
    None
}

/// The fallback chain of `tag`: itself, its declared fallbacks, then the default.
pub fn chain(tag: &str, available: &[LocaleInfo], default: &str) -> Vec<String> {
    fn visit(t: &str, available: &[LocaleInfo], out: &mut Vec<String>) {
        if out.iter().any(|o| o == t) {
            return;
        }
        let Some(info) = available.iter().find(|l| l.tag == t) else {
            return;
        };
        out.push(t.to_string());
        for f in &info.fallbacks {
            visit(f, available, out);
        }
    }
    let mut out = Vec::new();
    visit(tag, available, &mut out);
    if !out.iter().any(|o| o == default) {
        out.push(default.to_string());
    }
    out
}

/// Where the negotiated locale came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Override,
    Os,
    Default,
}

/// Override (env `BUN_OS_LOCALE`, then `settings.json`), then the OS languages, then `en`.
pub fn negotiate(paths: &Paths, explicit: Option<&str>) -> (Vec<String>, Source) {
    let (default, available) = available(paths);
    let settings = crate::paths::Settings::read(paths);
    let wanted = explicit
        .map(str::to_string)
        .or_else(|| {
            std::env::var("BUN_OS_LOCALE")
                .ok()
                .filter(|v| !v.is_empty())
        })
        .or(settings.locale);
    if let Some(tag) = wanted.and_then(|w| lookup(&[w], &available)) {
        return (chain(&tag, &available, &default), Source::Override);
    }
    if let Some(tag) = lookup(&os_locales(), &available) {
        return (chain(&tag, &available, &default), Source::Os);
    }
    (vec![default], Source::Default)
}
