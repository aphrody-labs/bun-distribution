// SPDX-License-Identifier: Apache-2.0
//! Verified, offline Markdown exports of the public Google Design mirror.

use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
};

use aphrody_web_extract::extract_main;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

/// A verified file from the native mirror's manifest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerifiedFile {
    pub source_url: String,
    pub path: String,
    pub kind: String,
    pub bytes: u64,
    pub sha256: String,
}

/// One extracted document, with separate source and Markdown fingerprints.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    pub source_url: String,
    pub slug: String,
    pub raw_path: String,
    pub markdown_path: String,
    /// SHA-256 of the mirrored HTML, including the mirror's link rewriting.
    pub sha256: String,
    pub markdown_sha256: String,
    pub title: String,
    pub word_count: usize,
}

/// Acquisition or extraction failures remain visible in both public indexes.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Failure {
    pub source_url: String,
    pub error: String,
}

/// Public provenance index. Paths are relative to the selected Google root.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub schema_version: u32,
    pub source_url: String,
    pub manifest_sha256: String,
    pub files_verified: usize,
    pub documents_written: usize,
    pub files: Vec<VerifiedFile>,
    pub entries: Vec<Document>,
    pub failures: Vec<Failure>,
}

/// An invalid manifest, unsafe path, corrupt file or failed index write.
#[derive(Debug)]
pub struct GoogleDesignError(String);

impl std::fmt::Display for GoogleDesignError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for GoogleDesignError {}

fn error(message: impl Into<String>) -> GoogleDesignError {
    GoogleDesignError(message.into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    seed_url: String,
    files: Vec<ManifestFile>,
    failures: Vec<ManifestFailure>,
}

#[derive(Deserialize)]
struct ManifestFile {
    url: String,
    path: String,
    kind: String,
    bytes: u64,
    blake3: String,
}

#[derive(Deserialize)]
struct ManifestFailure {
    url: String,
    error: String,
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn relative_path(raw: &str) -> Result<&Path, GoogleDesignError> {
    let path = Path::new(raw);
    if raw.is_empty()
        || raw.contains(['\\', ':', '\0'])
        || raw.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || path.components().any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(error(format!("unsafe relative path: {raw:?}")));
    }
    Ok(path)
}

fn canonical_root(root: &Path) -> Result<PathBuf, GoogleDesignError> {
    let root = root.canonicalize().map_err(|cause| error(format!("mirror root: {cause}")))?;
    if !root.is_dir() {
        return Err(error("mirror root must be a directory"));
    }
    Ok(root)
}

fn read_file(root: &Path, raw: &str) -> Result<Vec<u8>, GoogleDesignError> {
    let path = root
        .join(relative_path(raw)?)
        .canonicalize()
        .map_err(|cause| error(format!("read {raw}: {cause}")))?;
    if !path.starts_with(root) || !path.is_file() {
        return Err(error(format!("file escapes mirror root or is not a file: {raw}")));
    }
    fs::read(path).map_err(|cause| error(format!("read {raw}: {cause}")))
}

fn write_file(root: &Path, raw: &str, bytes: &[u8]) -> Result<(), GoogleDesignError> {
    let relative = relative_path(raw)?;
    let mut directory = root.to_path_buf();
    if let Some(parent) = relative.parent() {
        for component in parent.components() {
            directory.push(component);
            if !directory.exists() {
                fs::create_dir(&directory)
                    .map_err(|cause| error(format!("create parent for {raw}: {cause}")))?;
            }
            directory = directory
                .canonicalize()
                .map_err(|cause| error(format!("resolve parent for {raw}: {cause}")))?;
            if !directory.starts_with(root) || !directory.is_dir() {
                return Err(error(format!("output parent escapes mirror root: {raw}")));
            }
        }
    }
    let destination = root.join(relative);
    if destination.symlink_metadata().is_ok() {
        let resolved = destination
            .canonicalize()
            .map_err(|cause| error(format!("resolve output {raw}: {cause}")))?;
        if !resolved.starts_with(root) || !resolved.is_file() {
            return Err(error(format!("output escapes mirror root or is not a file: {raw}")));
        }
    }
    fs::write(destination, bytes).map_err(|cause| error(format!("write {raw}: {cause}")))
}

fn public_url(raw: &str) -> Result<Url, GoogleDesignError> {
    let url = Url::parse(raw).map_err(|cause| error(format!("invalid source URL: {cause}")))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error("source URL must be credential-free HTTP(S)"));
    }
    Ok(url)
}

