// SPDX-License-Identifier: Apache-2.0
//! `aphrody llama` — the local chat model of a desktop application, as a JSON
//! command line.
//!
//! ```text
//! aphrody llama provision --home <dir> [model options]
//! aphrody llama serve     --home <dir> [model options] [launch options] [-- <llama-server args>]
//! aphrody llama router    --home <dir> --config <router.json> [--bind 127.0.0.1:0]
//! aphrody llama status    --home <dir>
//! aphrody llama stop      --home <dir>
//! ```
//!
//! Every line on stdout is one JSON object with an `event` field
//! (`progress`, `provisioned`, `ready`, `status`, `stopped`, `error`), so a
//! Bun or Tauri parent reads it line by line. Diagnostics go to stderr.
//!
//! `serve` stays in the foreground by default: it prints `ready`, keeps the
//! server's lease alive, and stops the server when its standard input closes
//! (the parent exited) or it receives Ctrl-C / SIGTERM. Killed outright, it
//! stops touching the lease and the server idles out after the keep-alive
//! (`--keep-alive`, 120 s in the foreground). `--detach` returns after `ready`
//! and leaves the daemon to its keep-alive (`0` keeps it forever).
//!
//! Exit status: 0 on success, 1 on failure (an `error` line says why), 2 on a
//! usage error.

use std::{
    ffi::OsString,
    future::IntoFuture,
    path::{Path, PathBuf},
    time::Duration,
};

use aphrody_models::Catalog;
use serde_json::{Value, json};

use crate::{
    ArtifactSpec, ChatLaunchOptions, ChatProvisionRequest, DaemonCommand, Health, LoraSpec, Role,
    ServerClient, StateDirs, Supervisor, launch_chat, locate_llama_server, provision_chat,
};

const USAGE: &str = "usage: aphrody llama <provision|serve|router|status|stop> [options]

  provision  make the base model and adapters present (JSON progress lines)
  serve      provision, start one chat server, print `ready` with its OpenAI root
  router     one OpenAI endpoint over several models (--config router.json): llama models with
             LoRA, the Gemini web app, other OpenAI servers; /v1/models lists the available ones
  status     the chat server started by `serve`
  stop       stop it

Locations (one of --home, or both of --models-dir and --state-dir):
  --home <dir>            models in <dir>/models, server state in <dir>/llama
  --models-dir <dir>      model store root
  --state-dir <dir>       server state root (run/, logs/, locks/)

