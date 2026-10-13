// SPDX-License-Identifier: Apache-2.0
//! Catalog-bound activation of verified standalone Bun application artifacts.

use crate::catalog::{CatalogService, load_service_catalog};
use crate::layout::HostLayout;
use crate::nginx::{LocationBlock, NginxConfig};
use crate::secrets::{redaction::SecretString, systemd};
use anyhow::{Context, Result, bail, ensure};
use aphrody_proc::{FileLock, LockKind, NoWindow as _, SpawnOptions, spawn_group};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::rand::{SecureRandom as _, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const MAX_METADATA: u64 = 2 * 1024 * 1024;
const UNIT_TEMPLATE: &str = "tools/config/host/systemd/aphrody/aphrody-app@.service";
const ROUTE_MODEL: &str = "tools/config/host/nginx/aphrody/control.aphrody.app.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedApp {
    pub schema_version: u32,
    pub identity: String,
    pub app_id: String,
    pub library_id: String,
    pub hostname: String,
    pub target: String,
    pub binary: PathBuf,
    pub sha256: String,
    pub size: u64,
    pub manifest_path: PathBuf,
    pub manifest_sha256: String,
    pub source_revision: String,
    pub runtime: Value,
    pub shared_assets: Option<Value>,
    pub qualification: String,
}

#[derive(Debug)]
pub struct AppDeployOptions<'a> {
    pub target: &'a str,
    pub id: &'a str,
    pub source: &'a Path,
    pub build_report: &'a Path,
    pub bun: &'a str,
    /// Explicitly execute on the target host; SSH selection never implies local execution.
    pub local: bool,
    pub apply: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDeployPlan {
    pub id: String,
    pub target: String,
    pub app_id: String,
    pub hostname: String,
    pub port: u16,
    pub binary: PathBuf,
    pub unit: String,
    pub environment_file: PathBuf,
    pub artifact: VerifiedApp,
    pub applied: bool,
}

fn plain(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

fn text(path: &Path) -> Result<String> {
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "Expected a regular deployment metadata file"
    );
    ensure!(metadata.len() <= MAX_METADATA, "Deployment metadata exceeds its size limit");
    fs::read_to_string(path).context("Cannot read deployment metadata")
}

/// The native process library owns the group; target commands carry an external deadline.
fn execute(program: &str, args: &[String], cwd: &Path, seconds: u32) -> Result<String> {
    ensure!(
        cfg!(target_os = "linux"),
        "Application activation requires its qualified Linux execution host"
    );
    let mut command = Command::new("timeout");
    command.no_window().args(["--kill-after=5s", &format!("{seconds}s"), program]);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child =
        spawn_group(&mut command, SpawnOptions { hide_window: true, ..SpawnOptions::default() })?;
    let mut output = Vec::new();
    if let Some(stdout) = child.take_stdout() {
        stdout.take(MAX_METADATA + 1).read_to_end(&mut output)?;
    }
    if output.len() as u64 > MAX_METADATA {
        child.kill_tree()?;
        bail!("Deployment command exceeded its output limit");
    }
    ensure!(child.wait()?.success(), "Deployment command failed: {program}");
    String::from_utf8(output).context("Deployment command returned invalid UTF-8")
}

fn verify(
    options: &AppDeployOptions<'_>,
    app_id: &str,
    overrides: Option<(&Path, &Path)>,
) -> Result<VerifiedApp> {
    let mut args = vec![
        "--no-env-file".into(),
        options.source.join("packages/artifacts/src/cli.ts").to_string_lossy().into_owned(),
        "verify".into(),
        "--build-report".into(),
        options.build_report.to_string_lossy().into_owned(),
        "--app".into(),
        app_id.into(),
    ];
    if let Some((binary, manifest)) = overrides {
        args.extend([
            "--binary".into(),
            binary.to_string_lossy().into_owned(),
            "--manifest".into(),
            manifest.to_string_lossy().into_owned(),
        ]);
    }
    let receipt: VerifiedApp =
        serde_json::from_str(&execute(options.bun, &args, options.source, 240)?)
            .context("The artifact owner returned an invalid verification receipt")?;
    ensure!(
        receipt.schema_version == 1 && receipt.identity == "Aphrody / Bun",
        "Invalid artifact verification identity"
    );
    ensure!(
        receipt.qualification == "native-doctor" && receipt.app_id == app_id,
        "Native artifact qualification is required"
    );
    Ok(receipt)
}

