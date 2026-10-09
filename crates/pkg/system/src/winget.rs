// SPDX-License-Identifier: Apache-2.0
//! winget community source v2, without `winget.exe` and without I/O.
//!
//! 1. `source2.msix` (zip) → `Public/index.db` (SQLite): table `packages(id, name, moniker,
//!    latest_version, hash)` → [`parse_index`].
//! 2. `packages/<id>/<hex(hash)[0..8]>/versionData.mszyml`: MSZIP YAML
//!    `vD: [{ v, rP, s256H }]` → [`version_refs`] once the host inflated and parsed it.
//! 3. `<rP>`: merged YAML manifest, verified by the host against `s256H` →
//!    [`manifest_deps`], [`pick`], [`install_argv`], [`uninstall_plan`].

use core::cmp::Ordering;

use crate::value::Value;
use crate::{Error, Result, SourceKind, sqlite, version};

pub const DEFAULT_SOURCE: &str = "https://cdn.winget.microsoft.com/cache";
pub const SOURCE_MSIX: &str = "source2.msix";
pub const INDEX_ENTRY: &[u8] = b"Public/index.db";
/// The index is refreshed after an hour, like `winget source update`'s auto-update.
pub const INDEX_MAX_AGE_SECS: u64 = 60 * 60;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexRow {
    pub id: String,
    pub name: String,
    pub moniker: Option<String>,
    pub latest: String,
    pub hash: Vec<u8>,
}

impl IndexRow {
    fn hash8(&self) -> String {
        let mut hex = String::with_capacity(8);
        for b in self.hash.iter().take(4) {
            use core::fmt::Write as _;
            let _ = write!(hex, "{b:02x}");
        }
        hex
    }

    /// `packages/<id>/<hash8>/versionData.mszyml`, relative to the source base URL.
    pub fn version_data_path(&self) -> String {
        format!("packages/{}/{}/versionData.mszyml", self.id, self.hash8())
    }

    /// Cache file name; it embeds the index hash, so a cached copy never goes stale.
    pub fn version_data_cache_name(&self) -> String {
        format!("versions/{}-{}.mszyml", self.id, self.hash8())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VersionRef {
    pub version: String,
    /// Manifest path relative to the source base URL.
    pub rel_path: String,
    /// Lowercase hex sha256 of the manifest.
    pub sha256: String,
}

/// Package ids go into URLs verbatim; reject anything that could escape the path.
pub fn check_id(id: &str) -> Result<()> {
    let ok = !id.is_empty()
        && id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_' | b'+'))
        && !id.starts_with('.');
    if ok { Ok(()) } else { Err(Error::Parse(format!("invalid winget package id \"{id}\""))) }
}

pub fn url_join(base: &str, rel: &str) -> String {
    let base = base.trim_end_matches('/');
    let mut url = String::with_capacity(base.len() + 1 + rel.len());
    url.push_str(base);
    url.push('/');
    url.push_str(rel.trim_start_matches('/'));
    url
}

pub fn parse_index(db: &[u8]) -> Result<Vec<IndexRow>> {
    let db = sqlite::Database::open(db)?;
    let (root, cols) = db.table("packages")?;
    let col = |name: &str| cols.iter().position(|c| c.eq_ignore_ascii_case(name));
    let (Some(c_id), Some(c_name), Some(c_latest), Some(c_hash)) =
        (col("id"), col("name"), col("latest_version"), col("hash"))
    else {
        return Err(Error::Parse("winget index: unexpected packages table layout".to_owned()));
    };
    let c_moniker = col("moniker");
    let mut rows = Vec::new();
    db.scan(root, &mut |_, cells| {
        let text = |i: usize| {
            cells
                .get(i)
                .and_then(sqlite::Cell::text)
                .map(|t| String::from_utf8_lossy(t).into_owned())
        };
        let (Some(id), Some(latest)) = (text(c_id), text(c_latest)) else {
            return Ok(());
        };
        rows.push(IndexRow {
            id,
            name: text(c_name).unwrap_or_default(),
            moniker: c_moniker.and_then(text),
            latest,
            hash: cells
                .get(c_hash)
                .and_then(sqlite::Cell::bytes)
                .map(<[u8]>::to_vec)
                .unwrap_or_default(),
        });
        Ok(())
    })?;
    Ok(rows)
}

/// Case-insensitive id lookup.
pub fn find<'a>(rows: &'a [IndexRow], id: &str) -> Result<&'a IndexRow> {
    check_id(id)?;
    rows.iter()
        .find(|r| r.id.eq_ignore_ascii_case(id))
        .ok_or_else(|| Error::NotFound(format!("winget package \"{id}\"")))
}