/// Verify the real `mirror_site` schema, byte lengths, BLAKE3 and path closure.
/// SHA-256 fingerprints include every mirrored page and asset, plus the manifest.
/// Acquisition failures are returned explicitly, without claiming complete coverage.
pub fn verify_mirror(root: &Path) -> Result<Report, GoogleDesignError> {
    let root = canonical_root(root)?;
    let bytes = read_file(&root, "manifest.json")?;
    let manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|cause| error(format!("mirror manifest: {cause}")))?;
    if manifest.schema_version != 1 {
        return Err(error("unsupported mirror schemaVersion"));
    }
    public_url(&manifest.seed_url)?;
    let mut report = Report {
        schema_version: 1,
        source_url: manifest.seed_url,
        manifest_sha256: sha256(&bytes),
        files_verified: 0,
        documents_written: 0,
        files: Vec::new(),
        entries: Vec::new(),
        failures: manifest
            .failures
            .into_iter()
            .map(|failure| Failure { source_url: failure.url, error: failure.error })
            .collect(),
    };
    let mut seen = BTreeSet::new();
    for entry in manifest.files {
        public_url(&entry.url)?;
        if !seen.insert(entry.path.to_ascii_lowercase()) || entry.path == "manifest.json" {
            return Err(error(format!("duplicate or reserved mirror path: {}", entry.path)));
        }
        let bytes = read_file(&root, &entry.path)?;
        if bytes.len() as u64 != entry.bytes {
            return Err(error(format!("byte length mismatch: {}", entry.path)));
        }
        if blake3::hash(&bytes).to_hex().as_str() != entry.blake3 {
            return Err(error(format!("BLAKE3 mismatch: {}", entry.path)));
        }
        report.files.push(VerifiedFile {
            source_url: entry.url,
            path: entry.path,
            kind: entry.kind,
            bytes: entry.bytes,
            sha256: sha256(&bytes),
        });
    }
    report.files.sort_by(|left, right| left.path.cmp(&right.path));
    report.files_verified = report.files.len();
    Ok(report)
}

fn document_slug(url: &Url) -> String {
    let mut parts: Vec<String> = url
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| {
            part.chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                        character
                    } else {
                        '-'
                    }
                })
                .collect()
        })
        .collect();
    if let Some(last) = parts.last_mut() {
        for extension in [".html", ".htm"] {
            if last.ends_with(extension) {
                last.truncate(last.len() - extension.len());
                break;
            }
        }
        if last.is_empty() || last == "." || last == ".." {
            *last = "index".into();
        }
    } else {
        parts.push("index".into());
    }
    let mut slug = parts.join("/");
    if url.query().is_some() {
        slug.push('-');
        slug.push_str(&sha256(url.as_str().as_bytes())[..12]);
    }
    slug
}

