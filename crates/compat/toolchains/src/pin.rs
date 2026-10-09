// SPDX-License-Identifier: Apache-2.0
//! Version pins read from repository files.

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{ResolveError, Toolchain};

/// A version requirement and the file it came from.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pin {
    /// The requirement as written, without surrounding quotes (`1.4.2`, `>=0.12`).
    pub version: String,
    /// The file that declared it.
    pub source: PathBuf,
}

impl Pin {
    /// Whether `installed` satisfies the pin. Supported forms: an exact or
    /// partial version (`1.4.2`, `1.4`, `==1.4.2`, `v1.4.2`, matched component
    /// by component), exact prerelease/fork identities, `>=X[.Y[.Z]]`, and
    /// `latest` (always satisfied). Build metadata does not change identity.
    #[must_use]
    pub fn matches(&self, installed: &str) -> bool {
        let req = self.version.trim();
        if req.eq_ignore_ascii_case("latest") {
            return true;
        }
        let Some(have) = components(installed) else { return false };
        if let Some(min) = req.strip_prefix(">=") {
            return components(min).is_some_and(|want| {
                let n = want.len().max(have.len());
                let pad =
                    |v: &[u64]| (0..n).map(|i| v.get(i).copied().unwrap_or(0)).collect::<Vec<_>>();
                pad(&have) >= pad(&want)
            });
        }
        let exact = req.trim_start_matches("==").trim_start_matches('=');
        // A fork/prerelease suffix is part of an exact pin's identity. Numeric
        // prefix matching would silently accept aphrody.3 for aphrody.4.
        if exact.contains('-') {
            fn identity(v: &str) -> &str {
                v.trim().trim_start_matches('v').split(['+', ' ']).next().unwrap_or(v)
            }
            return identity(exact) == identity(installed);
        }
        components(exact).is_some_and(|want| want.len() <= have.len() && have.starts_with(&want))
    }
}

/// Numeric `major.minor.patch` components; pre-release/build suffixes are dropped.
fn components(version: &str) -> Option<Vec<u64>> {
    let core = version.trim().trim_start_matches('v');
    let core = core.split(['-', '+', ' ']).next()?;
    core.split('.').map(|c| c.parse().ok()).collect::<Option<Vec<_>>>().filter(|v| !v.is_empty())
}

/// Walk from `start` to the filesystem root; the nearest directory that pins
/// the tool wins. Inside one directory the dedicated file is read first, then
/// the ecosystem manifest, then `mise.toml`.
pub(crate) fn find(tool: Toolchain, start: &Path) -> Result<Option<Pin>, ResolveError> {
    for dir in start.ancestors() {
        for reader in readers(tool) {
            if let Some(pin) = reader(dir)? {
                return Ok(Some(pin));
            }
        }
    }
    Ok(None)
}

type Reader = fn(&Path) -> Result<Option<Pin>, ResolveError>;

fn readers(tool: Toolchain) -> &'static [Reader] {
    match tool {
        Toolchain::Bun => &[bun_version_file, package_json, mise_bun],
        Toolchain::Uv => &[uv_toml, pyproject, mise_uv],
        Toolchain::Nu => &[nu_version_file, mise_nu],
    }
}

fn read(path: &Path) -> Result<Option<String>, ResolveError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ResolveError::PinFile { path: path.to_path_buf(), message: e.to_string() }),
    }
}

fn pin(version: &str, source: PathBuf) -> Option<Pin> {
    let version = version.trim().trim_matches('"').trim();
    (!version.is_empty()).then(|| Pin { version: version.to_owned(), source })
}

fn plain_file(path: PathBuf) -> Result<Option<Pin>, ResolveError> {
    Ok(read(&path)?.and_then(|text| {
        let line = text.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#'))?;
        pin(line, path)
    }))
}

fn toml_file(path: PathBuf) -> Result<Option<(toml::Value, PathBuf)>, ResolveError> {
    let Some(text) = read(&path)? else { return Ok(None) };
    let value = toml::from_str::<toml::Value>(&text)
        .map_err(|e| ResolveError::PinFile { path: path.clone(), message: e.to_string() })?;
    Ok(Some((value, path)))
}

