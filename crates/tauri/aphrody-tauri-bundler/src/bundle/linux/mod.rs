// Copyright 2016-2019 Cargo-Bundle developers <https://github.com/burtonageo/cargo-bundle>
// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

pub mod appimage;
pub mod debian;
pub mod freedesktop;
pub mod rpm;

/// Locale paks every CEF package ships: `en-US` is Chromium's fallback locale.
pub(crate) const CEF_REQUIRED_LOCALES: [&str; 4] = [
  "en-US.pak",
  "en-US_FEMININE.pak",
  "en-US_MASCULINE.pak",
  "en-US_NEUTER.pak",
];

/// French paks (and their grammatical gender variants), shipped when the CEF distribution has them so
/// Chromium's own strings (context menus, form validation, error pages) follow a French session.
/// The runtime's `locale` stays unset: Chromium picks the pak from the system locale and falls back
/// to `en-US`.
pub(crate) const CEF_OPTIONAL_LOCALES: [&str; 4] = [
  "fr.pak",
  "fr_FEMININE.pak",
  "fr_MASCULINE.pak",
  "fr_NEUTER.pak",
];

/// The locale paks of `locales_dir` to ship: the required ones, then the optional ones that exist.
pub(crate) fn cef_locales(locales_dir: &std::path::Path) -> Vec<&'static str> {
  CEF_REQUIRED_LOCALES
    .into_iter()
    .chain(
      CEF_OPTIONAL_LOCALES
        .into_iter()
        .filter(|name| locales_dir.join(name).is_file()),
    )
    .collect()
}