Model (provision, serve):
  --catalog <file>        product catalog (catalog.json schema), searched before the built-in one
  --model <spec>          base model: catalog id or reference (default qwen3-4b-instruct-2507-q4km)
  --model-sha256 <hex>    digest of a raw --model reference
  --lora <spec>           adapter: catalog id or reference (hf:, https://, file:); repeatable
  --lora-sha256 <hex>     digest of the preceding raw --lora reference
  --lora-scale <f>        scale of the preceding --lora (default 1.0)
  --force                 download again even when present

Launch (serve):
  --llama-bin <path>      llama-server binary or directory (else APHRODY_LLAMA_BIN, APHRODY_LLAMA_DIR,
                          llama/ beside this executable, Aphrody runtimes, PATH)
  --ctx <n>  --parallel <n>  --margin-mib <n>  --alias <name>
  --ready-timeout <s>     model load deadline (default 180)
  --keep-alive <s>        idle shutdown (foreground default 120, detached default 900, 0 = never)
  --detach                return after `ready`

Router:
  --config <file>         {\"models\":[{\"backend\":\"llama\"|\"gemini-web\"|\"openai\",\"id\":…}],\"catalog\":…}
  --bind <addr>           listen address (default 127.0.0.1:0, printed in `listening`)
  --llama-bin <path>      as for serve; each llama model keeps its state in <state-dir>/<id>

Foreground (serve, router):
  --parent-pid <pid>      foreground: stop the server once this process is gone
  --exit-on-stdin-eof     foreground: stop the server when stdin closes (spawn with a piped stdin)
  -- <args>               raw llama-server arguments, appended last";

#[derive(Debug, Default)]
struct Args {
    command: String,
    home: Option<PathBuf>,
    models_dir: Option<PathBuf>,
    state_dir: Option<PathBuf>,
    catalog: Option<PathBuf>,
    model: Option<ArtifactSpec>,
    lora: Vec<LoraSpec>,
    force: bool,
    llama_bin: Option<PathBuf>,
    ctx: Option<u32>,
    parallel: Option<u8>,
    margin_mib: Option<u32>,
    alias: Option<String>,
    ready_timeout: Option<u64>,
    keep_alive: Option<u64>,
    detach: bool,
    parent_pid: Option<u32>,
    stdin_eof: bool,
    config: Option<PathBuf>,
    bind: Option<String>,
    extra: Vec<String>,
}

impl Args {
    fn models_dir(&self) -> Option<PathBuf> {
        self.models_dir.clone().or_else(|| self.home.as_ref().map(|home| home.join("models")))
    }

    fn state_dir(&self) -> Option<PathBuf> {
        self.state_dir.clone().or_else(|| self.home.as_ref().map(|home| home.join("llama")))
    }
}

fn parse(mut it: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut args = Args { command: it.next().ok_or("missing command")?, ..Args::default() };
    if !matches!(args.command.as_str(), "provision" | "serve" | "router" | "status" | "stop") {
        return Err(format!("unknown command `{}`", args.command));
    }
    while let Some(flag) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{flag} needs a value"));
        let number = |text: String| text.parse::<u64>().map_err(|_| format!("{flag}: `{text}`"));
        match flag.as_str() {
            "--home" => args.home = Some(value()?.into()),
            "--models-dir" => args.models_dir = Some(value()?.into()),
            "--state-dir" => args.state_dir = Some(value()?.into()),
            "--catalog" => args.catalog = Some(value()?.into()),
            "--model" => {
                args.model = Some(ArtifactSpec {
                    spec: value()?,
                    sha256: args.model.take().and_then(|m| m.sha256),
                });
            },
            "--model-sha256" => {
                let sha = value()?;
                let model = args.model.get_or_insert_with(|| {
                    ArtifactSpec::new(crate::local_chat::DEFAULT_CHAT_MODEL)
                });
                model.sha256 = Some(sha);
            },
            "--lora" => {
                args.lora.push(LoraSpec { artifact: ArtifactSpec::new(value()?), scale: 1.0 })
            },
            "--lora-sha256" => {
                let sha = value()?;
                args.lora
                    .last_mut()
                    .ok_or("--lora-sha256 needs a preceding --lora")?
                    .artifact
                    .sha256 = Some(sha);
            },
            "--lora-scale" => {
                let text = value()?;
                let scale = text.parse::<f32>().map_err(|_| format!("--lora-scale: `{text}`"))?;
                args.lora.last_mut().ok_or("--lora-scale needs a preceding --lora")?.scale = scale;
            },
            "--force" => args.force = true,
            "--llama-bin" => args.llama_bin = Some(value()?.into()),
            "--ctx" => {
                args.ctx = Some(u32::try_from(number(value()?)?).map_err(|e| e.to_string())?)
            },
            "--parallel" => {
                args.parallel = Some(u8::try_from(number(value()?)?).map_err(|e| e.to_string())?);
            },
            "--margin-mib" => {
                args.margin_mib =
                    Some(u32::try_from(number(value()?)?).map_err(|e| e.to_string())?);
            },
            "--alias" => args.alias = Some(value()?),
            "--ready-timeout" => args.ready_timeout = Some(number(value()?)?),
            "--keep-alive" => args.keep_alive = Some(number(value()?)?),
            "--detach" => args.detach = true,
            "--parent-pid" => {
                args.parent_pid =
                    Some(u32::try_from(number(value()?)?).map_err(|e| e.to_string())?);
            },
            "--exit-on-stdin-eof" => args.stdin_eof = true,
            "--config" => args.config = Some(value()?.into()),
            "--bind" => args.bind = Some(value()?),
            "--" => args.extra.extend(it.by_ref()),
            other => return Err(format!("unknown argument `{other}`")),
        }
    }
    if args.state_dir().is_none() {
        return Err("--home (or --state-dir) is required".to_owned());
    }
    if matches!(args.command.as_str(), "provision" | "serve" | "router")
        && args.models_dir().is_none()
    {
        return Err("--home (or --models-dir) is required".to_owned());
    }
    Ok(args)
}

fn emit(value: &Value) {
    println!("{value}");
}

fn fail(message: impl std::fmt::Display) -> i32 {
    emit(&json!({ "event": "error", "message": message.to_string() }));
    1
}

/// The daemon launcher: `aphrody-llama-daemon` beside this executable, else this
/// executable re-invoked as `llama-daemon` (the multi-call subcommand).
fn daemon_command() -> std::io::Result<DaemonCommand> {
    if let Ok(command) = DaemonCommand::sibling_binary() {
        return Ok(command);
    }
    Ok(DaemonCommand { program: std::env::current_exe()?, args: vec!["llama-daemon".to_owned()] })
}

fn exe_dir() -> Vec<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .into_iter()
        .collect()
}

