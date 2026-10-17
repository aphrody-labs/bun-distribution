//! Fluent catalogs for native hosts: the same `.ftl` files as the Bun side, one concurrent
//! `FluentBundle` per locale of the negotiated chain, numbers and dates through ICU4X compiled
//! data (`icu_decimal`, `icu_datetime`). Plural selection is Fluent's CLDR rules.
//!
//! Hosts call [`init`] once with their catalog domains (`["common", "shell"]`), then [`t`] / [`tf`]
//! anywhere. [`set_locale`] swaps the global localizer at runtime (the shell rebuilds its UI on
//! [`version`] changes).

use std::borrow::Cow;
use std::fmt::Display;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use fluent_bundle::concurrent::FluentBundle;
use fluent_bundle::memoizer::MemoizerKind;
use fluent_bundle::types::FluentNumber;
use fluent_bundle::{FluentArgs, FluentResource, FluentValue};
use icu_decimal::DecimalFormatter;
use icu_decimal::input::Decimal;
use intl_memoizer::Memoizable;
use unic_langid::LanguageIdentifier;

use crate::locale::{self, Source};
use crate::paths::Paths;

/// English catalogs compiled in: the last fallback when the package directory is absent.
const EMBEDDED_EN: &[(&str, &str)] = &[
    ("common", include_str!("../../../packages/bun-os-platform/locales/en/common.ftl")),
    ("shell", include_str!("../../../packages/bun-os-platform/locales/en/shell.ftl")),
    ("engine", include_str!("../../../packages/bun-os-platform/locales/en/engine.ftl")),
];

struct IcuNumber(DecimalFormatter);

fn icu_locale(lang: &LanguageIdentifier) -> icu_locale_core::Locale {
    lang.to_string().parse().unwrap_or(icu_locale_core::Locale::UNKNOWN)
}

impl Memoizable for IcuNumber {
    type Args = ();
    type Error = String;
    fn construct(lang: LanguageIdentifier, _: ()) -> Result<Self, String> {
        DecimalFormatter::try_new(icu_locale(&lang).into(), Default::default())
            .map(IcuNumber)
            .map_err(|e| e.to_string())
    }
}

fn number_text(n: &FluentNumber) -> String {
    let min = n.options.minimum_fraction_digits.unwrap_or(0);
    let max = n.options.maximum_fraction_digits.unwrap_or(min.max(3)).max(min);
    let mut text = format!("{:.*}", max, n.value);
    if text.contains('.') {
        while text.ends_with('0') && text.len() - text.find('.').unwrap_or(0) - 1 > min {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    text
}

/// Every number placeable goes through ICU4X: grouping, decimal separator and digits of the locale.
fn format_value<M: MemoizerKind>(value: &FluentValue, intls: &M) -> Option<String> {
    match value {
        FluentValue::Number(n) => {
            let decimal: Decimal = number_text(n).parse().ok()?;
            intls
                .with_try_get_threadsafe::<IcuNumber, _, _>((), |f| f.0.format(&decimal).to_string())
                .ok()
        }
        _ => None,
    }
}

/// `DATETIME($date, dateStyle: "long", timeStyle: "short")` over ISO 8601 strings, by ICU4X.
fn datetime<'a>(lang: &LanguageIdentifier, positional: &[FluentValue<'a>], named: &FluentArgs) -> FluentValue<'a> {
    use icu_datetime::DateTimeFormatter;
    use icu_datetime::fieldsets::YMD;
    use icu_datetime::input::{Date, DateTime, Time};
    let Some(FluentValue::String(iso)) = positional.first() else {
        return FluentValue::Error;
    };
    let (date, time) = iso.split_once('T').unwrap_or((iso, ""));
    let mut d = date.split('-').filter_map(|p| p.parse::<i32>().ok());
    let (Some(y), Some(m), Some(day)) = (d.next(), d.next(), d.next()) else {
        return FluentValue::Error;
    };
    let Ok(date) = Date::try_new_iso(y, m as u8, day as u8) else {
        return FluentValue::Error;
    };
    let style = match named.get("dateStyle") {
        Some(FluentValue::String(s)) => s.to_string(),
        _ => "medium".into(),
    };
    let fset = match style.as_str() {
        "short" => YMD::short(),
        "long" | "full" => YMD::long(),
        _ => YMD::medium(),
    };
    let locale = icu_locale(lang);
    let with_time = named.get("timeStyle").is_some() && !time.is_empty();
    let text = if with_time {
        let mut t = time.split([':', 'Z', '+', '.']).filter_map(|p| p.parse::<u8>().ok());
        let time = Time::try_new(t.next().unwrap_or(0), t.next().unwrap_or(0), 0, 0).unwrap_or(Time::start_of_day());
        DateTimeFormatter::try_new(locale.into(), fset.with_time_hm())
            .map(|f| f.format(&DateTime { date, time }).to_string())
    } else {
        DateTimeFormatter::try_new(locale.into(), fset).map(|f| f.format(&date).to_string())
    };
    text.map_or(FluentValue::Error, |s| FluentValue::String(Cow::Owned(s)))
}