/// Ranks by exact id/moniker, exact name, id/moniker substring, name substring.
pub fn search<'a>(rows: &'a [IndexRow], query: &str, limit: usize) -> Vec<&'a IndexRow> {
    let q = query.trim().to_ascii_lowercase();
    let contains = |hay: &str| hay.to_ascii_lowercase().contains(&q);
    let mut hits: Vec<(u8, &IndexRow)> = rows
        .iter()
        .filter_map(|r| {
            let rank = if r.id.eq_ignore_ascii_case(&q)
                || r.moniker.as_deref().is_some_and(|m| m.eq_ignore_ascii_case(&q))
            {
                0
            } else if r.name.eq_ignore_ascii_case(&q) {
                1
            } else if contains(&r.id) || r.moniker.as_deref().is_some_and(contains) {
                2
            } else if contains(&r.name) {
                3
            } else {
                return None;
            };
            Some((rank, r))
        })
        .collect();
    hits.sort_by(|a, b| {
        a.0.cmp(&b.0).then_with(|| a.1.id.to_ascii_lowercase().cmp(&b.1.id.to_ascii_lowercase()))
    });
    hits.into_iter().take(if limit == 0 { usize::MAX } else { limit }).map(|(_, r)| r).collect()
}

/// Versions listed by a parsed `versionData` document, newest first.
pub fn version_refs(doc: &Value, id: &str) -> Result<Vec<VersionRef>> {
    let mut out = Vec::new();
    for v in doc.array_ci("vD") {
        let (Some(version), Some(rel_path), Some(sha256)) =
            (v.str_ci("v"), v.str_ci("rP"), v.str_ci("s256H"))
        else {
            continue;
        };
        out.push(VersionRef {
            version: version.to_owned(),
            rel_path: rel_path.to_owned(),
            sha256: sha256.to_ascii_lowercase(),
        });
    }
    if out.is_empty() {
        return Err(Error::Parse(format!("winget: no versions listed for {id}")));
    }
    out.sort_by(|a, b| version::compare(&b.version, &a.version));
    Ok(out)
}

/// Highest listed version satisfying `range`.
pub fn select_version<'a>(
    versions: &'a [VersionRef],
    id: &str,
    range: &str,
) -> Result<&'a VersionRef> {
    let best = version::best_match(
        versions.iter().map(|v| v.version.as_str()),
        range,
        version::compare,
    )
    .ok_or_else(|| Error::NoMatchingVersion { id: id.to_owned(), range: range.to_owned() })?;
    versions
        .iter()
        .find(|v| v.version == best)
        .ok_or_else(|| Error::Parse(format!("winget: version {best} of {id} vanished")))
}

/// `Dependencies.PackageDependencies[].PackageIdentifier`, at the root or on any
/// installer, as `winget:<id>` keys.
pub fn manifest_deps(m: &Value) -> Vec<String> {
    let mut deps: Vec<String> = Vec::new();
    let mut add = |node: &Value| {
        if let Some(d) = node.get_ci("Dependencies") {
            for p in d.array_ci("PackageDependencies") {
                if let Some(id) = p.str_ci("PackageIdentifier") {
                    let key = crate::lock_key(SourceKind::Winget, id);
                    if !deps.contains(&key) {
                        deps.push(key);
                    }
                }
            }
        }
    };
    add(m);
    for inst in m.array_ci("Installers") {
        add(inst);
    }
    deps
}

// ── installer selection ──

/// Host preferences for [`pick`].
#[derive(Clone, Debug)]
pub struct Preferences {
    /// `x64`, `arm64` or `x86`.
    pub arch: String,
    /// `user` or `machine`.
    pub scope: Option<String>,
    /// e.g. `en-US`.
    pub locale: Option<String>,
    /// The host may run installers that need administrator rights.
    pub may_elevate: bool,
}

/// Architecture of the running binary, in winget's naming.
pub fn default_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x64"
    }
}