/// Entry point of `aphrody llama` (multi-call; `args[0]` is the invocation name).
#[must_use]
pub fn chat_cli_main(args: Vec<OsString>) -> i32 {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut rest = args.into_iter().skip(1).map(|a| a.to_string_lossy().into_owned()).peekable();
    // A link named after this tool re-invoked by the supervisor as its daemon.
    if rest.peek().map(String::as_str) == Some("llama-daemon") {
        let mut argv = vec![OsString::from("aphrody-llama-daemon")];
        argv.extend(rest.skip(1).map(OsString::from));
        return crate::cli_main(argv);
    }
    if matches!(rest.peek().map(String::as_str), None | Some("-h" | "--help" | "help")) {
        println!("{USAGE}");
        return 0;
    }
    let args = match parse(rest) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("aphrody llama: {message}\n\n{USAGE}");
            return 2;
        },
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => return fail(format!("cannot start the runtime: {error}")),
    };
    runtime.block_on(run(args))
}

async fn run(args: Args) -> i32 {
    let state = args.state_dir().unwrap_or_default();
    match args.command.as_str() {
        "status" => status(&state).await,
        "stop" => stop(&state).await,
        "provision" => match provision(&args).await {
            Ok(_) => 0,
            Err(code) => code,
        },
        "router" => route(&args, &state).await,
        _ => serve(&args, &state).await,
    }
}

async fn provision(args: &Args) -> Result<crate::ProvisionedChat, i32> {
    let declared = match &args.catalog {
        Some(path) => Some(Catalog::load(path).map_err(fail)?),
        None => None,
    };
    let request = ChatProvisionRequest {
        models_dir: args.models_dir(),
        declared,
        model: args.model.clone(),
        lora: args.lora.clone(),
        force: args.force,
    };
    let model = provision_chat(&request, |progress| {
        let mut line = serde_json::to_value(progress).unwrap_or_default();
        line["event"] = json!("progress");
        emit(&line);
    })
    .await
    .map_err(fail)?;
    let mut line = serde_json::to_value(&model).unwrap_or_default();
    line["event"] = json!("provisioned");
    emit(&line);
    Ok(model)
}

