//! User-visible strings by message key, from the platform layer's Fluent catalogs
//! (`packages/bun-os-platform/locales/<locale>/{common,shell}.ftl`, docs/bun-os/PLATFORM.md).
//! Keys keep their dotted form (`nav.games` is the Fluent id `nav-games`); arguments that parse as
//! numbers select plurals and format with ICU4X. Every string in the shell goes through [`t`] or
//! [`tf`]; `bun-os-platform check` fails on keys missing from the catalogs.

/// The message for `key` in the current locale (the key itself when missing, so gaps are visible).
pub fn t(key: &str) -> String {
    bun_os_platform::t(key)
}

/// The message for `key` with named arguments.
pub fn tf(key: &str, args: &[(&str, &dyn std::fmt::Display)]) -> String {
    bun_os_platform::tf(key, args)
}
