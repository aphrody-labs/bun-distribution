// SPDX-License-Identifier: Apache-2.0
//! Google reference acquisition and M3 generation through the existing native owners.

use aphrody_proc::NoWindow as _;
use aphrody_rag::home::{HomeLayout, HomeScope};
use clap::Args;
use miette::{IntoDiagnostic, miette};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

async fn upstream_releases(
    client: &obscura_net::BunBrowserHttpClient,
    output: &Path,
) -> miette::Result<Value> {
    use sha2::{Digest, Sha256};
    let directory = output.join("upstreams");
    std::fs::create_dir_all(&directory).into_diagnostic()?;
    let mut records = Vec::new();
    for (name, source) in [
        (
            "angular-material-latest.json",
            "https://registry.npmjs.org/@angular/material/latest",
        ),
        (
            "android-compose-material3.xml",
            "https://dl.google.com/dl/android/maven2/androidx/compose/material3/material3/maven-metadata.xml",
        ),
        (
            "android-material.xml",
            "https://dl.google.com/dl/android/maven2/com/google/android/material/material/maven-metadata.xml",
        ),
    ] {
        let url = reqwest::Url::parse(source).into_diagnostic()?;
        let response = client
            .fetch_resource_with_callbacks(
                &url,
                obscura_net::ResourceRequest::navigation()
                    .with_max_response_bytes(16 * 1024 * 1024),
                None,
            )
            .await
            .into_diagnostic()?;
        if !(200..300).contains(&response.status) {
            return Err(miette!(
                "official release metadata {source}: HTTP {}",
                response.status
            ));
        }
        std::fs::write(directory.join(name), &response.body).into_diagnostic()?;
        let digest: String = Sha256::digest(&response.body)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let version = if name.ends_with(".json") {
            serde_json::from_slice::<Value>(&response.body)
                .ok()
                .and_then(|value| {
                    value
                        .get("version")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
        } else {
            let text = response.text();
            text.split("<release>")
                .nth(1)
                .and_then(|value| value.split("</release>").next())
                .map(str::to_owned)
        };
        records.push(json!({"url":source,"path":format!("upstreams/{name}"),"sha256":digest,"latestPublished":version}));
    }
    let records = json!(records);
    write_json(&output.join("upstream-releases.json"), &records)?;
    Ok(records)
}

#[derive(Debug, Args)]
pub(crate) struct DesignSyncArgs {
    /// Selected Aphrody checkout containing Cargo.toml and m3/packages
    #[arg(long, default_value = ".")]
    workspace: PathBuf,
    /// Isolated retrieval profile
    #[arg(long, default_value = "aphrody")]
    profile: String,
    /// Explicit Aphrody state root
    #[arg(long)]
    state: Option<PathBuf>,
    /// Validate and reuse an already acquired corpus instead of downloading it again
    #[arg(long)]
    reuse_corpus: bool,
    /// Reuse a checksum-verified Google Design mirror while refreshing Material
    #[arg(long, conflicts_with = "reuse_corpus")]
    reuse_google: bool,
    /// Generate only the native token artifacts, without acquisition or package changes
    #[arg(long, conflicts_with = "apply")]
    tokens_only: bool,
    /// Apply package updates, lint fixes and regenerate the canonical app and OS themes
    #[arg(long)]
    apply: bool,
    /// Maximum Google Design pages and Material content documents
    #[arg(long, default_value_t = 5000, value_parser = clap::value_parser!(u32).range(1..=10000))]
    max_pages: u32,
    /// Maximum additional mirrored public assets
    #[arg(long, default_value_t = 20000, value_parser = clap::value_parser!(u32).range(0..=20000))]
    max_assets: u32,
    /// Concurrent native HTTP requests
    #[arg(long, default_value_t = 8, value_parser = clap::value_parser!(u32).range(1..=32))]
    concurrency: u32,
}

fn output_directory(workspace: &Path) -> miette::Result<PathBuf> {
    let mut directory = workspace.to_path_buf();
    for component in ["var", "mirrors", "design-sync"] {
        directory.push(component);
        if directory.exists() {
            let canonical = directory.canonicalize().into_diagnostic()?;
            if !canonical.starts_with(workspace) {
                return Err(miette!(
                    "design corpus directory escapes the selected workspace"
                ));
            }
        } else {
            std::fs::create_dir(&directory).into_diagnostic()?;
        }
    }
    Ok(directory)
}

fn write_json(path: &Path, value: &impl serde::Serialize) -> miette::Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value).into_diagnostic()?;
    bytes.push(b'\n');
    std::fs::write(path, bytes).into_diagnostic()
}

