// SPDX-License-Identifier: Apache-2.0
//! UI Automation control-view snapshots for the WinClean compatibility surface.
//!
//! The NativeAOT oracle walks descendants of an explicit HWND (or the current
//! foreground window) with the UIA control-view walker.  This module keeps the
//! same bounded, best-effort contract in-process.  UIA properties are read
//! independently so a provider returning one failing property does not discard
//! the rest of the element.

use crate::SubsystemError;
use serde_json::Value;

#[cfg(windows)]
fn failed(error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(error.to_string())
}

/// Capture the UIA control-view descendants for the requested window.
pub fn capture(arguments: &Value) -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        capture_windows(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        Err(SubsystemError::Failed("snapshot is Windows-only".into()))
    }
}

#[cfg(windows)]
fn capture_windows(arguments: &Value) -> Result<Value, SubsystemError> {
    let max_elements = arguments
        .get("maxElements")
        .and_then(Value::as_i64)
        .unwrap_or(200)
        .clamp(1, 1000) as usize;
    let requested = arguments
        .get("windowHandle")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if requested < 0 {
        return Err(SubsystemError::InvalidArguments(
            "snapshot windowHandle must be a non-negative HWND".into(),
        ));
    }

    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow},
    };

    let hwnd = if requested == 0 {
        unsafe { GetForegroundWindow() }
    } else {
        HWND(requested as *mut std::ffi::c_void)
    };
    if hwnd.0.is_null() {
        return Ok(envelope(0, String::new(), Vec::new(), false));
    }
    if requested != 0 && !unsafe { IsWindow(Some(hwnd)).as_bool() } {
        return Ok(envelope(requested, String::new(), Vec::new(), false));
    }

    let window_handle = hwnd.0 as isize as i64;
    let title = window_title(hwnd);
    let elements = walk_uia(hwnd, max_elements).map_err(failed)?;
    let truncated = elements.len() >= max_elements;
    Ok(envelope(window_handle, title, elements, truncated))
}

/// Resolve a UI Automation selector and click the matching element.
///
/// The traversal and property extraction intentionally share the snapshot
/// implementation.  This keeps selector ordering identical to the NativeAOT
/// oracle and avoids a second, subtly different UIA tree walker.
pub fn click_element(arguments: &Value) -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        click_element_windows(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        Err(SubsystemError::Failed(
            "computer_click_element is Windows-only".into(),
        ))
    }
}

/// Click each comma-separated UIA `Name` resolved from one fresh foreground
/// snapshot.  Name matching is exact after trimming, but case-insensitive to
/// match the WinClean tool contract.  The requested labels are retained in the
/// result so callers can correlate successful and unresolved entries.
pub fn multi_select(arguments: &Value) -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        multi_select_windows(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        Err(SubsystemError::Failed(
            "multi_select is Windows-only".into(),
        ))
    }
}

/// Click, clear and type the same text into each comma-separated UIA `Name`
/// resolved from one fresh foreground snapshot.
pub fn multi_edit(arguments: &Value) -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        multi_edit_windows(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        Err(SubsystemError::Failed("multi_edit is Windows-only".into()))
    }
}

#[cfg(windows)]
fn multi_labels(arguments: &Value, tool: &str) -> Result<Vec<String>, SubsystemError> {
    let labels = arguments
        .get("labels")
        .and_then(Value::as_str)
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires labels")))?;
    let labels = labels
        .split(',')
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if labels.is_empty() {
        return Err(SubsystemError::InvalidArguments(
            "labels list is empty".into(),
        ));
    }
    Ok(labels)
}

#[cfg(windows)]
fn foreground_elements() -> Result<Vec<Value>, SubsystemError> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Err(SubsystemError::Failed(
            "No foreground window is available.".into(),
        ));
    }
    walk_uia(hwnd, 1000).map_err(failed)
}

#[cfg(windows)]
fn resolve_multi_labels(
    labels: &[String],
    elements: &[Value],
) -> (Vec<(String, i32, i32)>, Vec<String>) {
    let mut resolved = Vec::with_capacity(labels.len());
    let mut not_found = Vec::with_capacity(labels.len());
    for label in labels {
        let hit = elements.iter().find(|element| {
            element
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name == label || name.eq_ignore_ascii_case(label))
        });
        if let Some(element) = hit {
            let x = element.get("x").and_then(Value::as_i64).unwrap_or_default();
            let y = element.get("y").and_then(Value::as_i64).unwrap_or_default();
            let width = element
                .get("width")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                .max(1);
            let height = element
                .get("height")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                .max(1);
            resolved.push((
                label.clone(),
                (x + width / 2) as i32,
                (y + height / 2) as i32,
            ));
        } else {
            not_found.push(label.clone());
        }
    }
    (resolved, not_found)
}