/// A manifest installer with root-level defaults applied.
#[derive(Clone, Copy, Debug)]
pub struct Installer<'a> {
    node: &'a Value,
    root: &'a Value,
}

impl<'a> Installer<'a> {
    pub fn get(&self, key: &str) -> Option<&'a Value> {
        self.node.get_ci(key).or_else(|| self.root.get_ci(key))
    }

    pub fn str(&self, key: &str) -> Option<&'a str> {
        self.get(key).and_then(Value::as_str)
    }

    pub fn lower(&self, key: &str) -> String {
        self.str(key).unwrap_or("").to_ascii_lowercase()
    }

    /// Lowercase `InstallerType`.
    pub fn installer_type(&self) -> String {
        self.lower("InstallerType")
    }

    pub fn switch(&self, name: &str) -> Option<&'a str> {
        self.node
            .get_ci("InstallerSwitches")
            .and_then(|s| s.str_ci(name))
            .or_else(|| self.root.get_ci("InstallerSwitches").and_then(|s| s.str_ci(name)))
    }

    /// `NestedInstallerFiles` as `(RelativeFilePath, PortableCommandAlias)`.
    pub fn nested_files(&self) -> Vec<(String, Option<String>)> {
        self.get("NestedInstallerFiles")
            .map(|v| {
                v.as_array()
                    .iter()
                    .filter_map(|f| {
                        Some((
                            f.str_ci("RelativeFilePath")?.to_owned(),
                            f.str_ci("PortableCommandAlias").map(str::to_owned),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Command name of a `portable` installer: first `Commands` entry, else the file stem.
    pub fn portable_command(&self, file_name: &str) -> String {
        self.get("Commands")
            .and_then(|c| c.as_array().first())
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| stem(file_name).to_owned())
    }

    pub fn product_code(&self) -> Option<String> {
        self.str("ProductCode").map(str::to_owned).or_else(|| {
            self.get("AppsAndFeaturesEntries")
                .and_then(|e| e.as_array().iter().find_map(|x| x.str_ci("ProductCode")))
                .map(str::to_owned)
        })
    }
}

fn arch_rank(host: &str, arch: &str) -> Option<u8> {
    match (host, arch) {
        (h, a) if h == a => Some(0),
        (_, "neutral") => Some(1),
        ("arm64", "x64") => Some(2),
        ("x64" | "arm64", "x86") => Some(3),
        _ => None,
    }
}

pub const SUPPORTED_TYPES: &[&str] =
    &["portable", "zip", "msi", "wix", "burn", "inno", "nullsoft", "exe", "msix", "appx"];

/// Picks the installer winget would: matching architecture first, then the
/// requested (or user) scope, then the requested locale, then file-based types.
pub fn pick<'a>(manifest: &'a Value, id: &str, prefs: &Preferences) -> Result<Installer<'a>> {
    let host = prefs.arch.to_ascii_lowercase();
    let want_scope = prefs.scope.as_deref().map(str::to_ascii_lowercase);
    let want_locale = prefs.locale.as_deref().map(str::to_ascii_lowercase);
    let mut best: Option<((u8, u8, u8, u8), Installer<'a>)> = None;
    for node in manifest.array_ci("Installers") {
        let p = Installer { node, root: manifest };
        let Some(arch_score) = arch_rank(&host, &p.lower("Architecture")) else {
            continue;
        };
        let ty = p.installer_type();
        if !SUPPORTED_TYPES.contains(&ty.as_str()) {
            continue;
        }
        let scope = p.lower("Scope");
        let scope_score = match (&want_scope, scope.as_str()) {
            (Some(w), s) if w == s => 0,
            (Some(_), "") => 1,
            (Some(_), _) => continue,
            (None, "user") => 0,
            (None, "") => 1,
            (None, _) if prefs.may_elevate => 2,
            (None, _) => 3,
        };
        let locale = p.lower("InstallerLocale");
        let lang = |l: &str| l.get(..2).unwrap_or(l).to_owned();
        let locale_score = match &want_locale {
            Some(w) if *w == locale => 0,
            Some(w) if !locale.is_empty() && lang(&locale) == lang(w) => 1,
            _ if locale.is_empty() || locale == "en-us" => 2,
            _ => 3,
        };
        let type_score = if matches!(ty.as_str(), "portable" | "zip") { 0 } else { 1 };
        let key = (arch_score, scope_score, locale_score, type_score);
        if best.as_ref().is_none_or(|(k, _)| key < *k) {
            best = Some((key, p));
        }
    }
    best.map(|(_, p)| p).ok_or_else(|| {
        Error::Unsupported(format!("winget: {id} has no installer for {host} that bun can run"))
    })
}

/// Last path segment of a URL, without query or fragment.
pub fn file_name_of(url: &str) -> &str {
    let path = &url[..url.find(['?', '#']).unwrap_or(url.len())];
    &path[path.rfind('/').map_or(0, |i| i + 1)..]
}

/// `.ext` of a file name when it looks like a real extension.
pub fn extension_of(name: &str) -> Option<&str> {
    let ext = &name[name.rfind('.')?..];
    (ext.len() > 1 && ext.len() <= 8 && ext.bytes().skip(1).all(|c| c.is_ascii_alphanumeric()))
        .then_some(ext)
}

pub fn default_extension(ty: &str) -> &'static str {
    match ty {
        "msi" | "wix" => ".msi",
        "zip" => ".zip",
        "msix" | "appx" => ".msix",
        _ => ".exe",
    }
}

/// File name without directories and extension.
pub fn stem(name: &str) -> &str {
    let base = &name[name.rfind(['/', '\\']).map_or(0, |i| i + 1)..];
    match extension_of(base) {
        Some(ext) => &base[..base.len() - ext.len()],
        None => base,
    }
}

/// Machine-wide installers need administrator rights: an explicit
/// `ElevationRequirement`, `Scope: machine`, or unscoped msi/inno/burn.
pub fn needs_elevation(p: &Installer<'_>, ty: &str) -> bool {
    let req = p.lower("ElevationRequirement");
    if matches!(req.as_str(), "elevationrequired" | "elevatesself") {
        return true;
    }
    match p.lower("Scope").as_str() {
        "user" => false,
        "machine" => true,
        _ => !matches!(ty, "msix" | "appx" | "nullsoft" | "exe"),
    }
}

/// Silent install command line for a native installer stored at `file`.
pub fn install_argv(p: &Installer<'_>, ty: &str, file: &str, id: &str) -> Result<Vec<String>> {
    let user_scope = p.lower("Scope") == "user";
    let silent = p.switch("Silent").map(split_args);
    let owned = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let mut argv: Vec<String> = match ty {
        "msi" | "wix" => {
            let mut a = owned(&["msiexec", "/i", file]);
            a.extend(silent.unwrap_or_else(|| owned(&["/quiet", "/norestart"])));
            if user_scope {
                a.extend(owned(&["ALLUSERS=2", "MSIINSTALLPERUSER=1"]));
            }
            a
        },
        "inno" => {
            let mut a = vec![file.to_owned()];
            a.extend(silent.unwrap_or_else(|| {
                owned(&["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"])
            }));
            match p.lower("Scope").as_str() {
                "user" => a.push("/CURRENTUSER".to_owned()),
                "machine" => a.push("/ALLUSERS".to_owned()),
                _ => {},
            }
            a
        },
        "nullsoft" => {
            let mut a = vec![file.to_owned()];
            a.extend(silent.unwrap_or_else(|| owned(&["/S"])));
            a
        },
        "burn" => {
            let mut a = vec![file.to_owned()];
            a.extend(silent.unwrap_or_else(|| owned(&["/quiet", "/norestart"])));
            a
        },
        "exe" => {
            let Some(silent) = silent else {
                return Err(Error::Unsupported(format!(
                    "winget: {id} uses an exe installer without silent switches"
                )));
            };
            let mut a = vec![file.to_owned()];
            a.extend(silent);
            a
        },
        "msix" | "appx" => {
            let mut a = owned(&["powershell", "-NoProfile", "-NonInteractive", "-Command"]);
            a.push(format!("Add-AppxPackage -Path {}", ps_quote(file)));
            a
        },
        other => {
            return Err(Error::Unsupported(format!("winget: unsupported installer type {other}")));
        },
    };
    if let Some(custom) = p.switch("Custom")
        && !matches!(ty, "msix" | "appx")
    {
        argv.extend(split_args(custom));
    }
    Ok(argv)
}

/// 0, 3010 (reboot required), 1641 (reboot initiated) or a listed `InstallerSuccessCodes`.
pub fn is_install_success(p: &Installer<'_>, code: i64) -> bool {
    matches!(code, 0 | 3010 | 1641)
        || p.get("InstallerSuccessCodes").is_some_and(|c| {
            c.as_array()
                .iter()
                .any(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()) == Some(code))
        })
}

/// How to uninstall what a native installer put on the machine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UninstallPlan {
    Argv(Vec<String>),
    /// Read `QuietUninstallString`/`UninstallString` of this Apps & Features
    /// entry, then call [`registry_uninstall_argv`].
    Registry {
        product_code: String,
    },
    None,
}

pub fn uninstall_plan(p: &Installer<'_>, ty: &str) -> UninstallPlan {
    let code = p.product_code();
    match ty {
        "msi" | "wix" => match code {
            Some(c) => UninstallPlan::Argv(
                ["msiexec", "/x", c.as_str(), "/quiet", "/norestart"].map(str::to_owned).to_vec(),
            ),
            None => UninstallPlan::None,
        },
        "msix" | "appx" => match p.str("PackageFamilyName") {
            Some(pfn) => {
                let name = &pfn[..pfn.rfind('_').unwrap_or(pfn.len())];
                let mut a = ["powershell", "-NoProfile", "-NonInteractive", "-Command"]
                    .map(str::to_owned)
                    .to_vec();
                a.push(format!("Get-AppxPackage -Name {} | Remove-AppxPackage", ps_quote(name)));
                UninstallPlan::Argv(a)
            },
            None => UninstallPlan::None,
        },
        _ => match code {
            Some(product_code) => UninstallPlan::Registry { product_code },
            None => UninstallPlan::None,
        },
    }
}

/// `QuietUninstallString` as is, else `UninstallString` plus the type's silent flags.
pub fn registry_uninstall_argv(
    quiet: Option<&str>,
    uninstall: Option<&str>,
    ty: &str,
) -> Option<Vec<String>> {
    if let Some(q) = quiet {
        return Some(split_args(q));
    }
    let mut argv = split_args(uninstall?);
    match ty {
        "inno" => {
            argv.extend(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"].map(str::to_owned))
        },
        "nullsoft" => argv.push("/S".to_owned()),
        "burn" => argv.extend(["/quiet", "/norestart"].map(str::to_owned)),
        _ => {},
    }
    Some(argv)
}

/// Uninstalling a machine-scoped msi/inno/burn/wix package needs administrator rights.
pub fn uninstall_needs_elevation(scope: Option<&str>, installer_type: Option<&str>) -> bool {
    scope.is_none_or(|s| !s.eq_ignore_ascii_case("user"))
        && installer_type.is_some_and(|t| !matches!(t, "msix" | "appx" | "nullsoft" | "exe"))
}

/// Install success codes plus 1605 (product not installed).
pub fn is_uninstall_success(code: i64) -> bool {
    matches!(code, 0 | 3010 | 1641 | 1605)
}

/// Splits a switch string the way `CommandLineToArgvW` does for simple cases.
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has = false;
    for c in s.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                has = true;
            },
            c if c.is_whitespace() && !in_quotes => {
                if has {
                    out.push(core::mem::take(&mut cur));
                    has = false;
                }
            },
            c => {
                cur.push(c);
                has = true;
            },
        }
    }
    if has {
        out.push(cur);
    }
    out
}

