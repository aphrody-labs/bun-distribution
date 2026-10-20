// SPDX-License-Identifier: MIT OR Apache-2.0
//! Same-origin open/save bridge for PhotoCraft hosted as a WebOS app window.

use photocraft_ui_egui::Inbox;
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

const MAX_FILE_BYTES: u32 = 64 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 240;

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
                if string(&data, "type").as_deref() != Some("photocraft:open") {
                    return;
                }
                let name = string(&data, "name")
                    .map(|name| safe_file_name(&name))
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| "Image.pcraft".to_string());
                let Some(bytes) = byte_array(&data) else {
                    return;
                };
                if bytes.length() > MAX_FILE_BYTES {
                    return;
                }
                inbox
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .push((name, bytes.to_vec()));
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
            ("type", "photocraft:ready".into()),
            ("version", env!("CARGO_PKG_VERSION").into()),
        ]);
    }

    pub fn post_failed(&self, error: &str) {
        self.send(&[("type", "photocraft:failed".into()), ("error", error.into())]);
    }

    pub fn save(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > MAX_FILE_BYTES as usize {
            return Err("PhotoCraft save exceeds the 64 MiB WebOS bridge limit".into());
        }
        let name = path
            .rsplit(['/', '\\'])
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or("Image.pcraft");
        let buffer = js_sys::Uint8Array::from(bytes).buffer();
        let message = message(&[
            ("type", "photocraft:save".into()),
            ("name", safe_file_name(name).into()),
            ("bytes", buffer.clone().into()),
        ])
        .ok_or_else(|| "could not build the PhotoCraft save message".to_string())?;
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

fn byte_array(data: &JsValue) -> Option<js_sys::Uint8Array> {
    let bytes = js_sys::Reflect::get(data, &JsValue::from_str("bytes")).ok()?;
    if let Some(array) = bytes.dyn_ref::<js_sys::Uint8Array>() {
        Some(array.clone())
    } else if bytes.is_instance_of::<js_sys::ArrayBuffer>() {
        Some(js_sys::Uint8Array::new(&bytes))
    } else {
        None
    }
}

fn safe_file_name(name: &str) -> String {
    let safe = name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_NAME_CHARS)
        .collect::<String>();
    if safe == "." || safe == ".." {
        String::new()
    } else {
        safe
    }
}