fn service<'a>(
    services: &'a [CatalogService],
    options: &AppDeployOptions<'_>,
) -> Result<&'a CatalogService> {
    let service =
        services.iter().find(|entry| entry.id == options.id).context("Unknown catalog service")?;
    ensure!(
        service.kind == "native-application" && service.runtime == "rust-bun",
        "The catalog service is not a native Bun application"
    );
    ensure!(
        !service.is_retired() && service.host.as_deref() == Some(options.target),
        "The service is not declared for this target"
    );
    ensure!(service.container.is_none(), "The application has a different lifecycle owner");
    Ok(service)
}

fn atomic_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_extension(format!("{}.stage", std::process::id()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    ensure!(
        !fs::symlink_metadata(path)?.file_type().is_symlink(),
        "Private application directories must be real directories"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn environment(path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        ensure!(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_METADATA,
            "The application environment must be a bounded regular protected file"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            ensure!(
                metadata.permissions().mode() & 0o077 == 0,
                "The application environment is not private"
            );
        }
        let values = systemd::parse_env_file(path)?;
        ensure!(
            values.get("APHRODY_APP_TOKEN").is_some_and(|value| value.len() >= 32),
            "The application token is unavailable"
        );
        return Ok(());
    }
    private_directory(path.parent().context("Environment parent missing")?)?;
    let mut bytes = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("Cannot generate an application token"))?;
    let secrets = BTreeMap::from([(
        "APHRODY_APP_TOKEN".into(),
        SecretString::new(URL_SAFE_NO_PAD.encode(bytes)),
    )]);
    systemd::render_env_file(&secrets, path, true)?;
    Ok(())
}

fn render_unit(
    root: &Path,
    layout: &HostLayout,
    app: &str,
    user: &str,
    port: u16,
) -> Result<String> {
    ensure!(plain(app) && plain(user), "Invalid application service identity");
    let replacements = [
        ("{user}", user.to_owned()),
        ("{app_root}", format!("{}/bun-libraries/{app}", layout.apps)),
        ("{state_root}", layout.state.clone()),
        ("{port}", port.to_string()),
    ];
    let mut unit = text(&root.join(UNIT_TEMPLATE))?;
    for (key, value) in replacements {
        ensure!(!value.contains(['\n', '\r', '%', '"']), "Invalid application service path");
        unit = unit.replace(key, &value);
    }
    Ok(unit)
}

fn nginx_candidate(rendered: &str) -> Result<String> {
    let main = text(Path::new("/etc/nginx/nginx.conf"))?;
    let marker = "include /etc/nginx/sites-enabled/*;";
    ensure!(
        main.matches(marker).count() == 1,
        "The declared Nginx site include cannot be resolved"
    );
    let mut includes = String::new();
    for entry in fs::read_dir("/etc/nginx/sites-enabled")? {
        let entry = entry?;
        if entry.file_name() == "control.aphrody.app.conf" {
            continue;
        }
        let path = entry.path();
        let path = path.to_str().context("Invalid native Nginx include path")?;
        ensure!(!path.contains(['\n', '\r', '"']), "Invalid native Nginx include path");
        includes.push_str(&format!("include \"{path}\";\n"));
    }
    includes.push_str(rendered);
    Ok(main.replace(marker, &includes))
}

fn sudo(root: &Path, program: &str, args: &[String]) -> Result<String> {
    let mut owned = vec!["-n".into(), program.into()];
    owned.extend_from_slice(args);
    execute("sudo", &owned, root, 60)
}

fn route(root: &Path, hostname: &str, port: u16) -> Result<(NginxConfig, String)> {
    let mut model: NginxConfig = serde_json::from_str(&text(&root.join(ROUTE_MODEL))?)?;
    let index = model
        .servers
        .iter()
        .position(|server| {
            server.ssl_certificate.is_some()
                && server.server_names.iter().any(|name| name == hostname)
        })
        .context("Application ingress is not declared")?;
    let mut app = model.servers[index].clone();
    app.server_names = vec![hostname.into()];
    model.servers[index].server_names.retain(|name| name != hostname);
    if model.servers[index].server_names.is_empty() {
        model.servers.remove(index);
    }
    app.locations.retain(|location| location.path != "/");
    let mut proxy = LocationBlock::new("/").with_proxy(&format!("127.0.0.1:{port}"));
    proxy.custom_directives.extend([
        "proxy_connect_timeout 5s".into(),
        "proxy_read_timeout 300s".into(),
        "proxy_send_timeout 300s".into(),
        "proxy_buffering off".into(),
    ]);
    app.locations.push(proxy);
    model.servers.push(app);
    let rendered = model.render();
    Ok((model, rendered))
}

fn activate_catalog(
    root: &Path,
    plan: &AppDeployPlan,
    model: &NginxConfig,
    rendered: &str,
) -> Result<()> {
    let catalog_path = root.join("tools/config/service-catalog.json");
    let mut catalog: Value = serde_json::from_str(&text(&catalog_path)?)?;
    let selected = catalog["services"]
        .as_array_mut()
        .context("Invalid canonical service catalog")?
        .iter_mut()
        .find(|service| service["id"] == plan.id)
        .context("Catalog entry disappeared")?;
    selected["unit"] = json!(plan.unit);
    selected["workingDirectory"] = json!(plan.binary.parent());
    selected["health"] = json!(format!("http://127.0.0.1:{}/healthz", plan.port));
    selected["staged"] = json!(false);
    selected["required"] = json!(true);
    selected["note"] = json!(format!(
        "Verified standalone artifact {}; activation owned by Aphrody Infra.",
        plan.artifact.sha256
    ));
    let routes_path = root.join("tools/config/host/nginx/routes.json");
    let mut routes: Value = serde_json::from_str(&text(&routes_path)?)?;
    let views = routes["routes"].as_array_mut().context("Invalid canonical ingress views")?;
    let selected = views
        .iter_mut()
        .find(|view| view["host"] == plan.hostname && view["service"] == plan.id)
        .context("Application ingress view is not declared")?;
    selected["upstream"] = json!(format!("127.0.0.1:{}", plan.port));
    selected["probePath"] = json!("/healthz");
    atomic_file(&catalog_path, &serde_json::to_vec_pretty(&catalog)?)?;
    atomic_file(&routes_path, &serde_json::to_vec_pretty(&routes)?)?;
    atomic_file(&root.join(ROUTE_MODEL), &serde_json::to_vec_pretty(model)?)?;
    atomic_file(
        &root.join("tools/config/host/nginx/aphrody/control.aphrody.app.conf"),
        rendered.as_bytes(),
    )?;
    Ok(())
}

/// Artifact validation stays with its existing Bun owner; Infra owns catalog and host activation.
pub fn deploy_app(root: &Path, options: &AppDeployOptions<'_>) -> Result<AppDeployPlan> {
    ensure!(options.local, "Execute application activation on its explicit target with --local");
    ensure!(plain(options.id) && plain(options.target), "Invalid catalog or target identity");
    ensure!(
        options.source.is_absolute() && options.build_report.is_absolute(),
        "Select absolute artifact source and build report paths"
    );
    let catalog = load_service_catalog(root)?;
    let declared = service(&catalog.services, options)?;
    let app = declared
        .capabilities
        .as_deref()
        .and_then(|values| (values.len() == 1).then(|| values[0].as_str()))
        .context("The application must declare one canonical capability")?;
    let artifact = verify(options, app, None)?;
    ensure!(
        declared.provides(&artifact.app_id),
        "The artifact does not provide the catalog capability"
    );
    let port = declared.effective_port().context("The application listener is not declared")?;
    let policy = text(&root.join("tools/config/host/host-policy.toml"))?;
    let layout = HostLayout::parse(&policy, None)?;
    let home = std::env::var("HOME").context("The target home is unavailable")?;
    ensure!(
        home == layout.home,
        "The current execution home differs from its declared host layout"
    );
    let user = std::env::var("USER").context("The target service user is unavailable")?;
    ensure!(plain(&user), "Invalid target service user");
    let app_root = PathBuf::from(&layout.apps).join("bun-libraries").join(app);
    let unit = format!("aphrody-app@{app}.service");
    let environment_file =
        PathBuf::from(&layout.state).join("secrets/apps").join(format!("{app}.env"));
    let mut plan = AppDeployPlan {
        id: options.id.into(),
        target: options.target.into(),
        app_id: app.into(),
        hostname: artifact.hostname.clone(),
        port,
        binary: app_root.join("app"),
        unit,
        environment_file,
        artifact,
        applied: false,
    };
    let (model, rendered) = route(root, &plan.hostname, port)?;
    let unit_text = render_unit(root, &layout, app, &user, port)?;
    if !options.apply {
        return Ok(plan);
    }
    let lock_path = PathBuf::from(&layout.build).join("locks/app-activation.lock");
    let _lock = FileLock::try_acquire(&lock_path, LockKind::Exclusive)?
        .context("Another Infra app activation owns this host")?;
    private_directory(&app_root)?;
    private_directory(&PathBuf::from(&layout.state).join("apps").join(app).join("data"))?;
    private_directory(&PathBuf::from(&layout.state).join("cache/apps").join(app))?;
    environment(&plan.environment_file)?;
    let stage = app_root.join(format!("app.{}.stage", std::process::id()));
    let stage_manifest = app_root.join(format!("app.{}.manifest.stage", std::process::id()));
    ensure!(
        !stage.exists() && !stage_manifest.exists(),
        "An owned application stage already exists"
    );
    let applied = (|| -> Result<()> {
        fs::copy(&plan.artifact.binary, &stage)?;
        fs::copy(&plan.artifact.manifest_path, &stage_manifest)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            fs::set_permissions(&stage, fs::Permissions::from_mode(0o755))?;
        }
        let staged = verify(options, app, Some((&stage, &stage_manifest)))?;
        ensure!(
            staged.sha256 == plan.artifact.sha256
                && staged.manifest_sha256 == plan.artifact.manifest_sha256,
            "The staged application differs from its verified artifact"
        );
        fs::rename(&stage, &plan.binary)?;
        fs::rename(&stage_manifest, app_root.join("app.manifest.json"))?;
        let staged_unit = app_root.join(&plan.unit);
        atomic_file(&staged_unit, unit_text.as_bytes())?;
        sudo(
            root,
            "systemd-analyze",
            &["verify".into(), staged_unit.to_string_lossy().into_owned()],
        )?;
        sudo(
            root,
            "install",
            &[
                "-m".into(),
                "0644".into(),
                staged_unit.to_string_lossy().into_owned(),
                format!("/etc/systemd/system/{}", plan.unit),
            ],
        )?;
        fs::remove_file(&staged_unit)?;
        sudo(root, "systemctl", &["daemon-reload".into()])?;
        sudo(root, "systemctl", &["restart".into(), plan.unit.clone()])?;
        let health = crate::probe::probe_url(
            &format!("http://127.0.0.1:{port}/healthz"),
            Duration::from_secs(15),
        );
        if !health.ok {
            let _ = sudo(root, "systemctl", &["stop".into(), plan.unit.clone()]);
            bail!("The activated application did not qualify its loopback health endpoint");
        }
        let candidate = app_root.join("ingress.stage");
        atomic_file(&candidate, rendered.as_bytes())?;
        let full_candidate = app_root.join("nginx.stage.conf");
        atomic_file(&full_candidate, nginx_candidate(&rendered)?.as_bytes())?;
        sudo(
            root,
            "nginx",
            &[
                "-t".into(),
                "-p".into(),
                "/etc/nginx/".into(),
                "-c".into(),
                full_candidate.to_string_lossy().into_owned(),
            ],
        )?;
        sudo(
            root,
            "install",
            &[
                "-m".into(),
                "0644".into(),
                candidate.to_string_lossy().into_owned(),
                "/etc/nginx/sites-available/control.aphrody.app.conf".into(),
            ],
        )?;
        sudo(root, "nginx", &["-t".into()])?;
        sudo(root, "systemctl", &["reload".into(), "nginx".into()])?;
        fs::remove_file(&candidate)?;
        fs::remove_file(&full_candidate)?;
        sudo(root, "systemctl", &["enable".into(), plan.unit.clone()])?;
        activate_catalog(root, &plan, &model, &rendered)?;
        plan.applied = true;
        Ok(())
    })();
    let _ = fs::remove_file(&stage);
    let _ = fs::remove_file(&stage_manifest);
    applied?;
    Ok(plan)
}
