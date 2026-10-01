// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native JSON Lines endpoint for Bun and other non-Tauri clients.

use std::path::PathBuf;

use anyhow::{Context as _, Result};
use clap::Parser;
use koharu_library::Service;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader},
    sync::mpsc,
};

#[derive(Parser)]
#[command(about = "Koharu native SDK over stdio JSON Lines")]
struct Arguments {
    /// Absolute project directory. Defaults to the Koharu Documents directory.
    #[arg(long)]
    root: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Arguments::parse();
    let (output, mut outgoing) = mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(value) = outgoing.recv().await {
            stdout
                .write_all(serde_json::to_string(&value)?.as_bytes())
                .await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
        Ok::<(), anyhow::Error>(())
    });

    let mut service = Service::with_root(args.root, output)?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        let incoming = serde_json::from_str::<Value>(&line);
        let id = incoming
            .as_ref()
            .ok()
            .and_then(|value| value.get("id"))
            .cloned()
            .unwrap_or(Value::Null);
        let response = match incoming {
            Ok(request) => {
                let method = request.get("method").and_then(Value::as_str);
                match method {
                    Some(method) => match service
                        .call(
                            method,
                            request.get("params").cloned().unwrap_or_else(|| json!({})),
                        )
                        .await
                    {
                        Ok(result) => json!({"id": id, "result": result}),
                        Err(error) => json!({"id": id, "error": format!("{error:#}")}),
                    },
                    None => json!({"id": id, "error": "method must be a string"}),
                }
            }
            Err(error) => json!({"id": id, "error": format!("invalid JSON: {error}")}),
        };
        service
            .output
            .send(response)
            .context("SDK output channel closed")?;
    }

    if let Some(agent) = service.agent.take() {
        agent.control.cancel();
        agent.task.abort();
    }
    if let Some(login) = service.login.take() {
        login.control.cancel();
        login.task.abort();
    }
    if let Some(pipeline) = service.pipeline.take() {
        pipeline.stop.stop();
        pipeline.task.abort();
    }
    drop(service);
    writer.await??;
    Ok(())
}
