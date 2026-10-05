#![allow(linker_messages)] // MSVC import-library progress is not a compiler diagnostic.

//! Aphrody Web engine: CDP server, fetch, scrape and crawl on Obscura.
//!
//! The former `aphrody-web` and `aphrody-web-worker` binaries are now the [`cli_main`] and
//! [`worker_main`] entry points of this library, reached through the `aphrody` multi-call
//! binary (invocation name `aphrody-web` / `aphrody-web-worker`).

use std::{ffi::OsString, sync::Arc, time::Instant};

mod crawl;
mod worker;

pub use worker::worker_main;

use aphrody_web_service::{
    extract_main, html_to_markdown, normalize_v8_flags, page_artifact, validate_page_url,
    validate_render_proxy,
};
use clap::{Parser, Subcommand};
use obscura_browser::{BrowserContext, Page};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command as TokioCommand,
    time::{Duration, timeout},
};

#[derive(Parser)]
#[command(
    name = "aphrody-web",
    version = env!("CARGO_PKG_VERSION"),
    about = "Aphrody Web - navigateur headless pour collecte et automatisation web",
)]
struct Args {
    #[arg(short, long, global = true)]
    verbose: bool,

    #[command(subcommand)]
    command: Option<Command>,

    #[arg(short, long, default_value_t = 9222)]
    port: u16,

    #[arg(long, global = true)]
    proxy: Option<String>,

    #[arg(long)]
    obey_robots: bool,

    #[arg(long)]
    user_agent: Option<String>,

    /// Pass raw flags to V8, in the same form V8/Chromium/Node accept
    /// (e.g. `"--max-old-space-size=4096 --max-semi-space-size=64 --expose-gc"`).
    /// Applied once at startup before any isolate is created.
    #[arg(long, value_name = "FLAGS", allow_hyphen_values = true)]
    v8_flags: Option<String>,
}

#[derive(Subcommand)]
enum Command {
    #[command(alias = "serve")]
    Launch {
        chrome_path: Option<std::path::PathBuf>,

        #[arg(short, long, default_value_t = 9222)]
        port: u16,

        // Bind address. Defaults to 127.0.0.1 (loopback only) for safety.
        // Set to 0.0.0.0 to listen on all interfaces (e.g. inside a Docker
        // container where you want the port to be reachable from the host
        // via -p mapping).
        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        #[arg(long)]
        proxy: Option<String>,

        #[arg(long)]
        user_agent: Option<String>,

        #[arg(long)]
        stealth: bool,

        #[arg(long, default_value_t = 1)]
        workers: u16,

        /// Allow CDP clients to navigate to file:// URLs. Off by
        /// default so a CDP connection cannot read arbitrary local
        /// files. Enable only when serving local HTML for testing
        /// and the port is on a trusted network.
        #[arg(long)]
        allow_file_access: bool,
    },

    /// Bounded original text response and metadata, through the shared native network owner.
    Response {
        url: String,
        #[arg(long, default_value_t = 2_000_000, value_parser = clap::value_parser!(u64).range(1..=64_000_000))]
        max_bytes: u64,
        #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..=300))]
        timeout: u64,
        #[arg(long)]
        allow_private_network: bool,
    },

    Fetch {
        url: String,

        /// Reject non-success HTTP status before writing an original response body.
        #[arg(long)]
        fail_on_http_error: bool,

        #[arg(long, default_value = "html")]
        dump: DumpFormat,

        #[arg(long)]
        selector: Option<String>,

        #[arg(long, default_value_t = 5)]
        wait: u64,

        #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..))]
        timeout: u64,

        #[arg(long, default_value = "load")]
        wait_until: String,

        #[arg(long)]
        user_agent: Option<String>,

        #[arg(long)]
        stealth: bool,

        #[arg(long, short)]
        eval: Option<String>,

        #[arg(long, short = 'o')]
        output: Option<std::path::PathBuf>,

        #[arg(long, short)]
        quiet: bool,
    },

    Scrape {
        urls: Vec<String>,

        #[arg(long, short)]
        eval: Option<String>,

        #[arg(long, default_value_t = std::num::NonZeroUsize::new(10).unwrap())]
        concurrency: std::num::NonZeroUsize,

        #[arg(long, default_value = "json")]
        format: String,

        #[arg(long, default_value_t = 60, value_parser = clap::value_parser!(u64).range(1..))]
        timeout: u64,

        #[arg(long, short)]
        quiet: bool,
    },

    /// Bounded, robots-aware crawl of one or more seeds with the static Obscura HTTP stack.
    /// Reports what a native crawler or an LLM agent can extract from the initial HTML.
    Crawl(crawl::CrawlArgs),

    ChromePath,
}

#[derive(Clone, Debug, clap::ValueEnum, PartialEq, Eq)]
enum DumpFormat {
    Html,
    Text,
    Links,
    Markdown,
    /// Stable crawler/browser → N2B artifact: HTML, extracted content and scripts.
    Artifact,
    /// Stream the raw HTTP response body verbatim (binary-safe).
    /// Bypasses the browser/JS layer — useful for fetching images,
    /// JSON, JS, CSS, or any non-HTML resource (cf. issue #117).
    Original,
}

