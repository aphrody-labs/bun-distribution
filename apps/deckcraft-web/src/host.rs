// SPDX-License-Identifier: MIT OR Apache-2.0
//! Same-origin file bridge for DeckCraft hosted by WebOS or another parent page.
//!
//! `deckcraft:ready` announces the inbox, `deckcraft:open` supplies a presentation or media file,
//! and `deckcraft:save` returns every export that would otherwise be downloaded.

use deckcraft_ui_egui::Inbox;
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

#[derive(Clone)]
pub struct Bridge {
    window: web_sys::Window,
    parent: web_sys::Window,
    origin: String,
}

impl Bridge {
    pub fn new() -> Option<Self> {
        let window = web_sys::window()?;
        let parent = window.parent().ok().flatten()?;
        if js_sys::Object::is(&parent, &window) {
            return None;
        }
        let origin = window.location().origin().ok()?;
        Some(Self {
            window,
            parent,
            origin,
        })
    }

    pub fn listen(&self, inbox: Inbox, ctx: egui::Context) {
        let parent = self.parent.clone();
        let origin = self.origin.clone();
        let on_message = Closure::<dyn FnMut(web_sys::MessageEvent)>::new(
            move |event: web_sys::MessageEvent| {
                if event.origin() != origin
                    || !event
                        .source()
                        .is_some_and(|source| js_sys::Object::is(&source, &parent))
                {
                    return;
                }
                let data = event.data();
                if string(&data, "type").as_deref() != Some("deckcraft:open") {
                    return;
                }
                let name = string(&data, "name")
                    .filter(|name| !name.trim().is_empty())
                    .map(|name| name.chars().take(240).collect())
                    .unwrap_or_else(|| "Presentation.deckcraft".to_string());
                let Some(bytes) = bytes(&data) else { return };
                inbox
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .push((name, bytes));
                ctx.request_repaint();
            },
        );
        if self
            .window
            .add_event_listener_with_callback("message", on_message.as_ref().unchecked_ref())
            .is_ok()
        {
            on_message.forget();
        }
    }

    pub fn post_ready(&self) {
        self.send(&[
            ("type", "deckcraft:ready".into()),
            ("version", env!("CARGO_PKG_VERSION").into()),
        ]);
    }

    pub fn post_failed(&self, error: &str) {
        self.send(&[("type", "deckcraft:failed".into()), ("error", error.into())]);
    }

    pub fn save(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let name = std::path::Path::new(path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "Presentation.deckcraft".to_string());
        let buffer = js_sys::Uint8Array::from(bytes).buffer();
        let message = message(&[
            ("type", "deckcraft:save".into()),
            ("name", name.into()),
            ("bytes", buffer.clone().into()),
        ])
        .ok_or_else(|| "could not build the message".to_string())?;
        self.parent
            .post_message_with_transfer(&message, &self.origin, &js_sys::Array::of1(&buffer))
            .map_err(|error| error.as_string().unwrap_or_else(|| format!("{error:?}")))
    }

    fn send(&self, fields: &[(&str, JsValue)]) {
        if let Some(message) = message(fields) {
            let _ = self.parent.post_message(&message, &self.origin);
        }
    }
}

fn message(fields: &[(&str, JsValue)]) -> Option<js_sys::Object> {
    let message = js_sys::Object::new();
    for (key, value) in fields {
        js_sys::Reflect::set(&message, &JsValue::from_str(key), value).ok()?;
    }
    Some(message)
}

fn string(data: &JsValue, key: &str) -> Option<String> {
    js_sys::Reflect::get(data, &JsValue::from_str(key))
        .ok()?
        .as_string()
}

fn bytes(data: &JsValue) -> Option<Vec<u8>> {
    let bytes = js_sys::Reflect::get(data, &JsValue::from_str("bytes")).ok()?;
    if let Some(array) = bytes.dyn_ref::<js_sys::Uint8Array>() {
        Some(array.to_vec())
    } else if bytes.is_instance_of::<js_sys::ArrayBuffer>() {
        Some(js_sys::Uint8Array::new(&bytes).to_vec())
    } else {
        None
    }
}
