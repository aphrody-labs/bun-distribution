// SPDX-License-Identifier: Apache-2.0
//! Native in-process Koharu engine for Aphrody OS.
//!
//! Provides direct in-process execution of all Koharu document, pipeline,
//! project, canvas, and translation operations without spawning external subprocesses.

use std::sync::Arc;

use koharu_library::Service;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, mpsc};

pub const EVENT: &str = "koharu://event";
pub const BACKEND_EVENT: &str = "koharu://backend";

pub struct KoharuBroker {
    app: AppHandle,
    service: Arc<Mutex<Option<Service>>>,
}

impl KoharuBroker {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            service: Arc::new(Mutex::new(None)),
        }
    }

    async fn ensure_service(&self) -> Result<(), String> {
        let mut guard = self.service.lock().await;
        if guard.is_none() {
            let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
            let app = self.app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = app.emit_to("main", BACKEND_EVENT, json!({ "state": "started" }));
                while let Some(event) = rx.recv().await {
                    let _ = app.emit_to("main", EVENT, event);
                }
                let _ = app.emit_to("main", BACKEND_EVENT, json!({ "state": "exited" }));
            });
            let service = Service::new(tx).map_err(|error| error.to_string())?;
            *guard = Some(service);
        }
        Ok(())
    }

    pub async fn call(&self, method: String, params: Value) -> Result<Value, String> {
        if method.trim().is_empty() {
            return Err("Koharu method must not be empty".into());
        }
        if !params.is_object() {
            return Err("Koharu params must be an object".into());
        }
        self.ensure_service().await?;
        let mut guard = self.service.lock().await;
        let service = guard.as_mut().expect("service was initialized");
        service
            .call(&method, params)
            .await
            .map_err(|error| format!("{error:#}"))
    }
}

#[tauri::command]
pub async fn koharu_rpc(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, KoharuBroker>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Koharu commands are only available from the main window".into());
    }
    broker.call(method, params).await
}
