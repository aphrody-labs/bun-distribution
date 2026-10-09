// SPDX-License-Identifier: Apache-2.0
//! The `"system"` lock block (Bun writes it into `bun.lock`).
//!
//! ```jsonc
//! "system": {
//!   "winget:Microsoft.PowerToys": { "version": "0.101.2362.0", "specifier": "^0.100", "url": "https://…/509b", "hash": "sha256:3450…", "deps": [], "meta": { "manifest": "manifests/m/…/509b" } },
//! },
//! ```
//!
//! Keys are `<source>:<id>`, sorted. `url`/`hash` pin what the source needs to
//! reproduce the install (winget: the manifest, apk: the package file).

use std::collections::BTreeMap;

use crate::value::{Value, write_json_string};
use crate::{Error, Result, SourceKind};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LockEntry {
    pub source: SourceKind,
    pub id: String,
    /// The range from `systemDependencies` this entry was resolved for.
    pub specifier: String,
    pub version: String,
    pub url: String,
    /// `sha256:<hex>` (or `sha1:`/`sha512:` for sources that only publish those).
    pub hash: String,
    /// Other system packages this one needs, as `<source>:<id>` keys.
    pub deps: Vec<String>,
    /// Source-specific extra fields, sorted by key.
    pub meta: BTreeMap<String, String>,
}

impl LockEntry {
    pub fn new(source: SourceKind, id: &str) -> LockEntry {
        LockEntry {
            source,
            id: id.to_owned(),
            specifier: String::new(),
            version: String::new(),
            url: String::new(),
            hash: String::new(),
            deps: Vec::new(),
            meta: BTreeMap::new(),
        }
    }

    pub fn key(&self) -> String {
        crate::lock_key(self.source, &self.id)
    }

    /// One-line JSON object, as written in the lock.
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(256);
        out.push_str("{ \"version\": ");
        write_json_string(&mut out, &self.version);
        out.push_str(", \"specifier\": ");
        write_json_string(&mut out, &self.specifier);
        out.push_str(", \"url\": ");
        write_json_string(&mut out, &self.url);
        out.push_str(", \"hash\": ");
        write_json_string(&mut out, &self.hash);
        out.push_str(", \"deps\": [");
        for (i, dep) in self.deps.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            write_json_string(&mut out, dep);
        }
        out.push(']');
        if !self.meta.is_empty() {
            out.push_str(", \"meta\": { ");
            for (i, (k, v)) in self.meta.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_json_string(&mut out, k);
                out.push_str(": ");
                write_json_string(&mut out, v);
            }
            out.push_str(" }");
        }
        out.push_str(" }");
        out
    }

    pub fn from_value(key: &str, value: &Value) -> Result<LockEntry> {
        let bad =
            |what: &str| Error::Parse(format!("bun.lock: invalid \"system\".\"{key}\": {what}"));
        let spec = crate::parse_entry(key.as_bytes(), b"*").ok_or_else(|| bad("unknown source"))?;
        let field = |name: &str| -> Result<String> {
            match value.get(name) {
                Some(v) => v
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| bad(&format!("\"{name}\" must be a string"))),
                None => Ok(String::new()),
            }
        };
        let mut entry = LockEntry::new(spec.source, &spec.id);
        entry.version = field("version")?;
        entry.specifier = field("specifier")?;
        entry.url = field("url")?;
        entry.hash = field("hash")?;
        if entry.version.is_empty() {
            return Err(bad("missing \"version\""));
        }
        if let Some(deps) = value.get("deps") {
            for dep in deps.as_array() {
                entry
                    .deps
                    .push(dep.as_str().ok_or_else(|| bad("\"deps\" must be strings"))?.to_owned());
            }
        }
        if let Some(Value::Object(rows)) = value.get("meta") {
            for (k, v) in rows {
                let v = v.as_str().ok_or_else(|| bad("\"meta\" values must be strings"))?;
                entry.meta.insert(k.clone(), v.to_owned());
            }
        }
        Ok(entry)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SystemLock {
    pub entries: BTreeMap<String, LockEntry>,
}

impl SystemLock {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The `"system": { … },\n` block at `indent` levels of two spaces, or
    /// nothing when empty.
    pub fn write_text(&self, out: &mut Vec<u8>, indent: usize) {
        if self.entries.is_empty() {
            return;
        }
        let pad = |out: &mut Vec<u8>, n: usize| out.extend(core::iter::repeat_n(b' ', n * 2));
        pad(out, indent);
        out.extend_from_slice(b"\"system\": {\n");
        for (key, entry) in &self.entries {
            pad(out, indent + 1);
            let mut line = String::new();
            write_json_string(&mut line, key);
            line.push_str(": ");
            line.push_str(&entry.to_json());
            line.push_str(",\n");
            out.extend_from_slice(line.as_bytes());
        }
        pad(out, indent);
        out.extend_from_slice(b"},\n");
    }

    pub fn from_value(value: &Value) -> Result<SystemLock> {
        let Value::Object(rows) = value else {
            return Err(Error::Parse("bun.lock: \"system\" must be an object".to_owned()));
        };
        let mut lock = SystemLock::default();
        for (key, v) in rows {
            let entry = LockEntry::from_value(key, v)?;
            lock.entries.insert(key.clone(), entry);
        }
        Ok(lock)
    }

    /// Standalone JSON(C) document (`{ "system": { … }, }`), used by `bun.lockb`.
    pub fn to_document(&self) -> Vec<u8> {
        let mut out = b"{\n".to_vec();
        self.write_text(&mut out, 1);
        out.extend_from_slice(b"}\n");
        out
    }

    /// Reads [`SystemLock::to_document`] output once parsed by the host.
    pub fn from_document_value(root: &Value) -> Result<SystemLock> {
        match root.get("system") {
            Some(v) => SystemLock::from_value(v),
            None => Ok(SystemLock::default()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_round_trip() {
        let mut e = LockEntry::new(SourceKind::Winget, "Test.Tool");
        e.version = "1.2.0".into();
        e.specifier = "*".into();
        e.hash = "sha256:ab".into();
        e.deps.push("winget:Dep".into());
        e.meta.insert("manifest".into(), "m/t/1.2.0.yaml".into());
        let s = |x: &str| Value::String(x.to_owned());
        let v = Value::Object(vec![
            ("version".into(), s("1.2.0")),
            ("specifier".into(), s("*")),
            ("url".into(), s("")),
            ("hash".into(), s("sha256:ab")),
            ("deps".into(), Value::Array(vec![s("winget:Dep")])),
            ("meta".into(), Value::Object(vec![("manifest".into(), s("m/t/1.2.0.yaml"))])),
        ]);
        assert_eq!(LockEntry::from_value("winget:Test.Tool", &v).unwrap(), e);
        assert!(e.to_json().starts_with("{ \"version\": \"1.2.0\", \"specifier\": \"*\""));
        let mut lock = SystemLock::default();
        lock.entries.insert(e.key(), e);
        let mut out = Vec::new();
        lock.write_text(&mut out, 1);
        assert!(out.starts_with(b"  \"system\": {\n    \"winget:Test.Tool\": {"));
    }
}