fn print_banner(port: u16) {
    println!(
        r#"
   ____  _
  / __ \| |
 | |  | | |__  ___  ___ _   _ _ __ __ _
 | |  | | '_ \/ __|/ __| | | | '__/ _` |
 | |__| | |_) \__ \ (__| |_| | | | (_| |
  \____/|_.__/|___/\___|\__,_|_|  \__,_|

  Headless Browser v0.1.5
  CDP server: ws://127.0.0.1:{}/devtools/browser
"#,
        port
    );
}

fn select_log_filter(verbose: bool, quiet: bool) -> &'static str {
    if verbose {
        "debug"
    } else if quiet {
        "off"
    } else {
        "warn"
    }
}

fn is_quiet_command(cmd: &Option<Command>) -> bool {
    matches!(
        cmd,
        Some(Command::Fetch { quiet: true, .. })
            | Some(Command::Scrape { quiet: true, .. })
            | Some(Command::Crawl(crawl::CrawlArgs { quiet: true, .. }))
            | Some(Command::Response { .. })
    )
}

fn merge_proxy(global_proxy: Option<String>, command_proxy: Option<String>) -> Option<String> {
    command_proxy.or(global_proxy)
}

/// `--stealth` routes outbound traffic through `wreq`, which doesn't speak
/// SOCKS5. A previous workaround silently rewrote `socks5://` to `http://`,
/// which broke plain SOCKS5 servers (#160). Refuse the combination at
/// startup so the user gets a clear message instead of `TunnelUnexpectedEof`.
fn reject_stealth_with_socks5(proxy: Option<&str>, stealth: bool) -> anyhow::Result<()> {
    validate_render_proxy(proxy, stealth).map_err(anyhow::Error::msg)
}

/// Entry point of the former `aphrody-web` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let args = match Args::try_parse_from(args) {
        Ok(args) => args,
        Err(err) => {
            let code = err.exit_code();
            let _ = err.print();
            return code;
        },
    };
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("Error: failed to build tokio runtime: {err}");
            return 1;
        },
    };
    match runtime.block_on(run(args)) {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("Error: {err:?}");
            1
        },
    }
}

/// Command for a re-invocation of this multi-call binary under the invocation name `name`
/// (`aphrody-web`, `aphrody-web-worker`): argv[0] on Unix, a sibling `<name>.exe` link on Windows.
fn multicall_command(name: &str) -> anyhow::Result<std::process::Command> {
    let exe = std::env::current_exe()?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        let mut command = std::process::Command::new(exe);
        command.arg0(name);
        Ok(command)
    }
    #[cfg(not(unix))]
    {
        let sibling = exe.with_file_name(format!("{name}.exe"));
        Ok(std::process::Command::new(if sibling.exists() { sibling } else { exe }))
    }
}

async fn run(args: Args) -> anyhow::Result<()> {
    let quiet = is_quiet_command(&args.command);
    let filter = select_log_filter(args.verbose, quiet);
    // `try_init`: the host process may already own the global subscriber.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(filter)),
        )
        .with_writer(std::io::stderr)
        .try_init();

    if let Some(flags) = normalize_v8_flags(args.v8_flags.as_deref()) {
        tracing::info!("Applying V8 flags: {}", flags);
        obscura_js::set_v8_flags(&flags);
    }

    let global_proxy = args.proxy.clone();

    match args.command {
        Some(Command::Launch {
            port,
            host,
            proxy,
            user_agent,
            stealth,
            workers,
            allow_file_access,
            chrome_path,
        }) => {
            let proxy = merge_proxy(global_proxy.clone(), proxy);
            reject_stealth_with_socks5(proxy.as_deref(), stealth)?;

            if let Some(ref path) = chrome_path {
                // SAFETY: `cli_main` runs on a current-thread runtime and spawns no other thread
                // before this point; the multi-call host calls it before starting any thread that
                // reads the environment.
                unsafe { std::env::set_var("APHRODY_WEB_CHROME_BIN", path) };
            }

            // Print the WS URL to stdout for WebSocketTransport.ts to parse
            println!("ws://{}:{}/devtools/browser", host, port);

            if workers > 1 {
                run_multi_worker_serve(port, workers, proxy, stealth, user_agent).await?;
            } else {
                obscura_cdp::start_with_host_and_security(
                    port,
                    &host,
                    proxy,
                    stealth,
                    user_agent,
                    allow_file_access,
                    None,
                )
                .await?;
            }
        },
        Some(Command::Response {
            url,
            max_bytes,
            timeout: timeout_secs,
            allow_private_network,
        }) => {
            validate_page_url(&url).map_err(anyhow::Error::msg)?;
            let parsed = url::Url::parse(&url)?;
            let client = obscura_net::ObscuraHttpClient::with_full_options(
                Arc::new(obscura_net::CookieJar::new()),
                global_proxy.as_deref(),
                allow_private_network,
            );
            let (response, truncated) = tokio::time::timeout(
                Duration::from_secs(timeout_secs),
                client.fetch_text_preview(&parsed, max_bytes as usize),
            )
            .await
            .map_err(|_| anyhow::anyhow!("Aphrody Web response timed out"))??;
            println!(
                "{}",
                serde_json::json!({
                    "url": response.url.as_str(), "status": response.status,
                    "headers": response.headers, "bytes": response.body.len(),
                    "truncated": truncated, "body": response.text(),
                })
            );
        },
        Some(Command::Fetch {
            url,
            fail_on_http_error,
            dump,
            selector,
            wait,
            timeout,
            wait_until,
            user_agent,
            stealth,
            eval,
            output,
            quiet,
        }) => {
            reject_stealth_with_socks5(global_proxy.as_deref(), stealth)?;
            run_fetch(
                &url,
                dump,
                selector,
                wait,
                timeout,
                &wait_until,
                user_agent,
                stealth,
                eval,
                output,
                quiet,
                global_proxy,
                fail_on_http_error,
            )
            .await?;
        },
        Some(Command::Scrape { urls, eval, concurrency, format, timeout, quiet }) => {
            run_parallel_scrape(
                urls,
                eval,
                concurrency.get(),
                &format,
                timeout,
                quiet,
                global_proxy,
            )
            .await?;
        },
        Some(Command::Crawl(crawl_args)) => {
            crawl::run_crawl(crawl_args, global_proxy).await?;
        },
        Some(Command::ChromePath) => {
            let path = resolve_chrome_path()?;
            println!("{}", path.display());
        },
        None => {
            print_banner(args.port);
            if let Some(ref proxy) = args.proxy {
                tracing::info!("Using proxy: {}", proxy);
            }
            obscura_cdp::start_with_options(args.port, args.proxy, false).await?;
        },
    }

    Ok(())
}