#[cfg(windows)]
fn multi_select_windows(arguments: &Value) -> Result<Value, SubsystemError> {
    let labels = multi_labels(arguments, "multi_select")?;
    let elements = foreground_elements()?;
    let (resolved, not_found) = resolve_multi_labels(&labels, &elements);
    let mut clicked = Vec::with_capacity(resolved.len());
    for (label, x, y) in resolved {
        aphrody_capture::mouse_move(x, y).map_err(failed)?;
        aphrody_capture::mouse_click("left", 1).map_err(failed)?;
        std::thread::sleep(std::time::Duration::from_millis(50));
        clicked.push(label);
    }
    Ok(serde_json::json!({"clicked": clicked, "notFound": not_found}))
}

#[cfg(windows)]
fn multi_edit_windows(arguments: &Value) -> Result<Value, SubsystemError> {
    let labels = multi_labels(arguments, "multi_edit")?;
    let text = arguments
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| SubsystemError::InvalidArguments("multi_edit requires text".into()))?;
    if text.chars().count() > 4096 {
        return Err(SubsystemError::InvalidArguments(
            "text exceeds 4096 chars per call".into(),
        ));
    }
    let elements = foreground_elements()?;
    let (resolved, not_found) = resolve_multi_labels(&labels, &elements);
    let mut edited = Vec::with_capacity(resolved.len());
    for (label, x, y) in resolved {
        aphrody_capture::mouse_move(x, y).map_err(failed)?;
        aphrody_capture::mouse_click("left", 1).map_err(failed)?;
        aphrody_capture::key_shortcut("ctrl+a").map_err(failed)?;
        aphrody_capture::key_shortcut("delete").map_err(failed)?;
        aphrody_capture::type_unicode(text).map_err(failed)?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        edited.push(label);
    }
    Ok(serde_json::json!({"edited": edited, "notFound": not_found}))
}

#[cfg(windows)]
fn click_element_windows(arguments: &Value) -> Result<Value, SubsystemError> {
    let selectors = ["automationId", "name", "className", "controlType"];
    if !selectors.iter().any(|key| {
        arguments
            .get(*key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    }) {
        return Err(SubsystemError::InvalidArguments(
            "Provide automationId, name, className or controlType.".into(),
        ));
    }

    let requested = arguments
        .get("windowHandle")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if requested < 0 {
        return Err(SubsystemError::InvalidArguments(
            "computer_click_element windowHandle must be a non-negative HWND".into(),
        ));
    }
    let occurrence = arguments
        .get("occurrence")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    if occurrence < -1 || occurrence > i32::MAX as i64 {
        return Ok(error_json(
            "occurrence must be -1 or a non-negative match index.",
        ));
    }

    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow},
    };
    let hwnd = if requested == 0 {
        unsafe { GetForegroundWindow() }
    } else {
        HWND(requested as *mut std::ffi::c_void)
    };
    if hwnd.0.is_null() {
        return Ok(error_json("No foreground window is available."));
    }
    if !unsafe { IsWindow(Some(hwnd)).as_bool() } {
        return Ok(error_json(&format!(
            "HWND {requested} is not a valid window."
        )));
    }

    let elements = walk_uia_elements(hwnd, 1000).map_err(failed)?;
    let matches = elements
        .into_iter()
        .enumerate()
        .filter_map(|(id, element)| {
            let value = element_value(&element, id as i64);
            matches_selector(&value, arguments).then_some((element, value))
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return Ok(error_json("No UI Automation element matched the selector."));
    }
    if occurrence >= matches.len() as i64 {
        return Ok(error_json(&format!(
            "occurrence must be -1 or in [0,{}].",
            matches.len() - 1
        )));
    }
    if matches.len() > 1 && occurrence < 0 {
        let candidates = matches
            .iter()
            .enumerate()
            .map(|(index, (_, value))| {
                serde_json::json!({
                    "occurrence": index,
                    "id": value.get("id").and_then(Value::as_i64).unwrap_or_default(),
                    "name": value.get("name").and_then(Value::as_str).unwrap_or_default(),
                    "automationId": value.get("automationId").and_then(Value::as_str).unwrap_or_default(),
                    "controlType": value.get("controlType").and_then(Value::as_str).unwrap_or_default(),
                })
            })
            .collect::<Vec<_>>();
        return Ok(serde_json::json!({
            "success": false,
            "action": "computer_click_element",
            "error": "multiple matches; set occurrence",
            "count": matches.len(),
            "candidates": candidates,
        }));
    }

    let index = if occurrence < 0 {
        0
    } else {
        occurrence as usize
    };
    let (_element, value) = &matches[index];
    let enabled = value
        .get("isEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let offscreen = value
        .get("isOffscreen")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return Ok(error_json("The matching element is disabled."));
    }
    if offscreen {
        return Ok(error_json("The matching element is off-screen."));
    }

    if arguments
        .get("activate")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        aphrody_capture::switch_to_window(hwnd.0 as usize).map_err(failed)?;
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let x = value.get("x").and_then(Value::as_i64).unwrap_or_default();
    let y = value.get("y").and_then(Value::as_i64).unwrap_or_default();
    let width = value
        .get("width")
        .and_then(Value::as_i64)
        .unwrap_or_default()
        .max(1);
    let height = value
        .get("height")
        .and_then(Value::as_i64)
        .unwrap_or_default()
        .max(1);
    let click_x = x + width / 2;
    let click_y = y + height / 2;
    aphrody_capture::mouse_move(click_x as i32, click_y as i32).map_err(failed)?;
    aphrody_capture::mouse_click("left", 1).map_err(failed)?;
    Ok(serde_json::json!({
        "success": true,
        "action": "computer_click_element",
        "element": value,
        "click": {"success": true, "action": "computer_click", "screenX": click_x, "screenY": click_y, "button": "left", "clicks": 1},
    }))
}