/// One locale chain over a set of catalog domains.
pub struct Localizer {
    pub chain: Vec<String>,
    pub source: Source,
    pub domains: Vec<String>,
    bundles: Vec<FluentBundle<FluentResource>>,
    pub errors: Vec<String>,
}

fn read_sources(paths: &Paths, tag: &str, domains: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for dir in paths.locale_dirs() {
        let dir = dir.join(tag);
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut files: Vec<_> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.extension().is_some_and(|e| e == "ftl")
                    && p.file_stem().and_then(|s| s.to_str()).is_some_and(|s| domains.iter().any(|d| d == s))
            })
            .collect();
        files.sort();
        out.extend(files.iter().filter_map(|f| std::fs::read_to_string(f).ok()));
    }
    if out.is_empty() && tag == "en" {
        out.extend(
            EMBEDDED_EN
                .iter()
                .filter(|(d, _)| domains.iter().any(|x| x == d))
                .map(|(_, s)| (*s).to_string()),
        );
    }
    out
}

impl Localizer {
    pub fn load(paths: &Paths, chain: Vec<String>, source: Source, domains: &[&str]) -> Self {
        let domains: Vec<String> = domains.iter().map(|d| (*d).to_string()).collect();
        let mut errors = Vec::new();
        let bundles = chain
            .iter()
            .map(|tag| {
                let lang: LanguageIdentifier = tag.parse().unwrap_or_default();
                let mut bundle = FluentBundle::new_concurrent(vec![lang.clone()]);
                bundle.set_use_isolating(false);
                bundle.set_formatter(Some(format_value));
                let _ = bundle.add_function("NUMBER", fluent_bundle::builtins::NUMBER);
                let date_lang = lang.clone();
                let _ = bundle.add_function("DATETIME", move |p, n| datetime(&date_lang, p, n));
                for text in read_sources(paths, tag, &domains) {
                    let resource = match FluentResource::try_new(text) {
                        Ok(r) => r,
                        Err((r, errs)) => {
                            errors.extend(errs.iter().map(|e| format!("{tag}: {e:?}")));
                            r
                        }
                    };
                    bundle.add_resource_overriding(resource);
                }
                bundle
            })
            .collect();
        Self {
            chain,
            source,
            domains,
            bundles,
            errors,
        }
    }

    pub fn locale(&self) -> &str {
        self.chain.first().map_or("en", String::as_str)
    }

    /// Formats a message (`id` or `id.attribute`). Shell keys use dots between words
    /// (`nav.games`); they map to the Fluent id `nav-games`. Missing keys render as the key.
    pub fn format(&self, key: &str, args: Option<&FluentArgs>) -> String {
        let (id, attr) = match key.split_once('#') {
            Some((id, attr)) => (id.replace('.', "-"), Some(attr)),
            None => (key.replace('.', "-"), None),
        };
        for bundle in &self.bundles {
            let Some(message) = bundle.get_message(&id) else { continue };
            let pattern = match attr {
                Some(a) => message.get_attribute(a).map(|a| a.value()),
                None => message.value(),
            };
            if let Some(pattern) = pattern {
                let mut errors = Vec::new();
                return bundle.format_pattern(pattern, args, &mut errors).into_owned();
            }
        }
        key.to_string()
    }

    pub fn has(&self, key: &str) -> bool {
        let id = key.replace('.', "-");
        self.bundles.iter().any(|b| b.has_message(&id))
    }