fn verify_material(root: &Path, report: &Value) -> miette::Result<()> {
    use sha2::{Digest, Sha256};
    let root = root.canonicalize().into_diagnostic()?;
    let entries = report
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| miette!("Material corpus has no source entries"))?;
    if entries.is_empty() {
        return Err(miette!("Material corpus has no acquired documents"));
    }
    let sources = report
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| miette!("Material corpus has no bootstrap provenance"))?;
    let mut records = Vec::new();
    for source in sources {
        records.push((source.get("path"), source.get("sha256")));
    }
    for entry in entries {
        records.push((entry.get("raw_path"), entry.get("sha256")));
        records.push((entry.get("markdown_path"), entry.get("markdown_sha256")));
    }
    for (path, digest) in records {
        let relative = path
            .and_then(Value::as_str)
            .ok_or_else(|| miette!("Material source entry has no relative path"))?;
        let expected = digest
            .and_then(Value::as_str)
            .ok_or_else(|| miette!("Material source entry has no SHA256"))?;
        let target = root.join(relative).canonicalize().into_diagnostic()?;
        if !target.starts_with(&root) || !target.is_file() {
            return Err(miette!("Material source path escapes its corpus"));
        }
        let bytes = std::fs::read(&target).into_diagnostic()?;
        let actual: String = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        if actual != expected {
            return Err(miette!("Material source checksum mismatch: {relative}"));
        }
    }
    Ok(())
}

fn package_commands(output: &Path) -> Vec<Vec<String>> {
    let native = output.join("tokens.json").to_string_lossy().into_owned();
    let high = output
        .join("tokens-high-contrast.json")
        .to_string_lossy()
        .into_owned();
    let cli = "m3/packages/m3/src/cli.ts";
    vec![
        vec![cli.into(), "update".into(), "--apply".into()],
        vec![cli.into(), "security".into(), "--json".into()],
        vec![cli.into(), "lint".into(), "--fix".into()],
        vec![
            "m3/packages/app-ui/scripts/brand-theme.ts".into(),
            "--native-theme".into(),
            native.clone(),
            "--high-contrast-theme".into(),
            high.clone(),
        ],
        vec![
            "m3/packages/m3-os-themes/src/cli.ts".into(),
            "generate".into(),
            "--target".into(),
            "all".into(),
            "--native-theme".into(),
            native,
            "--out".into(),
            output.join("os-themes").to_string_lossy().into_owned(),
        ],
        vec![
            "m3/packages/m3-os-themes/src/cli.ts".into(),
            "generate".into(),
            "--target".into(),
            "all".into(),
            "--native-theme".into(),
            high,
            "--out".into(),
            output
                .join("os-themes-high-contrast")
                .to_string_lossy()
                .into_owned(),
        ],
        vec![cli.into(), "check".into()],
    ]
}

async fn apply_packages(workspace: &Path, output: &Path) -> miette::Result<Vec<Value>> {
    let mut steps = Vec::new();
    for arguments in package_commands(output) {
        let mut child =
            tokio::process::Command::new(if cfg!(windows) { "bun.exe" } else { "bun" }).no_window();
        child
            .args(&arguments)
            .current_dir(workspace)
            .kill_on_drop(true);
        let result = tokio::time::timeout(Duration::from_secs(900), child.output()).await;
        let (ok, code, detail) = match result {
            Ok(Ok(result)) => (
                result.status.success(),
                result.status.code(),
                format!(
                    "{}{}",
                    String::from_utf8_lossy(&result.stdout),
                    String::from_utf8_lossy(&result.stderr)
                ),
            ),
            Ok(Err(error)) => (false, None, error.to_string()),
            Err(_) => (
                false,
                None,
                "M3 step exceeded its 900 second deadline".to_owned(),
            ),
        };
        steps.push(json!({"arguments": arguments, "ok": ok, "exitCode": code, "detail": detail}));
        write_json(&output.join("package-gates.json"), &steps)?;
        if !ok {
            return Err(miette!(
                "M3 apply step failed; see {}",
                output.join("package-gates.json").display()
            ));
        }
    }
    Ok(steps)
}