async fn serve(args: &Args, state: &Path) -> i32 {
    let Some(binary) = locate_llama_server(args.llama_bin.as_deref(), &exe_dir()) else {
        return fail(
            "llama-server not found (--llama-bin, APHRODY_LLAMA_BIN, llama/ beside aphrody, PATH)",
        );
    };
    let model = match provision(args).await {
        Ok(model) => model,
        Err(code) => return code,
    };
    let daemon = match daemon_command() {
        Ok(daemon) => daemon,
        Err(error) => return fail(format!("no daemon launcher: {error}")),
    };
    let default_keep_alive = if args.detach { crate::DEFAULT_KEEP_ALIVE.as_secs() } else { 120 };
    let keep_alive = args.keep_alive.unwrap_or(default_keep_alive);
    let mut options = ChatLaunchOptions {
        ctx: args.ctx,
        alias: args.alias.clone(),
        extra_args: args.extra.clone(),
        ..ChatLaunchOptions::default()
    };
    if let Some(parallel) = args.parallel {
        options.parallel = parallel;
    }
    if let Some(margin) = args.margin_mib {
        options.margin_mib = margin;
    }
    options.ensure.keep_alive = (keep_alive > 0).then(|| Duration::from_secs(keep_alive));
    if let Some(timeout) = args.ready_timeout {
        options.ensure.ready_timeout = Duration::from_secs(timeout.max(1));
    }
    let chat = match launch_chat(&binary, state, daemon.clone(), &model, &options).await {
        Ok(chat) => chat,
        Err(error) => return fail(error),
    };
    let run = &chat.endpoint.state;
    emit(&json!({
        "event": "ready",
        "base_url": chat.endpoint.base_url(),
        "server_url": run.server_url(),
        "health_url": format!("{}/health", run.server_url()),
        "model": run.alias,
        "port": run.port,
        "attached": chat.endpoint.attached,
        "binary": binary,
        "ctx": chat.plan.spec.ctx,
        "lora": chat.lora,
        "notes": chat.plan.notes,
    }));
    if args.detach {
        return 0;
    }

    let supervisor = Supervisor::new(StateDirs::new(state), daemon);
    let touch_every = Duration::from_secs((keep_alive / 4).clamp(1, 30));
    let mut since_touch = Duration::ZERO;
    let reason = lifeline(args, |poll| {
        if supervisor.status(Role::Chat).is_none() {
            return Some("server exited");
        }
        since_touch += poll;
        if since_touch >= touch_every {
            since_touch = Duration::ZERO;
            let _ = supervisor.touch(Role::Chat);
        }
        None
    })
    .await;
    let stopped = supervisor.stop(Role::Chat).await.unwrap_or(false);
    emit(&json!({ "event": "stopped", "reason": reason, "stopped": stopped }));
    0
}

/// Wait until the foreground process should end: stdin closed (with
/// `--exit-on-stdin-eof`), the `--parent-pid` gone, Ctrl-C / SIGTERM, or `tick`
/// (called every poll period with that period) returning a reason.
async fn lifeline(
    args: &Args,
    mut tick: impl FnMut(Duration) -> Option<&'static str>,
) -> &'static str {
    let (closed_tx, mut stdin_closed) = tokio::sync::oneshot::channel::<()>();
    // Without the flag the sender is held, so the channel never fires.
    let _held = if args.stdin_eof {
        // A plain thread: a blocked stdin read must not hold the runtime's shutdown.
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = std::io::Read::read_to_end(&mut std::io::stdin(), &mut sink);
            let _ = closed_tx.send(());
        });
        None
    } else {
        Some(closed_tx)
    };
    let poll = Duration::from_secs(2);
    let signal = shutdown_signal();
    tokio::pin!(signal);
    loop {
        tokio::select! {
            _ = &mut stdin_closed => return "stdin closed",
            () = &mut signal => return "signal",
            () = tokio::time::sleep(poll) => {
                if args.parent_pid.is_some_and(|pid| !aphrody_proc::process_alive(pid)) {
                    return "parent exited";
                }
                if let Some(reason) = tick(poll) {
                    return reason;
                }
            },
        }
    }
}