    /// A number with the locale's grouping and decimals.
    pub fn number(&self, value: f64, fraction_digits: usize) -> String {
        let n = FluentNumber::new(
            value,
            fluent_bundle::types::FluentNumberOptions {
                minimum_fraction_digits: Some(fraction_digits),
                maximum_fraction_digits: Some(fraction_digits),
                ..Default::default()
            },
        );
        let lang: LanguageIdentifier = self.locale().parse().unwrap_or_default();
        let decimal: Option<Decimal> = number_text(&n).parse().ok();
        match (IcuNumber::construct(lang, ()), decimal) {
            (Ok(f), Some(d)) => f.0.format(&d).to_string(),
            _ => n.as_string().into_owned(),
        }
    }

    /// An ISO 8601 date (`2026-10-17` or `2026-10-17T18:30`) in the locale's medium style.
    pub fn date(&self, iso: &str) -> String {
        let lang: LanguageIdentifier = self.locale().parse().unwrap_or_default();
        match datetime(&lang, &[FluentValue::String(Cow::Borrowed(iso))], &FluentArgs::new()) {
            FluentValue::String(s) => s.into_owned(),
            _ => iso.to_string(),
        }
    }
}

static GLOBAL: RwLock<Option<Arc<Localizer>>> = RwLock::new(None);
static VERSION: AtomicU64 = AtomicU64::new(0);
static DOMAINS: RwLock<Vec<String>> = RwLock::new(Vec::new());

/// Loads the negotiated chain for `domains` and installs it globally.
pub fn init(domains: &[&str]) -> Arc<Localizer> {
    install(None, domains)
}

fn install(explicit: Option<&str>, domains: &[&str]) -> Arc<Localizer> {
    let paths = Paths::discover();
    let (chain, source) = locale::negotiate(&paths, explicit);
    let localizer = Arc::new(Localizer::load(&paths, chain, source, domains));
    *DOMAINS.write().unwrap_or_else(|e| e.into_inner()) = domains.iter().map(|d| (*d).to_string()).collect();
    *GLOBAL.write().unwrap_or_else(|e| e.into_inner()) = Some(localizer.clone());
    VERSION.fetch_add(1, Ordering::SeqCst);
    localizer
}

/// Switches the UI language at runtime and persists the choice in `settings.json`
/// (`None` returns to the OS language).
pub fn set_locale(tag: Option<&str>) -> Arc<Localizer> {
    let paths = Paths::discover();
    let mut settings = crate::paths::Settings::read(&paths);
    settings.locale = tag.map(str::to_string);
    let _ = settings.write(&paths);
    let domains = DOMAINS.read().unwrap_or_else(|e| e.into_inner()).clone();
    let domains: Vec<&str> = if domains.is_empty() { vec!["common"] } else { domains.iter().map(String::as_str).collect() };
    install(tag, &domains)
}

/// Bumped on every install; UI hosts rebuild their text when it changes.
pub fn version() -> u64 {
    VERSION.load(Ordering::SeqCst)
}

/// The installed localizer (initialized with `["common"]` on first use).
pub fn current() -> Arc<Localizer> {
    if let Some(l) = GLOBAL.read().unwrap_or_else(|e| e.into_inner()).as_ref() {
        return l.clone();
    }
    init(&["common"])
}

/// The message for `key`.
pub fn t(key: &str) -> String {
    current().format(key, None)
}

/// The message for `key` with arguments; values that parse as numbers become Fluent numbers
/// (plural selection, ICU formatting).
pub fn tf(key: &str, args: &[(&str, &dyn Display)]) -> String {
    let mut fluent = FluentArgs::new();
    for (name, value) in args {
        let text = value.to_string();
        match text.parse::<f64>() {
            Ok(n) if !text.is_empty() && text.trim() == text => {
                let decimals = text.split_once('.').map_or(0, |(_, f)| f.len());
                fluent.set(
                    *name,
                    FluentValue::Number(FluentNumber::new(
                        n,
                        fluent_bundle::types::FluentNumberOptions {
                            minimum_fraction_digits: Some(decimals),
                            ..Default::default()
                        },
                    )),
                );
            }
            _ => fluent.set(*name, FluentValue::String(Cow::Owned(text))),
        }
    }
    current().format(key, Some(&fluent))
}
