// SPDX-License-Identifier: Apache-2.0
//! A stand-in for `llama-server`, for the supervisor's integration tests.
//!
//! It accepts the real command line, answers the endpoints the supervisor uses
//! (`/health`, `/tokenize`, `/lora-adapters`, `/props`) and can be told, through
//! two extra arguments a test puts in the spec's `extra_args`, to load slowly or
//! to die during startup — the behaviours a supervisor has to cope with,
//! reproduced without a GPU or a model file.
//!
//! - `--fake-load-ms N` — `/health` answers 503 for this long (default 0).
//! - `--fake-exit-code N` — print a loader error and exit with this code.
//!
//! Arguments rather than environment variables: tests run concurrently in one
//! process and must not share launch knobs.
//!
//! Standard library only: a test double must not drag a web framework in.

use std::{
    io::{BufRead as _, BufReader, Read as _, Write as _},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const HELP: &str = "\
usage: fake-llama-server [options]
-c,    --ctx-size N                     size of the prompt context
-fa,   --flash-attn [on|off|auto]       set Flash Attention use
-ctk,  --cache-type-k TYPE              KV cache data type for K
-ctv,  --cache-type-v TYPE              KV cache data type for V
-ncmoe, --n-cpu-moe N                   keep the MoE weights of the first N layers in the CPU
-ngl,  --n-gpu-layers N                 max. number of layers to store in VRAM
-fit,  --fit [on|off]                   whether to adjust unset arguments to fit in device memory
-fitt, --fit-target MiB                 target margin per device for --fit
--lora FNAME                            path to LoRA adapter
-m,    --model FNAME                    model path to load
-mm,   --mmproj FILE                    path to a multimodal projector file
-np,   --parallel N                     number of server slots
-a,    --alias STRING                   set model name aliases
--host HOST                             ip address to listen
--port PORT                             port to listen (default: 8080)
--no-webui                              disable the Web UI
--embedding, --embeddings               restrict to only support embedding use case
--rerank, --reranking                   enable reranking endpoint on server
--jinja, --no-jinja                     whether to use jinja template engine for chat
--lora-init-without-apply               load LoRA adapters without applying them
";

#[derive(Default)]
struct Shared {
    /// `(path, scale)` per adapter, in `--lora` order.
    lora: Vec<(String, f32)>,
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: \
         close\r\n\r\n{body}",
        body.len()
    );
}

/// Pull `"key": <number>` out of a flat JSON object, without a JSON parser.
fn number_field(object: &str, key: &str) -> Option<f32> {
    let rest = &object[object.find(&format!("\"{key}\""))? + key.len() + 2..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start();
    let end =
        rest.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-')).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn handle(mut stream: TcpStream, ready_at: Instant, args: &[String], shared: &Mutex<Shared>) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(clone) => clone,
        Err(_) => return,
    });
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            content_length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    if reader.read_exact(&mut body).is_err() {
        return;
    }
    let body = String::from_utf8_lossy(&body);

    let mut parts = request_line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    match (method, path) {
        ("GET", "/health") if Instant::now() < ready_at => {
            respond(
                &mut stream,
                "503 Service Unavailable",
                r#"{"error":{"message":"Loading model"}}"#,
            );
        },
        ("GET", "/health") => respond(&mut stream, "200 OK", r#"{"status":"ok"}"#),
        ("POST", "/tokenize") => {
            // One token per whitespace-separated word of the "content" value.
            let content = body
                .split_once("\"content\"")
                .and_then(|(_, rest)| rest.split_once('"'))
                .and_then(|(_, rest)| rest.rsplit_once('"'))
                .map_or("", |(content, _)| content);
            let tokens: Vec<String> =
                (0..content.split_whitespace().count()).map(|index| index.to_string()).collect();
            respond(&mut stream, "200 OK", &format!("{{\"tokens\":[{}]}}", tokens.join(",")));
        },
        ("GET", "/lora-adapters") => {
            let shared = shared.lock().expect("lock");
            let items: Vec<String> = shared
                .lora
                .iter()
                .enumerate()
                .map(|(id, (path, scale))| {
                    format!(
                        "{{\"id\":{id},\"path\":\"{}\",\"scale\":{scale}}}",
                        path.replace('\\', "/")
                    )
                })
                .collect();
            respond(&mut stream, "200 OK", &format!("[{}]", items.join(",")));
        },
        ("POST", "/lora-adapters") => {
            let mut shared = shared.lock().expect("lock");
            // llama-server semantics: adapters absent from the list are disabled.
            for (_, scale) in &mut shared.lora {
                *scale = 0.0;
            }
            for object in body.split('{').skip(1) {
                if let (Some(id), Some(scale)) =
                    (number_field(object, "id"), number_field(object, "scale"))
                    && let Some(entry) = shared.lora.get_mut(id as usize)
                {
                    entry.1 = scale;
                }
            }
            respond(&mut stream, "200 OK", "{\"success\":true}");
        },
        ("GET", "/props") => {
            let quoted: Vec<String> = args
                .iter()
                .map(|arg| format!("\"{}\"", arg.replace('\\', "/").replace('"', "'")))
                .collect();
            respond(
                &mut stream,
                "200 OK",
                &format!("{{\"fake\":true,\"args\":[{}]}}", quoted.join(",")),
            );
        },
        _ => respond(&mut stream, "404 Not Found", r#"{"error":{"message":"not found"}}"#),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help") {
        print!("{HELP}");
        return;
    }
    if args.iter().any(|arg| arg == "--version") {
        eprintln!("version: 0.0.0-fake (build 0)");
        return;
    }

    let value_of = |flag: &str| {
        args.iter().position(|arg| arg == flag).and_then(|index| args.get(index + 1)).cloned()
    };
    let port: u16 = value_of("--port").and_then(|port| port.parse().ok()).unwrap_or(8080);
    let host = value_of("--host").unwrap_or_else(|| "127.0.0.1".to_string());

    if let Some(code) = value_of("--fake-exit-code").and_then(|code| code.parse::<i32>().ok()) {
        eprintln!("llama_model_load: error loading model: unknown model architecture: 'fake'");
        std::process::exit(code);
    }

    let load = value_of("--fake-load-ms").and_then(|ms| ms.parse().ok()).unwrap_or(0u64);
    let ready_at = Instant::now() + Duration::from_millis(load);

    let applied = !args.iter().any(|arg| arg == "--lora-init-without-apply");
    let lora = args
        .iter()
        .enumerate()
        .filter(|(_, arg)| *arg == "--lora")
        .filter_map(|(index, _)| args.get(index + 1))
        .map(|path| (path.clone(), if applied { 1.0 } else { 0.0 }))
        .collect();
    let shared = Arc::new(Mutex::new(Shared { lora }));

    let listener = match TcpListener::bind((host.as_str(), port)) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "main: couldn't bind HTTP server socket, hostname: {host}, port: {port} ({error})"
            );
            std::process::exit(1);
        },
    };
    eprintln!("main: fake server is listening on http://{host}:{port}");

    let args = Arc::new(args);
    for stream in listener.incoming().flatten() {
        let (args, shared) = (args.clone(), shared.clone());
        std::thread::spawn(move || handle(stream, ready_at, &args, &shared));
    }
}