fn bun_version_file(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    plain_file(dir.join(".bun-version"))
}

fn nu_version_file(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    plain_file(dir.join(".nu-version"))
}

/// `package.json#packageManager = "bun@1.4.2"` (a `+sha…` suffix is ignored).
fn package_json(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    let path = dir.join("package.json");
    let Some(text) = read(&path)? else { return Ok(None) };
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| ResolveError::PinFile { path: path.clone(), message: e.to_string() })?;
    Ok(value
        .get("packageManager")
        .and_then(serde_json::Value::as_str)
        .and_then(|pm| pm.strip_prefix("bun@"))
        .and_then(|v| pin(v.split('+').next().unwrap_or(v), path)))
}

/// `uv.toml#required-version`.
fn uv_toml(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    Ok(toml_file(dir.join("uv.toml"))?.and_then(|(value, path)| {
        value.get("required-version").and_then(toml::Value::as_str).and_then(|v| pin(v, path))
    }))
}

/// `pyproject.toml#tool.uv.required-version`.
fn pyproject(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    Ok(toml_file(dir.join("pyproject.toml"))?.and_then(|(value, path)| {
        value
            .get("tool")
            .and_then(|t| t.get("uv"))
            .and_then(|u| u.get("required-version"))
            .and_then(toml::Value::as_str)
            .and_then(|v| pin(v, path))
    }))
}

fn mise(dir: &Path, keys: &[&str]) -> Result<Option<Pin>, ResolveError> {
    Ok(toml_file(dir.join("mise.toml"))?.and_then(|(value, path)| {
        let tools = value.get("tools")?;
        keys.iter().find_map(|key| {
            let entry = tools.get(*key)?;
            // `bun = "1.4.2"`, `bun = ["1.4.2"]` or `bun = { version = "1.4.2" }`.
            let version = entry
                .as_str()
                .or_else(|| entry.as_array().and_then(|a| a.first()).and_then(toml::Value::as_str))
                .or_else(|| entry.get("version").and_then(toml::Value::as_str))?;
            pin(version, path.clone())
        })
    }))
}

fn mise_bun(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    mise(dir, &["bun"])
}

fn mise_uv(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    mise(dir, &["uv"])
}

fn mise_nu(dir: &Path) -> Result<Option<Pin>, ResolveError> {
    mise(dir, &["nushell", "nu"])
}

#[cfg(test)]
mod tests {
    use super::Pin;
    use std::path::PathBuf;

    fn matches(requirement: &str, installed: &str) -> bool {
        Pin { version: requirement.into(), source: PathBuf::from("package.json") }
            .matches(installed)
    }

    #[test]
    fn exact_fork_pin_preserves_release_identity() {
        assert!(!matches("1.4.3-aphrody.4", "1.4.3-aphrody.3"));
        assert!(!matches("1.4.3-aphrody.4", "1.4.3"));
        assert!(!matches("1.4.3-aphrody.4", "1.4.3-aphrody.5"));
        assert!(!matches("1.4.3-aphrody.4", "1.4.3-canary.4"));
        assert!(matches("1.4.3-aphrody.4", "1.4.3-aphrody.4+41211b568"));
        assert!(matches("==v1.4.3-aphrody.4", "v1.4.3-aphrody.4"));
    }

    #[test]
    fn existing_numeric_and_minimum_pins_still_match() {
        assert!(matches("1.4", "1.4.3-aphrody.4"));
        assert!(matches("1.4.3", "1.4.3-aphrody.4"));
        assert!(matches(">=1.4.2", "1.4.3-aphrody.4"));
        assert!(!matches(">=1.4.4", "1.4.3-aphrody.4"));
        assert!(matches("latest", "1.4.3-aphrody.4"));
        assert!(!matches("1.4.3-aphrody.4", "not a version"));
    }
}