fn resolve_chrome_path() -> anyhow::Result<std::path::PathBuf> {
    if let Ok(p) = std::env::var("APHRODY_WEB_CHROME_BIN") {
        return Ok(std::path::PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("CHROME_PATH") {
        return Ok(std::path::PathBuf::from(p));
    }

    anyhow::bail!(
        "Aucun moteur desktop externe : utilisez Obscura/Tauri/Wry; le headless utilise \
         curl-impersonate"
    )
}

async fn run_multi_worker_serve(
    port: u16,
    workers: u16,
    proxy: Option<String>,
    stealth: bool,
    user_agent: Option<String>,
) -> anyhow::Result<()> {
    use tokio::{io::AsyncWriteExt as _, net::TcpListener};

    // Workers must never outlive the load balancer: the guard kills and reaps them on every
    // exit path (shutdown signal, accept error, panic).
    let mut children = WorkerGuard(Vec::new());

    for i in 0..workers {
        let worker_port = port + 1 + i;
        let mut cmd = multicall_command("aphrody-web")?;
        cmd.arg("launch").arg("--port").arg(worker_port.to_string());
        if let Some(ref p) = proxy {
            cmd.arg("--proxy").arg(p);
        }
        if let Some(ref ua) = user_agent {
            cmd.arg("--user-agent").arg(ua);
        }
        if stealth {
            cmd.arg("--stealth");
        }
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());

        let child = cmd.spawn()?;
        tracing::info!("Worker {} on port {}", i + 1, worker_port);
        children.0.push(child);
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("Load balancer on port {}, {} workers", port, workers);

    let mut next_worker: u16 = 0;
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    loop {
        let (client_stream, peer_addr) = tokio::select! {
            accepted = listener.accept() => accepted?,
            () = &mut shutdown => {
                tracing::info!("Shutdown signal received; stopping {} workers", workers);
                return Ok(());
            },
        };
        let worker_port = port + 1 + (next_worker % workers);
        next_worker = next_worker.wrapping_add(1);

        tracing::debug!("Routing {} to worker port {}", peer_addr, worker_port);

        let mut peek_buf = [0u8; 4];
        client_stream.peek(&mut peek_buf).await?;

        if &peek_buf == b"GET " {
            let mut full_peek = [0u8; 256];
            let n = client_stream.peek(&mut full_peek).await?;
            let request_line = String::from_utf8_lossy(&full_peek[..n]);

            if request_line.contains("/json") {
                let worker_addr = format!("127.0.0.1:{}", worker_port);
                match tokio::net::TcpStream::connect(&worker_addr).await {
                    Ok(mut worker_stream) => {
                        tokio::spawn(async move {
                            let std_stream = match client_stream.into_std() {
                                Ok(s) => s,
                                Err(e) => {
                                    tracing::error!(
                                        "/json: failed to convert client to std stream: {}",
                                        e
                                    );
                                    return;
                                },
                            };
                            let mut client = match tokio::net::TcpStream::from_std(std_stream) {
                                Ok(c) => c,
                                Err(e) => {
                                    tracing::error!(
                                        "/json: failed to recreate tokio TcpStream: {}",
                                        e
                                    );
                                    return;
                                },
                            };
                            let _ = tokio::io::copy_bidirectional(&mut client, &mut worker_stream)
                                .await;
                        });
                    },
                    Err(e) => {
                        tracing::warn!("/json worker {} unreachable: {}", worker_addr, e);
                        tokio::spawn(async move {
                            let mut s = client_stream;
                            let _ = s
                                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                                .await;
                            let _ = s.shutdown().await;
                        });
                    },
                }
                continue;
            }
        }

        let worker_addr = format!("127.0.0.1:{}", worker_port);
        tokio::spawn(async move {
            match tokio::net::TcpStream::connect(&worker_addr).await {
                Ok(mut worker_stream) => {
                    let mut client = client_stream;
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut worker_stream).await;
                },
                Err(e) => {
                    tracing::warn!("worker {} unreachable: {}", worker_addr, e);
                    let mut s = client_stream;
                    let _ =
                        s.write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n").await;
                    let _ = s.shutdown().await;
                },
            }
        });
    }
}

/// Owns the spawned worker processes and terminates them when dropped.
struct WorkerGuard(Vec<std::process::Child>);

impl Drop for WorkerGuard {
    fn drop(&mut self) {
        for child in &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Resolves on Ctrl-C or, on Unix, SIGTERM.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut term) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = term.recv() => {},
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

#[allow(clippy::too_many_arguments)]
async fn run_fetch(
    url_str: &str,
    dump: DumpFormat,
    selector: Option<String>,
    wait_secs: u64,
    timeout_secs: u64,
    wait_until: &str,
    user_agent: Option<String>,
    stealth: bool,
    eval: Option<String>,
    output: Option<std::path::PathBuf>,
    quiet: bool,
    proxy: Option<String>,
    fail_on_http_error: bool,
) -> anyhow::Result<()> {
    // --dump original short-circuits the browser stack entirely: fetch the raw
    // response body via HTTP and stream the bytes verbatim. Useful for binary
    // payloads (images, fonts, …) and any non-HTML resource where parsing the
    // body through the DOM/JS layer would corrupt or discard data.
    if dump == DumpFormat::Original {
        let bytes = fetch_original_bytes(
            url_str,
            proxy,
            user_agent.clone(),
            timeout_secs,
            fail_on_http_error,
        )
        .await?;
        write_or_print_bytes(&bytes, output.as_ref()).await?;
        return Ok(());
    }

    validate_page_url(url_str).map_err(anyhow::Error::msg)?;

    let context = Arc::new(BrowserContext::with_options("fetch".to_string(), proxy, stealth));
    let mut page = Page::new("fetch-page".to_string(), context);

    if let Some(ref ua) = user_agent {
        page.http_client.set_user_agent(ua).await;
    }

    let wait_condition = obscura_browser::lifecycle::WaitUntil::from_str(wait_until);

    if !quiet {
        eprintln!("Fetching {}...", url_str);
    }

    match timeout(
        Duration::from_secs(timeout_secs),
        page.navigate_with_wait(url_str, wait_condition),
    )
    .await
    {
        Ok(result) => {
            result.map_err(|e| anyhow::anyhow!("Failed to navigate to {}: {}", url_str, e))?
        },
        Err(_) => anyhow::bail!("Timed out navigating to {} after {}s", url_str, timeout_secs),
    }

    if !quiet {
        eprintln!("Page loaded: {} - \"{}\"", page.url_string(), page.title);
    }

    if let Some(ref sel) = selector {
        let found = wait_for_selector(&mut page, sel, wait_secs).await;
        if !found {
            eprintln!("Warning: selector '{}' not found after {}s", sel, wait_secs);
        }
    }

    if let Some(ref expr) = eval {
        let result = page.evaluate(expr);
        let rendered = match result {
            serde_json::Value::String(s) => s,
            serde_json::Value::Null => "null".to_string(),
            other => other.to_string(),
        };
        write_or_print(rendered, output.as_ref()).await?;
        return Ok(());
    }

    let rendered = match dump {
        DumpFormat::Html => dump_html(&page),
        DumpFormat::Text => dump_text(&mut page),
        DumpFormat::Links => dump_links(&page),
        DumpFormat::Markdown => dump_markdown(&mut page),
        DumpFormat::Artifact => dump_artifact(&mut page),
        // Handled above via the short-circuit branch; unreachable here.
        DumpFormat::Original => unreachable!("Original dump handled before page navigation"),
    };
    write_or_print(rendered, output.as_ref()).await?;

    Ok(())
}

async fn fetch_original_bytes(
    url_str: &str,
    proxy: Option<String>,
    user_agent: Option<String>,
    timeout_secs: u64,
    fail_on_http_error: bool,
) -> anyhow::Result<Vec<u8>> {
    let url = url::Url::parse(url_str)
        .map_err(|e| anyhow::anyhow!("Invalid URL '{}': {}", url_str, e))?;

    let client = obscura_net::ObscuraHttpClient::with_options(
        Arc::new(obscura_net::CookieJar::new()),
        proxy.as_deref(),
    );
    if let Some(ua) = user_agent {
        client.set_user_agent(&ua).await;
    }

    let response = match timeout(Duration::from_secs(timeout_secs), client.fetch(&url)).await {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => anyhow::bail!("Failed to fetch {}: {}", url_str, e),
        Err(_) => anyhow::bail!("Timed out fetching {} after {}s", url_str, timeout_secs),
    };

    original_response_bytes(response, fail_on_http_error)
}

fn original_response_bytes(
    response: obscura_net::client::Response,
    fail_on_http_error: bool,
) -> anyhow::Result<Vec<u8>> {
    if fail_on_http_error && !(200..300).contains(&response.status) {
        anyhow::bail!("HTTP status {}", response.status);
    }
    Ok(response.body)
}

async fn write_or_print(
    content: String,
    output: Option<&std::path::PathBuf>,
) -> anyhow::Result<()> {
    if let Some(path) = output {
        tokio::fs::write(path, content)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write {}: {}", path.display(), e))?;
    } else {
        println!("{}", content);
    }
    Ok(())
}

async fn write_or_print_bytes(
    bytes: &[u8],
    output: Option<&std::path::PathBuf>,
) -> anyhow::Result<()> {
    if let Some(path) = output {
        tokio::fs::write(path, bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write {}: {}", path.display(), e))?;
    } else {
        // Write raw bytes to stdout — never println! (would append a newline
        // and break binary payloads like JPEG/PNG).
        let mut stdout = tokio::io::stdout();
        stdout
            .write_all(bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write to stdout: {}", e))?;
        stdout.flush().await.map_err(|e| anyhow::anyhow!("Failed to flush stdout: {}", e))?;
    }
    Ok(())
}

async fn wait_for_selector(page: &mut Page, selector: &str, timeout_secs: u64) -> bool {
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_secs);
    loop {
        let found = page
            .with_dom(|dom| dom.query_selector(selector).ok().flatten().is_some())
            .unwrap_or(false);

        if found {
            return true;
        }

        if tokio::time::Instant::now() >= deadline {
            return false;
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
}

fn dump_html(page: &Page) -> String {
    page.with_dom(|dom| {
        if let Ok(Some(html_node)) = dom.query_selector("html") {
            let html = dom.outer_html(html_node);
            format!("<!DOCTYPE html>\n{}", html)
        } else {
            let doc = dom.document();
            dom.inner_html(doc)
        }
    })
    .unwrap_or_default()
}

fn dump_text(page: &mut Page) -> String {
    let html = page.with_dom(|tree| tree.inner_html(tree.document())).unwrap_or_default();
    let url = page.url_string();
    extract_main(&html, Some(url.as_str())).text
}

fn dump_markdown(page: &mut Page) -> String {
    // Canonical converter (aphrody-web-extract) over the live, script-mutated DOM.
    let html = page.with_dom(|tree| tree.inner_html(tree.document())).unwrap_or_default();
    let url = page.url_string();
    html_to_markdown(&html, Some(url.as_str()))
}

fn dump_artifact(page: &mut Page) -> String {
    let html = page.with_dom(|tree| tree.inner_html(tree.document())).unwrap_or_default();
    let url = page.url_string();
    serde_json::to_string_pretty(&page_artifact(&html, url.as_str()))
        .unwrap_or_else(|_| "{}".to_string())
}

async fn run_parallel_scrape(
    urls: Vec<String>,
    eval: Option<String>,
    concurrency: usize,
    format: &str,
    timeout_secs: u64,
    quiet: bool,
    proxy: Option<String>,
) -> anyhow::Result<()> {
    let total = urls.len();
    let start = Instant::now();

    if total == 0 {
        anyhow::bail!("No URLs provided. Pass at least one URL to scrape.");
    }

    if !quiet {
        eprintln!(
            "Scraping {} URLs with {} concurrent workers (per-worker timeout: {}s)...",
            total, concurrency, timeout_secs
        );
    }

    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let eval = Arc::new(eval);
    let worker_timeout = Duration::from_secs(timeout_secs);
    let read_timeout = Duration::from_secs(timeout_secs.min(30));
    let shutdown_timeout = Duration::from_secs(5);

    let mut handles = Vec::new();

    for (i, url) in urls.into_iter().enumerate() {
        let sem = semaphore.clone();
        let eval = eval.clone();
        let proxy = proxy.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let task_start = Instant::now();

            let spawned = multicall_command("aphrody-web-worker").and_then(|command| {
                let mut command = TokioCommand::from(command);
                command
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .env("OBSCURA_PROXY", proxy.as_deref().unwrap_or(""));
                command.spawn().map_err(anyhow::Error::from)
            });
            let mut child = match spawned {
                Ok(c) => c,
                Err(e) => {
                    return serde_json::json!({
                        "url": url,
                        "error": format!("Failed to spawn worker: {}", e),
                        "time_ms": task_start.elapsed().as_millis(),
                    });
                },
            };

            let mut stdin = match child.stdin.take() {
                Some(stdin) => stdin,
                None => {
                    let _ = timeout(shutdown_timeout, child.kill()).await;
                    return serde_json::json!({
                        "url": url,
                        "error": "Failed to open worker stdin",
                        "time_ms": task_start.elapsed().as_millis(),
                    });
                },
            };
            let stdout = match child.stdout.take() {
                Some(stdout) => stdout,
                None => {
                    let _ = timeout(shutdown_timeout, child.kill()).await;
                    return serde_json::json!({
                        "url": url,
                        "error": "Failed to open worker stdout",
                        "time_ms": task_start.elapsed().as_millis(),
                    });
                },
            };
            let mut reader = BufReader::new(stdout);

            let worker_result: Result<serde_json::Value, String> =
                match timeout(worker_timeout, async {
                    let nav_cmd = serde_json::json!({"cmd": "navigate", "url": url});
                    let mut line = serde_json::to_string(&nav_cmd).unwrap();
                    line.push('\n');
                    if stdin.write_all(line.as_bytes()).await.is_err() {
                        return Err("Write failed".to_string());
                    }
                    if stdin.flush().await.is_err() {
                        return Err("Write failed".to_string());
                    }

                    let mut resp_line = String::new();
                    match timeout(read_timeout, reader.read_line(&mut resp_line)).await {
                        Ok(Ok(bytes)) if bytes > 0 => {},
                        Ok(Ok(_)) | Ok(Err(_)) => return Err("Read failed".to_string()),
                        Err(_) => return Err("timeout".to_string()),
                    };

                    let nav_resp: serde_json::Value = serde_json::from_str(resp_line.trim())
                        .unwrap_or(serde_json::json!({"ok": false}));

                    if !nav_resp["ok"].as_bool().unwrap_or(false) {
                        return Err(nav_resp["error"]
                            .as_str()
                            .unwrap_or("navigate failed")
                            .to_string());
                    }

                    let title = nav_resp["result"]["title"].as_str().unwrap_or("").to_string();

                    let eval_result = if let Some(ref expr) = *eval {
                        let eval_cmd = serde_json::json!({"cmd": "evaluate", "expression": expr});
                        let mut line = serde_json::to_string(&eval_cmd).unwrap();
                        line.push('\n');
                        if stdin.write_all(line.as_bytes()).await.is_err() {
                            return Err("Write failed".to_string());
                        }
                        if stdin.flush().await.is_err() {
                            return Err("Write failed".to_string());
                        }

                        let mut resp_line = String::new();
                        match timeout(read_timeout, reader.read_line(&mut resp_line)).await {
                            Ok(Ok(bytes)) if bytes > 0 => {
                                let resp: serde_json::Value =
                                    serde_json::from_str(resp_line.trim())
                                        .unwrap_or(serde_json::json!({"ok": false}));
                                resp["result"].clone()
                            },
                            Ok(Ok(_)) | Ok(Err(_)) => return Err("Read failed".to_string()),
                            Err(_) => return Err("timeout".to_string()),
                        }
                    } else {
                        serde_json::Value::Null
                    };

                    let shutdown_cmd = serde_json::json!({"cmd": "shutdown"});
                    let mut line = serde_json::to_string(&shutdown_cmd).unwrap();
                    line.push('\n');
                    let _ = stdin.write_all(line.as_bytes()).await;
                    let _ = stdin.flush().await;
                    let _ = timeout(shutdown_timeout, child.wait()).await;

                    Ok(serde_json::json!({
                        "url": url,
                        "title": title,
                        "eval": eval_result,
                        "time_ms": task_start.elapsed().as_millis(),
                        "worker": i,
                    }))
                })
                .await
                {
                    Ok(result) => result,
                    Err(_) => Err("timeout".to_string()),
                };

            match worker_result {
                Ok(result) => result,
                Err(error) => {
                    let _ = timeout(shutdown_timeout, child.kill()).await;
                    serde_json::json!({
                        "url": url,
                        "error": error,
                        "time_ms": task_start.elapsed().as_millis(),
                    })
                },
            }
        });

        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => results.push(serde_json::json!({"error": e.to_string()})),
        }
    }

    let total_time = start.elapsed();

    if format == "json" {
        let output = serde_json::json!({
            "total_urls": total,
            "concurrency": concurrency,
            "total_time_ms": total_time.as_millis(),
            "avg_time_ms": total_time.as_millis() as f64 / total as f64,
            "results": results,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        for r in &results {
            let url = r["url"].as_str().unwrap_or("?");
            let title = r["title"].as_str().unwrap_or("");
            let time = r["time_ms"].as_u64().unwrap_or(0);
            let eval = &r["eval"];
            if eval.is_null() {
                println!("{}ms\t{}\t{}", time, url, title);
            } else {
                println!("{}ms\t{}\t{}", time, url, eval);
            }
        }
        if !quiet {
            eprintln!(
                "\nTotal: {}ms for {} URLs ({} concurrent)",
                total_time.as_millis(),
                total,
                concurrency
            );
        }
    }

    Ok(())
}

fn dump_links(page: &Page) -> String {
    let Some(base_url) = page.url.clone() else { return String::new() };
    let html = page.with_dom(|dom| dom.inner_html(dom.document())).unwrap_or_default();
    aphrody_web_crawl::extract_links_opts(&html, &base_url, false)
        .into_iter()
        .map(|(url, text)| {
            let text = text.trim();
            if text.is_empty() { url.to_string() } else { format!("{url}\t{text}") }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use aphrody_web_service::extract_main;
    use clap::Parser;

    use super::{
        Args, Command, DumpFormat, fetch_original_bytes, is_quiet_command, merge_proxy,
        normalize_v8_flags, reject_stealth_with_socks5, select_log_filter, write_or_print,
        write_or_print_bytes,
    };

    // Issue #117 — `--dump original` short-circuits the browser stack and
    // streams the raw response body verbatim, including for binary payloads.
    //
    // Two tests below pin the behaviour:
    //   1. clap accepts `--dump original` as a valid DumpFormat variant.
    //   2. `fetch_original_bytes` returns the exact bytes a `file://` URL points at (binary-safe
    //      round-trip — no UTF-8 decode, no trailing newline, no DOM mutation).
    //   3. `write_or_print_bytes` writes raw bytes to a file without the trailing newline that
    //      `println!` would add.
    #[test]
    fn parsed_fetch_dump_original_is_accepted_by_clap() {
        let args = Args::try_parse_from([
            "obscura",
            "fetch",
            "--dump",
            "original",
            "https://example.com/image.jpg",
        ])
        .expect("clap should accept --dump original");
        match args.command {
            Some(Command::Fetch { dump, .. }) => {
                assert_eq!(dump, DumpFormat::Original);
            },
            _ => panic!("expected Fetch command"),
        }
    }

    #[test]
    fn parsed_fetch_dump_artifact_is_accepted_by_clap() {
        let args = Args::try_parse_from([
            "obscura",
            "fetch",
            "--dump",
            "artifact",
            "https://example.com/app",
        ])
        .expect("clap should accept --dump artifact");
        assert!(matches!(args.command, Some(Command::Fetch { dump: DumpFormat::Artifact, .. })));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_original_bytes_returns_file_contents_verbatim() {
        // A real binary payload: a 1×1 transparent PNG (89 50 4E 47 …) —
        // exactly the kind of resource #117 wants to stream without HTML/
        // JS rendering.
        const PNG_BYTES: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];

        let path = std::env::temp_dir()
            .join(format!("obscura-fetch-original-test-{}.png", std::process::id()));
        let _ = tokio::fs::remove_file(&path).await;
        tokio::fs::write(&path, PNG_BYTES).await.expect("seed temp PNG fixture");

        let file_url = format!("file://{}", path.display());
        let bytes = fetch_original_bytes(&file_url, None, None, 5, false)
            .await
            .expect("fetch_original_bytes should round-trip the file body");

        let _ = tokio::fs::remove_file(&path).await;

        assert_eq!(bytes, PNG_BYTES, "raw response body must match the file byte-for-byte");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn original_binary_http_status_gate_preserves_success_and_debug_failures() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let payload = vec![0x89, b'P', b'N', b'G', 0, 255, 254];
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let served_payload = payload.clone();
        let server = tokio::spawn(async move {
            for status in [200, 404] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024];
                let read = socket.read(&mut request).await.unwrap();
                assert!(read > 0, "the client sent a request");
                socket.write_all(format!("HTTP/1.1 {status} Fixture\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", served_payload.len()).as_bytes()).await.unwrap();
                socket.write_all(&served_payload).await.unwrap();
            }
        });
        let client = obscura_net::ObscuraHttpClient::with_full_options(
            std::sync::Arc::new(obscura_net::CookieJar::new()),
            None,
            true,
        );
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/fixture.png")).unwrap();
        let success = client.fetch(&url).await.unwrap();
        assert_eq!(super::original_response_bytes(success, true).unwrap(), payload);
        let failure = client.fetch(&url).await.unwrap();
        assert_eq!(
            super::original_response_bytes(failure.clone(), true).unwrap_err().to_string(),
            "HTTP status 404"
        );
        assert_eq!(super::original_response_bytes(failure, false).unwrap(), payload);
        server.await.unwrap();
        let default = Args::try_parse_from([
            "aphrody-web",
            "fetch",
            "https://example.test/",
            "--dump",
            "original",
        ])
        .unwrap();
        assert!(matches!(default.command, Some(Command::Fetch { fail_on_http_error: false, .. })));
        let checked = Args::try_parse_from([
            "aphrody-web",
            "fetch",
            "https://example.test/",
            "--dump",
            "original",
            "--fail-on-http-error",
        ])
        .unwrap();
        assert!(matches!(checked.command, Some(Command::Fetch { fail_on_http_error: true, .. })));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn write_or_print_bytes_writes_without_trailing_newline() {
        // Regression guard for #117: stdout must receive raw bytes. The file
        // path used here exercises the file-output branch — println!-style
        // output (used by write_or_print) would append a 0x0A byte and
        // corrupt binary payloads. write_or_print_bytes must not.
        let payload: &[u8] = &[0x00, 0xFF, b'h', b'i', 0x00];
        let path = std::env::temp_dir()
            .join(format!("obscura-write-bytes-test-{}.bin", std::process::id()));
        let _ = tokio::fs::remove_file(&path).await;

        write_or_print_bytes(payload, Some(&path))
            .await
            .expect("write_or_print_bytes should write the file");

        let read_back = tokio::fs::read(&path).await.expect("read back");
        let _ = tokio::fs::remove_file(&path).await;

        assert_eq!(read_back, payload, "file bytes must match the payload exactly");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn write_or_print_writes_output_file_with_tokio_fs() {
        let path = std::env::temp_dir()
            .join(format!("obscura-fetch-output-test-{}.txt", std::process::id()));
        let _ = tokio::fs::remove_file(&path).await;

        write_or_print("rendered output".to_string(), Some(&path))
            .await
            .expect("write output file");

        let content = tokio::fs::read_to_string(&path).await.expect("read output file");
        let _ = tokio::fs::remove_file(&path).await;

        assert_eq!(content, "rendered output");
    }

    #[test]
    fn default_filter_is_warn() {
        assert_eq!(select_log_filter(false, false), "warn");
    }

    #[test]
    fn verbose_filter_is_debug() {
        assert_eq!(select_log_filter(true, false), "debug");
    }

    #[test]
    fn quiet_filter_is_off() {
        assert_eq!(select_log_filter(false, true), "off");
    }

    #[test]
    fn verbose_wins_over_quiet() {
        assert_eq!(select_log_filter(true, true), "debug");
    }

    #[test]
    fn parsed_fetch_with_quiet_flag_is_detected() {
        let args = Args::try_parse_from(["obscura", "fetch", "--quiet", "https://example.com"])
            .expect("clap should accept --quiet on fetch");
        assert!(is_quiet_command(&args.command));
    }

    #[test]
    fn parsed_fetch_without_quiet_is_not_detected() {
        let args = Args::try_parse_from(["obscura", "fetch", "https://example.com"])
            .expect("clap should accept fetch without --quiet");
        assert!(!is_quiet_command(&args.command));
    }

    #[test]
    fn parsed_serve_command_is_not_quiet() {
        let args = Args::try_parse_from(["obscura", "serve"]).expect("clap should accept serve");
        assert!(!is_quiet_command(&args.command));
    }

    #[test]
    fn no_subcommand_is_not_quiet() {
        assert!(!is_quiet_command(&None));
    }

    #[test]
    fn parsed_v8_flags_global_arg() {
        let args = Args::try_parse_from([
            "obscura",
            "--v8-flags",
            "--max-old-space-size=4096 --max-semi-space-size=64",
            "fetch",
            "https://example.com",
        ])
        .expect("clap should accept --v8-flags as a global arg");
        assert_eq!(
            args.v8_flags.as_deref(),
            Some("--max-old-space-size=4096 --max-semi-space-size=64"),
        );
    }

    #[test]
    fn v8_flags_default_is_none() {
        let args = Args::try_parse_from(["obscura", "fetch", "https://example.com"])
            .expect("clap should accept fetch without --v8-flags");
        assert!(args.v8_flags.is_none());
    }

    #[test]
    fn parsed_v8_flags_with_serve_subcommand() {
        let args = Args::try_parse_from([
            "obscura",
            "--v8-flags",
            "--max-old-space-size=2048",
            "serve",
            "--port",
            "9333",
        ])
        .expect("clap should accept --v8-flags with serve");
        assert_eq!(args.v8_flags.as_deref(), Some("--max-old-space-size=2048"));
    }

    #[test]
    fn parsed_v8_flags_with_scrape_subcommand() {
        let args = Args::try_parse_from([
            "obscura",
            "--v8-flags",
            "--expose-gc",
            "scrape",
            "https://a.com",
            "https://b.com",
        ])
        .expect("clap should accept --v8-flags with scrape");
        assert_eq!(args.v8_flags.as_deref(), Some("--expose-gc"));
    }

    #[test]
    fn parsed_v8_flags_empty_string_is_accepted() {
        let args =
            Args::try_parse_from(["obscura", "--v8-flags", "", "fetch", "https://example.com"])
                .expect("clap should accept empty --v8-flags value");
        assert_eq!(args.v8_flags.as_deref(), Some(""));
    }

    #[test]
    fn normalize_v8_flags_returns_none_when_unset() {
        assert_eq!(normalize_v8_flags(None), None);
    }

    #[test]
    fn normalize_v8_flags_returns_none_for_empty_or_whitespace() {
        assert_eq!(normalize_v8_flags(Some("")), None);
        assert_eq!(normalize_v8_flags(Some("   ")), None);
        assert_eq!(normalize_v8_flags(Some("\t\n")), None);
    }

    #[test]
    fn normalize_v8_flags_trims_surrounding_whitespace() {
        assert_eq!(
            normalize_v8_flags(Some("  --max-old-space-size=4096  ")).as_deref(),
            Some("--max-old-space-size=4096"),
        );
    }

    #[test]
    fn normalize_v8_flags_preserves_multi_flag_string() {
        let input = "--max-old-space-size=4096 --max-semi-space-size=64 --expose-gc";
        assert_eq!(normalize_v8_flags(Some(input)).as_deref(), Some(input));
    }

    #[test]
    fn reject_stealth_with_socks5_passes_when_no_stealth() {
        assert!(reject_stealth_with_socks5(Some("socks5://127.0.0.1:1080"), false).is_ok());
    }

    #[test]
    fn reject_stealth_with_socks5_passes_when_no_proxy() {
        assert!(reject_stealth_with_socks5(None, true).is_ok());
    }

    #[test]
    fn reject_stealth_with_socks5_passes_for_http_proxy() {
        assert!(reject_stealth_with_socks5(Some("http://127.0.0.1:8080"), true).is_ok());
        assert!(reject_stealth_with_socks5(Some("https://proxy.example:443"), true).is_ok());
    }

    #[test]
    fn reject_stealth_with_socks5_fails_for_socks5() {
        let err = reject_stealth_with_socks5(Some("socks5://127.0.0.1:9999"), true).unwrap_err();
        assert!(err.to_string().contains("SOCKS5"));
        assert!(err.to_string().contains("stealth"));
    }

    #[test]
    fn reject_stealth_with_socks5_fails_for_socks5h() {
        let err = reject_stealth_with_socks5(Some("socks5h://127.0.0.1:9999"), true).unwrap_err();
        assert!(err.to_string().contains("SOCKS5"));
    }

    #[test]
    fn reject_stealth_with_socks5_is_case_insensitive() {
        let err = reject_stealth_with_socks5(Some("SOCKS5://127.0.0.1:9999"), true).unwrap_err();
        assert!(err.to_string().contains("SOCKS5"));
    }

    #[test]
    fn parsed_fetch_quiet_resolves_to_off_filter() {
        let args =
            Args::try_parse_from(["obscura", "fetch", "--quiet", "https://example.com"]).unwrap();
        let filter = select_log_filter(args.verbose, is_quiet_command(&args.command));
        assert_eq!(filter, "off");
    }

    #[test]
    fn matcher_still_uses_fetch_variant() {
        let cmd = Some(Command::Fetch {
            url: "https://x".to_string(),
            fail_on_http_error: false,
            dump: super::DumpFormat::Html,
            selector: None,
            wait: 5,
            timeout: 30,
            wait_until: "load".to_string(),
            user_agent: None,
            stealth: false,
            eval: None,
            quiet: true,
            output: None,
        });
        assert!(is_quiet_command(&cmd));
    }

    fn body_text(html: &str) -> String {
        extract_main(html, Some("https://example.test")).text
    }

    #[test]
    fn skips_nav_header_footer_aside() {
        let text = body_text(
            r#"<html><body>
                <header>SITE HEADER</header>
                <nav>NAV LINKS</nav>
                <aside>SIDEBAR</aside>
                <main><p>Article body.</p></main>
                <footer>FOOTER</footer>
            </body></html>"#,
        );
        assert!(text.contains("Article body."), "main content kept: {text}");
        for boilerplate in ["SITE HEADER", "NAV LINKS", "SIDEBAR", "FOOTER"] {
            assert!(
                !text.contains(boilerplate),
                "boilerplate '{boilerplate}' leaked through: {text}"
            );
        }
    }

    #[test]
    fn still_skips_script_and_style() {
        // Regression guard for the original skip list.
        let text = body_text(
            r#"<html><body>
                <p>Hello.</p>
                <script>console.log("nope")</script>
                <style>.x { color: red }</style>
            </body></html>"#,
        );
        assert!(text.contains("Hello."));
        assert!(!text.contains("console.log"));
        assert!(!text.contains("color: red"));
    }

    #[test]
    fn command_proxy_overrides_global_proxy() {
        let proxy = merge_proxy(
            Some("http://global.example:8080".to_string()),
            Some("socks5://127.0.0.1:1080".to_string()),
        );

        assert_eq!(proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
    }

    #[test]
    fn global_proxy_is_used_when_command_proxy_is_absent() {
        let proxy = merge_proxy(Some("http://global.example:8080".to_string()), None);

        assert_eq!(proxy.as_deref(), Some("http://global.example:8080"));
    }
}