/// Extract Google Design HTML through the shared native main-content extractor.
/// Empty application shells and failed pages are reported, never fabricated.
pub fn export_google_documents(root: &Path) -> Result<Report, GoogleDesignError> {
    let root = canonical_root(root)?;
    let mut report = verify_mirror(&root)?;
    let seed = public_url(&report.source_url)?;
    if seed.host_str() != Some("design.google") {
        return Err(error("Google Design export requires a design.google mirror"));
    }
    let mut slugs = BTreeSet::new();
    for file in &report.files {
        if file.kind != "html" {
            continue;
        }
        let result = (|| {
            let url = public_url(&file.source_url)?;
            if url.host_str() != seed.host_str() {
                return Err(error("HTML source is outside the Google Design mirror"));
            }
            let slug = document_slug(&url);
            if !slugs.insert(slug.to_ascii_lowercase()) {
                return Err(error(format!("document slug collision: {slug}")));
            }
            let bytes = read_file(&root, &file.path)?;
            if sha256(&bytes) != file.sha256 {
                return Err(error("HTML changed after mirror verification"));
            }
            let html = std::str::from_utf8(&bytes)
                .map_err(|cause| error(format!("HTML is not UTF-8: {cause}")))?;
            let extracted = extract_main(html, Some(url.as_str()));
            if extracted.markdown.trim().is_empty() || extracted.word_count == 0 {
                return Err(error("no readable main content in mirrored HTML"));
            }
            let markdown_path = format!("documents/{slug}.md");
            let markdown = format!(
                "Source: <{}>\n\nMirrored HTML SHA-256: `{}`\n\n{}\n",
                file.source_url,
                file.sha256,
                extracted.markdown.trim()
            );
            write_file(&root, &markdown_path, markdown.as_bytes())?;
            Ok(Document {
                source_url: file.source_url.clone(),
                slug,
                raw_path: file.path.clone(),
                markdown_path,
                sha256: file.sha256.clone(),
                markdown_sha256: sha256(markdown.as_bytes()),
                title: extracted.title,
                word_count: extracted.word_count,
            })
        })();
        match result {
            Ok(document) => report.entries.push(document),
            Err(cause) => report
                .failures
                .push(Failure { source_url: file.source_url.clone(), error: cause.to_string() }),
        }
    }
    report.entries.sort_by(|left, right| left.slug.cmp(&right.slug));
    report.documents_written = report.entries.len();
    let mut catalog = serde_json::to_vec_pretty(&report)
        .map_err(|cause| error(format!("serialize Google catalog: {cause}")))?;
    catalog.push(b'\n');
    write_file(&root, "google-catalog.json", &catalog)?;
    let mut index = format!(
        "# Google Design — extracted public documents\n\nSource: <{}>\n\nMirror manifest SHA-256: `{}`\n\nVerified files: {}. Extracted documents: {}. Failures: {}.\n\n[Public provenance catalog](google-catalog.json) · [Mirror manifest](manifest.json)\n\n",
        report.source_url,
        report.manifest_sha256,
        report.files_verified,
        report.documents_written,
        report.failures.len()
    );
    for document in &report.entries {
        index.push_str(&format!(
            "- `{}` — [Markdown]({}); source <{}>; HTML SHA-256 `{}`; Markdown SHA-256 `{}`\n",
            document.slug,
            document.markdown_path,
            document.source_url,
            document.sha256,
            document.markdown_sha256
        ));
    }
    for failure in &report.failures {
        // Indented JSON keeps remote error text out of rendered Markdown links.
        let detail = serde_json::to_string(failure)
            .map_err(|cause| error(format!("serialize Google failure: {cause}")))?;
        index.push_str(&format!("\n    {detail}\n"));
    }
    write_file(&root, "AI_READY.md", index.as_bytes())?;
    Ok(report)
}