#[cfg(windows)]
fn error_json(message: &str) -> Value {
    serde_json::json!({"success":false,"action":"computer_click_element","error":message})
}

#[cfg(windows)]
fn matches_selector(value: &Value, arguments: &Value) -> bool {
    ["automationId", "name", "className", "controlType"]
        .iter()
        .all(|key| {
            let Some(expected) = arguments.get(*key).and_then(Value::as_str) else {
                return true;
            };
            let Some(actual) = value.get(*key).and_then(Value::as_str) else {
                return false;
            };
            expected.trim().is_empty() || actual.eq_ignore_ascii_case(expected.trim())
        })
}

#[cfg(windows)]
fn window_title(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};

    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
}

#[cfg(windows)]
fn walk_uia(
    hwnd: windows::Win32::Foundation::HWND,
    max_elements: usize,
) -> Result<Vec<Value>, uiautomation::Error> {
    Ok(walk_uia_elements(hwnd, max_elements)?
        .iter()
        .enumerate()
        .map(|(id, element)| element_value(element, id as i64))
        .collect())
}

#[cfg(windows)]
fn walk_uia_elements(
    hwnd: windows::Win32::Foundation::HWND,
    max_elements: usize,
) -> Result<Vec<uiautomation::UIElement>, uiautomation::Error> {
    use uiautomation::{UIAutomation, types::Handle};

    let automation = UIAutomation::new()?;
    let root = automation.element_from_handle(Handle::from(hwnd.0 as isize))?;
    let walker = automation.get_control_view_walker()?;
    let mut pending = Vec::new();
    if let Ok(first) = walker.get_first_child(&root) {
        pending.push(first);
    }
    let mut elements = Vec::with_capacity(max_elements.min(64));
    while let Some(element) = pending.pop() {
        if elements.len() >= max_elements {
            break;
        }
        elements.push(element.clone());
        // Push sibling before child: the LIFO stack then visits the child
        // depth-first, while preserving the native walker's control-view order.
        if let Ok(sibling) = walker.get_next_sibling(&element) {
            pending.push(sibling);
        }
        if let Ok(child) = walker.get_first_child(&element) {
            pending.push(child);
        }
    }
    Ok(elements)
}

#[cfg(windows)]
fn element_value(element: &uiautomation::UIElement, id: i64) -> Value {
    let name = element.get_name().unwrap_or_default();
    let control_type = element
        .get_localized_control_type()
        .or_else(|_| element.get_control_type().map(|value| format!("{value:?}")))
        .unwrap_or_default();
    let automation_id = element.get_automation_id().unwrap_or_default();
    let class_name = element.get_classname().unwrap_or_default();
    let framework_id = element.get_framework_id().unwrap_or_default();
    let rect = element.get_bounding_rectangle().ok();
    let (x, y, width, height) = rect
        .map(|value| {
            (
                value.get_left(),
                value.get_top(),
                value.get_right().saturating_sub(value.get_left()),
                value.get_bottom().saturating_sub(value.get_top()),
            )
        })
        .unwrap_or_default();
    let native_window_handle = element
        .get_native_window_handle()
        .ok()
        .map(|value| {
            let raw: isize = value.into();
            raw as i64
        })
        .unwrap_or_default();

    serde_json::json!({
        "id": id,
        "name": name,
        "controlType": control_type,
        "automationId": automation_id,
        "className": class_name,
        "frameworkId": framework_id,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "isEnabled": element.is_enabled().unwrap_or(false),
        "hasKeyboardFocus": element.has_keyboard_focus().unwrap_or(false),
        "isOffscreen": element.is_offscreen().unwrap_or(false),
        "nativeWindowHandle": native_window_handle,
    })
}

#[cfg(windows)]
fn envelope(
    window_handle: i64,
    window_title: String,
    elements: Vec<Value>,
    truncated: bool,
) -> Value {
    serde_json::json!({
        "windowHandle": window_handle,
        "windowTitle": window_title,
        "count": elements.len(),
        "truncated": truncated,
        "elements": elements,
    })
}