pub(super) async fn run(args: DesignSyncArgs) -> miette::Result<Value> {
    let workspace = args.workspace.canonicalize().into_diagnostic()?;
    if !workspace.join("Cargo.toml").is_file()
        || !workspace.join("m3/packages/m3/package.json").is_file()
    {
        return Err(miette!("--workspace must select an Aphrody checkout"));
    }
    let output = output_directory(&workspace)?;
    let request = aphrody_m3_tokens::theme::ThemeRequest::parse(
        Some(aphrody_identity::design::pet_seed_hex()),
        Some("tonal-spot"),
        Some(0.0),
    )
    .map_err(|error| miette!("native M3 theme: {error}"))?;
    write_json(&output.join("tokens.json"), &request.export())?;
    write_json(
        &output.join("tokens-high-contrast.json"),
        &request.high_contrast().export(),
    )?;
    std::fs::write(output.join("tokens.css"), request.css()).into_diagnostic()?;
    std::fs::write(
        output.join("tokens-high-contrast.css"),
        request.high_contrast().css(),
    )
    .into_diagnostic()?;
    write_json(
        &output.join("design-tokens.json"),
        &aphrody_m3_tokens::theme::export_token_tables(),
    )?;
    if args.tokens_only {
        return Ok(
            json!({"tokens":output.join("tokens.json"),"highContrast":output.join("tokens-high-contrast.json"),"styleTokens":output.join("design-tokens.json"),"seed":aphrody_identity::design::pet_seed_hex(),"rolesPerMode":49,"colorSpec":"2021"}),
        );
    }
    let material_root = output.join("material-3");
    let client = obscura_net::BunBrowserHttpClient::new();
    let releases = upstream_releases(&client, &output).await?;
    let (material, google) = if args.reuse_corpus {
        let material: Value = serde_json::from_slice(
            &std::fs::read(material_root.join("material-catalog.json")).into_diagnostic()?,
        )
        .into_diagnostic()?;
        let google: Value = serde_json::from_slice(
            &std::fs::read(output.join("google-design/manifest.json")).into_diagnostic()?,
        )
        .into_diagnostic()?;
        verify_material(&material_root, &material)?;
        aphrody_web_crawl::design_google::verify_mirror(&output.join("google-design"))
            .map_err(|error| miette!("Google mirror verification failed: {error}"))?;
        if !material_root.join("AI_READY.md").is_file() || !material_root.join("documents").is_dir()
        {
            return Err(miette!(
                "incomplete Material reference corpus; run acquisition first"
            ));
        }
        (material, google)
    } else {
        let material = aphrody_web_crawl::design::sync_material(
            &client,
            &material_root,
            args.max_pages.min(2000) as usize,
            args.concurrency as usize,
        )
        .await
        .map_err(|error| miette!("Material acquisition failed: {error}"))?;
        let google = if args.reuse_google {
            aphrody_web_crawl::design_google::verify_mirror(&output.join("google-design"))
                .map_err(|error| miette!("Google mirror verification failed: {error}"))?;
            serde_json::from_slice::<Value>(
                &std::fs::read(output.join("google-design/manifest.json")).into_diagnostic()?,
            )
            .into_diagnostic()?
        } else {
            let mut options = aphrody_web_crawl::MirrorOptions::new(
                reqwest::Url::parse("https://design.google/").into_diagnostic()?,
                output.join("google-design"),
            );
            options.max_pages = args.max_pages as usize;
            options.max_assets = args.max_assets as usize;
            options.max_depth = 10;
            options.max_concurrency = args.concurrency as usize;
            options.request_delay = Duration::from_millis(250);
            let google = aphrody_web_crawl::mirror_site(&client, &options)
                .await
                .map_err(|error| miette!("Google Design mirror failed: {error}"))?;
            json!({"pages":google.pages_written,"assets":google.assets_written,"bytes":google.bytes_written,"failures":google.failures.len()})
        };
        // The content API supplies images and media invisible in the site's SPA shell.
        let mut options = aphrody_web_crawl::MirrorOptions::new(
            reqwest::Url::parse("https://m3.material.io/").into_diagnostic()?,
            material_root.clone(),
        );
        options.max_pages = args.max_pages as usize;
        options.max_assets = args.max_assets as usize;
        options.max_depth = 10;
        options.max_concurrency = args.concurrency as usize;
        options.request_delay = Duration::from_millis(250);
        options.additional_assets = material.assets.clone();
        let asset_mirror = aphrody_web_crawl::mirror_site(&client, &options)
            .await
            .map_err(|error| miette!("Material asset mirror failed: {error}"))?;
        write_json(
            &output.join("material-mirror.json"),
            &json!({"pages":asset_mirror.pages_written,"assets":asset_mirror.assets_written,"bytes":asset_mirror.bytes_written,"failures":asset_mirror.failures.iter().map(|failure|json!({"url":failure.url,"error":failure.error})).collect::<Vec<_>>()}),
        )?;
        (serde_json::to_value(material).into_diagnostic()?, google)
    };
    let google_documents =
        aphrody_web_crawl::design_google::export_google_documents(&output.join("google-design"))
            .map_err(|error| miette!("Google document export failed: {error}"))?;
    let scope = HomeScope::from_profile(Some(&args.profile));
    let layout = match args.state {
        Some(ref state) => HomeLayout::in_state(state, &scope),
        None => HomeLayout::resolve(&scope),
    }
    .into_diagnostic()?;
    let index = aphrody_rag::pipeline::run_pipeline(
        &layout,
        "google-material-3",
        &material_root.join("documents"),
    )
    .await
    .into_diagnostic()?;
    let google_index = aphrody_rag::pipeline::run_pipeline(
        &layout,
        "google-design",
        &output.join("google-design/documents"),
    )
    .await
    .into_diagnostic()?;
    let report = json!({"schemaVersion":1,"source":"aphrody-web","corpus":output,"profile":args.profile,"material":material,"googleDesign":google,"googleDocuments":google_documents,"upstreamReleases":releases,"tokens":{"standard":"tokens.json","highContrast":"tokens-high-contrast.json","seed":aphrody_identity::design::pet_seed_hex(),"colorSpec":"2021","rolesPerMode":49},"index":index,"googleIndex":google_index,"applied":false});
    write_json(&output.join("design-sync.json"), &report)?;
    std::fs::write(output.join("AI_READY.md"), "# Google Design and Material 3 reference exports\n\nNative acquisition: `aphrody web design-sync`.\n\n- [Complete Material reference index](material-3/AI_READY.md)\n- [Material specs and source provenance](material-3/material-catalog.json)\n- [Material assets and full CDN URLs](material-3/assets.json)\n- [Google Design mirror and full source URLs](google-design/manifest.json)\n- [Native light/dark tokens](tokens.json)\n- [Native high contrast tokens](tokens-high-contrast.json)\n- [Acquisition and indexing receipt](design-sync.json)\n\nThe token engine exports MCU's default 2021 color specification. Newer opt-in color specifications and full Rust component/rendering parity remain unqualified. Mirror failures and limits remain explicit in the receipts.\n").into_diagnostic()?;
    if args.apply {
        let steps = apply_packages(&workspace, &output).await?;
        let mut report = report;
        report["applied"] = json!(true);
        report["packageGates"] = json!(steps);
        write_json(&output.join("design-sync.json"), &report)?;
        return Ok(report);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generation_never_installs_or_applies_os_settings() {
        let commands = package_commands(Path::new("corpus"));
        assert!(
            commands
                .iter()
                .flatten()
                .all(|argument| argument != "install")
        );
        assert_eq!(
            commands
                .iter()
                .filter(|arguments| arguments.get(1).is_some_and(|value| value == "generate"))
                .count(),
            2
        );
        assert!(
            commands
                .iter()
                .any(|arguments| arguments.contains(&"--high-contrast-theme".to_owned()))
        );
    }

    #[test]
    fn material_reuse_rejects_missing_or_corrupt_provenance() {
        assert!(verify_material(Path::new("."), &json!({"entries":[],"sources":[]})).is_err());
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("spec.json"), "{}").unwrap();
        std::fs::write(directory.path().join("index.md"), "# Changed").unwrap();
        let report = json!({"sources":[],"entries":[{"raw_path":"spec.json","sha256":"wrong","markdown_path":"index.md","markdown_sha256":"wrong"}]});
        assert!(verify_material(directory.path(), &report).is_err());
    }
}