/// Revalidate both the acquired mirror and its previously generated Markdown.
pub fn verify_google_documents(root: &Path) -> Result<Report, GoogleDesignError> {
    let root = canonical_root(root)?;
    let mirror = verify_mirror(&root)?;
    if public_url(&mirror.source_url)?.host_str() != Some("design.google") {
        return Err(error("Google Design verification requires a design.google mirror"));
    }
    let report: Report = serde_json::from_slice(&read_file(&root, "google-catalog.json")?)
        .map_err(|cause| error(format!("Google catalog: {cause}")))?;
    if report.schema_version != 1
        || report.manifest_sha256 != mirror.manifest_sha256
        || report.source_url != mirror.source_url
        || report.files != mirror.files
        || report.files_verified != mirror.files_verified
        || report.documents_written != report.entries.len()
    {
        return Err(error("Google catalog does not match the verified mirror"));
    }
    let mut seen = BTreeSet::new();
    for document in &report.entries {
        let source = mirror.files.iter().find(|file| {
            file.path == document.raw_path
                && file.source_url == document.source_url
                && file.kind == "html"
                && file.sha256 == document.sha256
        });
        if source.is_none()
            || document.slug != document_slug(&public_url(&document.source_url)?)
            || document.markdown_path != format!("documents/{}.md", document.slug)
            || !seen.insert(document.slug.to_ascii_lowercase())
        {
            return Err(error("Google document provenance or slug does not match its source"));
        }
        let bytes = read_file(&root, &document.markdown_path)?;
        if sha256(&bytes) != document.markdown_sha256 {
            return Err(error(format!("Markdown SHA-256 mismatch: {}", document.markdown_path)));
        }
    }
    read_file(&root, "AI_READY.md")?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "aphrody-google-design-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("clock after epoch")
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).expect("fixture directory");
            Self(path)
        }

        fn manifest(&self, path: &str, html: &[u8]) {
            let manifest = serde_json::json!({
                "schemaVersion": 1, "seedUrl": "https://design.google/",
                "summary": {"requests":1,"pagesWritten":1,"assetsWritten":0,"bytesWritten":html.len()},
                "files": [{"url":"https://design.google/library/color.html", "path":path,
                    "kind":"html", "bytes":html.len(),"blake3":blake3::hash(html).to_hex().to_string(),"title":"Color"}],
                "failures": [{"url":"https://design.google/missing", "error":"HTTP 404"}]
            });
            fs::write(self.0.join("manifest.json"), serde_json::to_vec(&manifest).unwrap())
                .unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const HTML: &[u8] = b"<html><head><title>Color</title></head><body><nav>Navigation</nav><main><h1>Color roles</h1><p>Colors communicate meaning through consistent surface and foreground roles. Each role supports readable content across light and dark themes.</p><p><a href='/library/contrast'>Contrast guidance</a> explains accessible foreground combinations for every surface.</p></main><script>secretScript()</script></body></html>";

    #[test]
    fn exports_real_markdown_and_complete_provenance() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("page.html"), HTML).unwrap();
        fixture.manifest("page.html", HTML);
        let report = export_google_documents(&fixture.0).unwrap();
        assert_eq!(report.documents_written, 1);
        assert_eq!(report.entries[0].slug, "library/color");
        assert_eq!(report.entries[0].sha256, sha256(HTML));
        assert_eq!(report.failures[0].error, "HTTP 404");
        let markdown =
            fs::read_to_string(fixture.0.join(&report.entries[0].markdown_path)).unwrap();
        assert!(markdown.contains("# Color roles"));
        assert!(markdown.contains("https://design.google/library/color.html"));
        assert!(markdown.contains("Colors communicate meaning"));
        assert!(!markdown.contains("secretScript"));
        assert_eq!(report.entries[0].markdown_sha256, sha256(markdown.as_bytes()));
        assert_eq!(verify_google_documents(&fixture.0).unwrap().documents_written, 1);
        assert!(fs::read_to_string(fixture.0.join("AI_READY.md")).unwrap().contains("HTTP 404"));
        let catalog = fs::read(fixture.0.join("google-catalog.json")).unwrap();
        export_google_documents(&fixture.0).unwrap();
        assert_eq!(fs::read(fixture.0.join("google-catalog.json")).unwrap(), catalog);
    }

    #[test]
    fn rejects_corrupted_mirror_and_markdown() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("page.html"), HTML).unwrap();
        fixture.manifest("page.html", HTML);
        let report = export_google_documents(&fixture.0).unwrap();
        fs::write(fixture.0.join(&report.entries[0].markdown_path), "tampered").unwrap();
        assert!(verify_google_documents(&fixture.0).unwrap_err().to_string().contains("SHA-256"));
        let mut changed = HTML.to_vec();
        changed[0] = b'!';
        fs::write(fixture.0.join("page.html"), changed).unwrap();
        assert!(verify_mirror(&fixture.0).unwrap_err().to_string().contains("BLAKE3"));
    }

    #[test]
    fn rejects_path_escapes_on_every_platform() {
        let fixture = Fixture::new();
        for path in [
            "../outside.html",
            "..\\outside.html",
            "/outside.html",
            "C:/outside.html",
            "page.html:stream",
        ] {
            fixture.manifest(path, HTML);
            assert!(
                verify_mirror(&fixture.0).unwrap_err().to_string().contains("unsafe relative path")
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_canonical_symlink_escapes() {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        fs::write(outside.0.join("page.html"), HTML).unwrap();
        std::os::unix::fs::symlink(outside.0.join("page.html"), fixture.0.join("page.html"))
            .unwrap();
        fixture.manifest("page.html", HTML);
        assert!(verify_mirror(&fixture.0).unwrap_err().to_string().contains("escapes mirror root"));
    }

    #[test]
    fn empty_shell_is_a_visible_extraction_failure() {
        let fixture = Fixture::new();
        let html = b"<html><body><script>app()</script></body></html>";
        fs::write(fixture.0.join("page.html"), html).unwrap();
        fixture.manifest("page.html", html);
        let report = export_google_documents(&fixture.0).unwrap();
        assert_eq!(report.documents_written, 0);
        assert_eq!(report.failures.len(), 2);
        assert!(report.failures[1].error.contains("no readable main content"));
    }
}