async fn route(args: &Args, state: &Path) -> i32 {
    let Some(config_path) = &args.config else {
        return fail("router needs --config <file>");
    };
    let config = match crate::router::RouterConfig::load(config_path) {
        Ok(config) => config,
        Err(error) => return fail(error),
    };
    let daemon = match daemon_command() {
        Ok(daemon) => daemon,
        Err(error) => return fail(format!("no daemon launcher: {error}")),
    };
    let ids: Vec<String> = config.models.iter().map(|m| m.id().to_owned()).collect();
    let context = crate::router::RouterContext {
        models_dir: args.models_dir().unwrap_or_default(),
        state_dir: state.to_path_buf(),
        llama_bin: locate_llama_server(args.llama_bin.as_deref(), &exe_dir()),
        daemon,
    };
    let router = match crate::router::ChatRouter::new(config, context) {
        Ok(router) => router,
        Err(error) => return fail(error),
    };
    let bind = args.bind.clone().unwrap_or_else(|| "127.0.0.1:0".to_owned());
    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(error) => return fail(format!("cannot bind {bind}: {error}")),
    };
    let addr = match listener.local_addr() {
        Ok(addr) => addr,
        Err(error) => return fail(error),
    };
    emit(&json!({
        "event": "listening",
        "url": format!("http://{addr}"),
        "base_url": format!("http://{addr}/v1"),
        "health_url": format!("http://{addr}/health"),
        "models": ids,
    }));
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(
        axum::serve(listener, router.app())
            .with_graceful_shutdown(async move {
                let _ = stop_rx.await;
            })
            .into_future(),
    );
    let reason = lifeline(args, |_| server.is_finished().then_some("server exited")).await;
    let _ = stop_tx.send(());
    let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    router.shutdown().await;
    emit(&json!({ "event": "stopped", "reason": reason, "stopped": true }));
    0
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        if let Ok(mut term) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = term.recv() => {},
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

async fn status(state: &Path) -> i32 {
    let inspector = Supervisor::new(
        StateDirs::new(state),
        DaemonCommand { program: PathBuf::new(), args: Vec::new() },
    );
    let Some(run) = inspector.status(Role::Chat) else {
        emit(&json!({ "event": "status", "running": false }));
        return 0;
    };
    let client = ServerClient::new(run.server_url());
    let health = match client.health().await {
        Health::Ready => json!("ready"),
        Health::Loading => json!("loading"),
        Health::Down(reason) => json!({ "down": reason }),
    };
    let lora = client.lora_adapters().await.unwrap_or_default();
    emit(&json!({
        "event": "status",
        "running": true,
        "ready": run.ready,
        "health": health,
        "base_url": run.base_url(),
        "server_url": run.server_url(),
        "model": run.alias,
        "port": run.port,
        "lora": lora,
    }));
    0
}

async fn stop(state: &Path) -> i32 {
    let supervisor = match daemon_command() {
        Ok(daemon) => Supervisor::new(StateDirs::new(state), daemon),
        Err(error) => return fail(error),
    };
    match supervisor.stop(Role::Chat).await {
        Ok(stopped) => {
            emit(&json!({ "event": "stopped", "reason": "requested", "stopped": stopped }));
            0
        },
        Err(error) => fail(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_str(line: &str) -> Result<Args, String> {
        parse(line.split_whitespace().map(ToOwned::to_owned))
    }

    #[test]
    fn home_derives_both_locations() {
        let args =
            parse_str("serve --home /h --lora file:/a.gguf --lora-sha256 ab --lora-scale 0.5")
                .unwrap();
        assert_eq!(args.models_dir(), Some(PathBuf::from("/h/models")));
        assert_eq!(args.state_dir(), Some(PathBuf::from("/h/llama")));
        assert_eq!(args.lora.len(), 1);
        assert_eq!(args.lora[0].artifact.sha256.as_deref(), Some("ab"));
        assert!((args.lora[0].scale - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn raw_arguments_follow_the_separator() {
        let args = parse_str("serve --home /h --ctx 8192 -- --threads 4").unwrap();
        assert_eq!(args.ctx, Some(8192));
        assert_eq!(args.extra, vec!["--threads", "4"]);
    }

    #[test]
    fn usage_errors() {
        assert!(parse_str("serve").is_err());
        assert!(parse_str("serve --home /h --lora-scale 1").is_err());
        assert!(parse_str("launch --home /h").is_err());
        assert!(parse_str("status --state-dir /s").is_ok());
        assert!(parse_str("provision --state-dir /s").is_err());
    }

    #[test]
    fn model_digest_attaches_to_the_model() {
        let args =
            parse_str("provision --home /h --model-sha256 cd --model hf:o/r/f.gguf@x").unwrap();
        let model = args.model.unwrap();
        assert_eq!(model.spec, "hf:o/r/f.gguf@x");
        assert_eq!(model.sha256.as_deref(), Some("cd"));
    }
}
