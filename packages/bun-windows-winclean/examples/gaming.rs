// SPDX-License-Identifier: Apache-2.0
//! Gaming profile driver.
//!
//! - `gaming status`  : read-only gaming optimisation report and the owner apply command.
//! - `gaming capture <title>` : GPU capture, frame pacing and capture throughput of a window
//!   (read-only, no input).
//! - `gaming scratch` : live proof on a scratch window this example owns (no user document):
//!   capture fps while typing, observe, click, scan-code keys, raw mouse deltas, then closes it.
//! - `gaming call <tool> [json]` : runs one catalog tool.
//! - `gaming apply`   : applies the pending profile items (owner only; changes Windows settings).

use serde_json::{Value, json};

fn call(tool: &str, args: Value) -> Value {
    let runtime = bun_windows_winclean::Winclean::load().expect("winclean");
    let raw = runtime.call_raw(tool, &args.to_string()).expect("call");
    let result: Value = serde_json::from_str(&raw).expect("result json");
    if result["isError"].as_bool().unwrap_or(false) {
        eprintln!("{tool}: ERROR {}", result["content"]);
        return Value::Null;
    }
    result["structuredContent"].clone()
}

fn strip_image(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.remove("image");
    }
    value
}

fn print(label: &str, value: &Value) {
    println!(
        "== {label}\n{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

fn status() {
    for tool in [
        "gaming_environment",
        "gaming_get_game_mode",
        "get_hags_mode",
        "get_active_power_plan",
        "gaming_get_background_apps",
        "gaming_get_game_bar_capture",
        "gaming_get_timer_resolution",
        "gaming_get_gpu_info",
    ] {
        print(tool, &call(tool, json!({})));
    }
    let profile = call("gaming_profile_status", json!({}));
    print("pending", &profile["pending"]);
    print("applyCommand", &profile["applyCommand"]);
}

fn window_by_title(needle: &str) -> Option<(u64, String)> {
    let windows = call("list_windows", json!({}));
    windows["Windows"].as_array()?.iter().find_map(|w| {
        let title = w["Title"].as_str()?;
        let handle = w["Handle"].as_u64()?;
        title
            .to_lowercase()
            .contains(&needle.to_lowercase())
            .then(|| (handle, title.to_owned()))
    })
}

fn capture(needle: &str) {
    let Some((hwnd, title)) = window_by_title(needle) else {
        eprintln!("no window title contains {needle}");
        return;
    };
    println!("target: {hwnd} {title}");
    let shot = call(
        "gaming_capture_window",
        json!({"hwnd": hwnd, "outputPath": std::env::temp_dir().join("gaming-capture.png")}),
    );
    print("gaming_capture_window", &strip_image(shot));
    print(
        "gaming_frame_pacing",
        &call(
            "gaming_frame_pacing",
            json!({"hwnd": hwnd, "durationMs": 3000}),
        ),
    );
    print(
        "gaming_capture_benchmark",
        &call(
            "gaming_capture_benchmark",
            json!({"hwnd": hwnd, "durationMs": 3000}),
        ),
    );
}

/// Scratch target owned by this example: a WinForms window with one text box, in its own
/// PowerShell process. It holds no user document; on close it writes the received text to a
/// temporary file so the proof can read what the keys produced.
const SCRATCH_TITLE: &str = "bun-gaming-scratch";

fn scratch() {
    let output = std::env::temp_dir().join("bun-gaming-scratch.txt");
    let _ = std::fs::remove_file(&output);
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; \
         $f.Text = '{SCRATCH_TITLE}'; $f.Width = 1000; $f.Height = 640; \
         $t = New-Object Windows.Forms.TextBox; $t.Multiline = $true; $t.Dock = 'Fill'; \
         $t.Font = New-Object Drawing.Font('Consolas', 14); $f.Controls.Add($t); \
         $f.Add_Shown({{ $f.Activate(); $t.Focus() }}); \
         $f.Add_FormClosing({{ [IO.File]::WriteAllText('{}', $t.Text); [IO.File]::WriteAllText('{}.reason', [string]$_.CloseReason) }}); [void]$f.ShowDialog()",
        output.display(),
        output.display()
    );
    let mut child = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .spawn()
        .expect("start scratch window");
    let mut target = None;
    for _ in 0..150 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        target = window_by_title(SCRATCH_TITLE);
        if target.is_some() {
            break;
        }
    }
    let Some((hwnd, title)) = target else {
        eprintln!("scratch window did not appear");
        let _ = child.kill();
        return;
    };
    println!("scratch window: {hwnd} {title}");
    std::thread::sleep(std::time::Duration::from_millis(500));
    let guard = json!({"title": SCRATCH_TITLE});
    let with = |extra: Value| {
        let mut args = guard.clone();
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        args
    };

    let observed = call(
        "computer_observe",
        json!({"windowHandle": hwnd, "includeUiTree": false}),
    );
    print(
        "computer_observe",
        &json!({"window": observed["window"], "text": observed["text"]}),
    );
    let width = observed["window"]["Width"].as_i64().unwrap_or(800);
    let height = observed["window"]["Height"].as_i64().unwrap_or(600);
    print(
        "computer_click",
        &call(
            "computer_click",
            json!({"windowHandle": hwnd, "x": width / 2, "y": height / 2}),
        ),
    );

    // Frame pacing and capture throughput while a typing thread changes the window content.
    let typist = move |duration_ms: u64| {
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            let mut sent = 0;
            while started.elapsed().as_millis() < u128::from(duration_ms) {
                let key = if sent % 8 == 7 { "space" } else { "x" };
                if call(
                    "gaming_key",
                    json!({"title": SCRATCH_TITLE, "key": key, "action": "tap", "holdMs": 4}),
                )
                .is_null()
                {
                    break;
                }
                sent += 1;
                std::thread::sleep(std::time::Duration::from_millis(12));
            }
            sent
        })
    };
    let typing = typist(3200);
    print(
        "gaming_frame_pacing (typing)",
        &call(
            "gaming_frame_pacing",
            json!({"hwnd": hwnd, "durationMs": 3000}),
        ),
    );
    println!("keys typed: {}", typing.join().unwrap_or(0));
    let typing = typist(3200);
    print(
        "gaming_capture_benchmark (typing)",
        &call(
            "gaming_capture_benchmark",
            json!({"hwnd": hwnd, "durationMs": 3000}),
        ),
    );
    println!("keys typed: {}", typing.join().unwrap_or(0));
    print(
        "gaming_frame_pacing (idle)",
        &call(
            "gaming_frame_pacing",
            json!({"hwnd": hwnd, "durationMs": 1000}),
        ),
    );
    let shot = call(
        "gaming_capture_window",
        json!({"hwnd": hwnd, "outputPath": std::env::temp_dir().join("gaming-scratch.png")}),
    );
    print("gaming_capture_window", &strip_image(shot));

    // Keys, sequence, raw deltas and a click, all behind the foreground guard.
    print(
        "gaming_key enter",
        &call("gaming_key", with(json!({"key": "enter", "action": "tap"}))),
    );
    print(
        "computer_type",
        &call(
            "computer_type",
            json!({"windowHandle": hwnd, "text": "typed", "x": width / 2, "y": height / 2}),
        ),
    );
    print(
        "gaming_input_sequence",
        &call(
            "gaming_input_sequence",
            with(json!({"events": [
                {"type": "key", "key": "enter", "atMs": 0},
                {"type": "key", "key": "shift", "action": "down", "atMs": 16},
                {"type": "key", "key": "g", "atMs": 24},
                {"type": "key", "key": "shift", "action": "up", "atMs": 40},
                {"type": "key", "key": "1", "atMs": 48},
                {"type": "move", "dx": 40, "dy": 0, "atMs": 56},
                {"type": "move", "dx": -40, "dy": 0, "atMs": 64},
            ]})),
        ),
    );
    print(
        "gaming_mouse_delta",
        &call(
            "gaming_mouse_delta",
            with(json!({"dx": 300, "dy": 150, "steps": 300, "rateHz": 1000})),
        ),
    );
    print(
        "gaming_mouse_delta back",
        &call(
            "gaming_mouse_delta",
            with(json!({"dx": -300, "dy": -150, "steps": 300, "rateHz": 1000})),
        ),
    );
    print(
        "gaming_mouse_button",
        &call(
            "gaming_mouse_button",
            with(json!({"button": "left", "action": "click"})),
        ),
    );
    std::thread::sleep(std::time::Duration::from_millis(300));
    print(
        "observe after input",
        &call(
            "computer_observe",
            json!({"windowHandle": hwnd, "includeUiTree": false}),
        )["window"],
    );

    // WM_CLOSE: the form writes the text box to the temporary file and exits; no prompt exists.
    call("window_close", json!({"hwnd": hwnd}));
    let _ = child.wait();
    let text = std::fs::read_to_string(&output).unwrap_or_default();
    let x_count = text.matches('x').count();
    println!(
        "scratch text: {} chars, {x_count} 'x', tail {:?}",
        text.chars().count(),
        text.chars()
            .rev()
            .take(24)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>()
    );
    let reason_path = format!("{}.reason", output.display());
    println!(
        "close reason: {}",
        std::fs::read_to_string(&reason_path).unwrap_or_default()
    );
    let _ = std::fs::remove_file(&output);
    let _ = std::fs::remove_file(&reason_path);
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("scratch") => scratch(),
        Some("capture") => capture(&std::env::args().nth(2).unwrap_or_else(|| "steam".into())),
        Some("call") => {
            let tool = std::env::args().nth(2).expect("tool name");
            let args = std::env::args()
                .nth(3)
                .map_or(json!({}), |a| serde_json::from_str(&a).expect("json args"));
            print(&tool, &strip_image(call(&tool, args)));
        }
        Some("apply") => print(
            "gaming_profile_apply",
            &call("gaming_profile_apply", json!({"confirm": true})),
        ),
        _ => status(),
    }
}