/// PowerShell single-quoted literal.
pub fn ps_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push('\'');
        }
        out.push(c);
    }
    out.push('\'');
    out
}

/// Newest-first comparison of two version strings (for hosts sorting by hand).
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    version::compare(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(x: &str) -> Value {
        Value::String(x.to_owned())
    }

    fn obj(rows: &[(&str, Value)]) -> Value {
        Value::Object(rows.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect())
    }

    fn manifest() -> Value {
        obj(&[
            ("PackageIdentifier", s("Test.Tool")),
            ("InstallerType", s("msi")),
            (
                "Installers",
                Value::Array(vec![
                    obj(&[
                        ("Architecture", s("x86")),
                        ("InstallerType", s("portable")),
                        ("InstallerUrl", s("https://x/t.exe")),
                    ]),
                    obj(&[
                        ("Architecture", s("x64")),
                        ("Scope", s("machine")),
                        ("ProductCode", s("{P}")),
                    ]),
                    obj(&[
                        ("Architecture", s("x64")),
                        ("Scope", s("user")),
                        ("ProductCode", s("{U}")),
                    ]),
                    obj(&[("Architecture", s("arm64")), ("InstallerType", s("zip"))]),
                ]),
            ),
            (
                "Dependencies",
                obj(&[(
                    "PackageDependencies",
                    Value::Array(vec![obj(&[("PackageIdentifier", s("Dep.One"))])]),
                )]),
            ),
        ])
    }

    fn prefs(arch: &str) -> Preferences {
        Preferences { arch: arch.to_owned(), scope: None, locale: None, may_elevate: false }
    }

    #[test]
    fn picks_by_arch_then_scope() {
        let m = manifest();
        let p = pick(&m, "Test.Tool", &prefs("x64")).unwrap();
        assert_eq!((p.installer_type(), p.str("ProductCode")), ("msi".to_owned(), Some("{U}")));
        assert!(!needs_elevation(&p, "msi"));
        let argv = install_argv(&p, "msi", "C:\\t.msi", "Test.Tool").unwrap();
        assert_eq!(
            argv,
            [
                "msiexec",
                "/i",
                "C:\\t.msi",
                "/quiet",
                "/norestart",
                "ALLUSERS=2",
                "MSIINSTALLPERUSER=1"
            ]
        );
        assert_eq!(
            uninstall_plan(&p, "msi"),
            UninstallPlan::Argv(
                ["msiexec", "/x", "{U}", "/quiet", "/norestart"].map(str::to_owned).to_vec()
            )
        );
        let arm = pick(&m, "Test.Tool", &prefs("arm64")).unwrap();
        assert_eq!(arm.installer_type(), "zip");
        let machine = Preferences { scope: Some("machine".to_owned()), ..prefs("x64") };
        assert!(needs_elevation(&pick(&m, "Test.Tool", &machine).unwrap(), "msi"));
        assert_eq!(manifest_deps(&m), ["winget:Dep.One"]);
    }

    #[test]
    fn versions_and_ids() {
        let doc = obj(&[(
            "vD",
            Value::Array(vec![
                obj(&[("v", s("1.0.0")), ("rP", s("m/1.0.0.yaml")), ("s256H", s("AB"))]),
                obj(&[("v", s("1.10.0")), ("rP", s("m/1.10.0.yaml")), ("s256H", s("CD"))]),
            ]),
        )]);
        let refs = version_refs(&doc, "Test.Tool").unwrap();
        assert_eq!(refs[0].version, "1.10.0");
        assert_eq!(refs[0].sha256, "cd");
        assert_eq!(select_version(&refs, "Test.Tool", "<1.5").unwrap().version, "1.0.0");
        assert!(select_version(&refs, "Test.Tool", "3").is_err());
        assert!(check_id("../x").is_err());
        assert!(check_id("Microsoft.PowerToys").is_ok());
        let row = IndexRow {
            id: "A.B".into(),
            name: "AB".into(),
            moniker: Some("ab".into()),
            latest: "1".into(),
            hash: vec![0xde, 0xad, 0xbe, 0xef, 0x01],
        };
        assert_eq!(row.version_data_path(), "packages/A.B/deadbeef/versionData.mszyml");
        assert_eq!(search(std::slice::from_ref(&row), "AB", 0).len(), 1);
        assert_eq!(url_join("https://x/cache/", "/packages/a"), "https://x/cache/packages/a");
    }

    #[test]
    fn helpers() {
        assert_eq!(split_args(r#"/S /D="C:\Program Files\X""#), ["/S", r"/D=C:\Program Files\X"]);
        assert_eq!(ps_quote("it's"), "'it''s'");
        assert_eq!(file_name_of("https://x/a/tool.exe?sig=1"), "tool.exe");
        assert_eq!(stem("bin\\tool.exe"), "tool");
        assert_eq!(extension_of("archive.tar.gz"), Some(".gz"));
        assert_eq!(
            registry_uninstall_argv(None, Some("\"C:\\u.exe\""), "inno").unwrap(),
            ["C:\\u.exe", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]
        );
        assert!(uninstall_needs_elevation(None, Some("msi")));
        assert!(!uninstall_needs_elevation(Some("user"), Some("msi")));
    }
}
