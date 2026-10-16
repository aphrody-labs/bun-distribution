// SPDX-License-Identifier: Apache-2.0
//! Native Windows OCR for the WinClean `computer_ocr` contract.

#[cfg(windows)]
use std::{fs, path::PathBuf};

use serde_json::Value;
#[cfg(windows)]
use serde_json::json;

/// Run Windows.Media.Ocr over the selected window image.
///
/// The capture is performed by `aphrody-capture`; recognition is performed by
/// the inbox Windows OCR engine (no cloud service or external executable).
pub fn computer_ocr(arguments: &Value) -> Result<Value, String> {
    #[cfg(windows)]
    {
        computer_ocr_windows(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        Err("computer_ocr is Windows-only".into())
    }
}

#[cfg(windows)]
fn computer_ocr_windows(arguments: &Value) -> Result<Value, String> {
    let format = arguments.get("format").and_then(Value::as_str).unwrap_or("json");
    if !format.eq_ignore_ascii_case("json") && !format.eq_ignore_ascii_case("markdown") {
        return Err("format must be json or markdown.".into());
    }
    let hwnd = arguments.get("windowHandle").and_then(Value::as_i64).unwrap_or(0);
    if hwnd < 0 {
        return Err("windowHandle must be a non-negative HWND".into());
    }
    let windows = aphrody_capture::list_detailed_windows();
    let window = if hwnd == 0 {
        windows.iter().find(|w| w.is_foreground)
    } else {
        windows.iter().find(|w| w.handle == hwnd as usize)
    };
    let window = window.ok_or_else(|| "target window was not found".to_owned())?;
    let png = aphrody_capture::capture_window_by_title(&window.title).map_err(|e| e.to_string())?;
    let source = image::load_from_memory(&png).map_err(|e| e.to_string())?;
    let image_width = source.width();
    let image_height = source.height();
    let max_dimension = 4_096u32;
    if image_width > max_dimension || image_height > max_dimension {
        return Err(format!(
            "The captured image is {image_width}x{image_height}; Windows OCR maximum is \
             {max_dimension}px. Resize the application window or crop it."
        ));
    }
    let x = nonnegative_i32(arguments, "regionX")? as u32;
    let y = nonnegative_i32(arguments, "regionY")? as u32;
    if x >= image_width || y >= image_height {
        return Err(format!(
            "OCR region origin ({x},{y}) is outside the image {image_width}x{image_height}."
        ));
    }
    let width = positive_or_remaining(arguments, "regionWidth", image_width - x);
    let height = positive_or_remaining(arguments, "regionHeight", image_height - y);
    if width == 0
        || height == 0
        || x.saturating_add(width) > image_width
        || y.saturating_add(height) > image_height
    {
        return Err(format!(
            "OCR region ({x},{y},{width},{height}) is outside the image \
             {image_width}x{image_height}."
        ));
    }
    let full = x == 0 && y == 0 && width == image_width && height == image_height;
    let cropped = source.crop_imm(x, y, width, height);
    let mut encoded = Vec::new();
    cropped
        .write_to(&mut std::io::Cursor::new(&mut encoded), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let (language, lines) =
        recognize(&encoded, arguments.get("language").and_then(Value::as_str), x, y, full)?;
    let text = lines
        .iter()
        .map(|line| line["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\r\n");
    let mut audio_path = Value::Null;
    let mut voice_error = Value::Null;
    if arguments.get("speak").and_then(Value::as_bool).unwrap_or(false) && !text.is_empty() {
        match crate::speech::computer_speak(
            &text,
            arguments.get("audioPath").and_then(Value::as_str),
        ) {
            Ok(value) => audio_path = value.get("audioPath").cloned().unwrap_or(Value::Null),
            Err(error) => voice_error = Value::String(error),
        }
    }
    let region = json!({"X":x,"Y":y,"Width":width,"Height":height,"IsFullImage":full});
    let mut document = json!({
        "Success": true, "Action":"computer_ocr", "Format":format.to_ascii_lowercase(),
        "Language":language, "ImageWidth":image_width, "ImageHeight":image_height,
        "Region":region, "Lines":lines, "Text":text, "SavedPath":Value::Null,
        "AudioPath":audio_path, "VoiceError":voice_error
    });
    if let Some(path) =
        arguments.get("outputPath").and_then(Value::as_str).filter(|p| !p.trim().is_empty())
    {
        let path = PathBuf::from(path);
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let output = if format.eq_ignore_ascii_case("markdown") {
            text.clone()
        } else {
            serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?
        };
        fs::write(&path, output).map_err(|e| e.to_string())?;
        document["SavedPath"] = Value::String(path.to_string_lossy().into_owned());
    }
    if format.eq_ignore_ascii_case("markdown") { Ok(Value::String(text)) } else { Ok(document) }
}

#[cfg(windows)]
fn nonnegative_i32(args: &Value, name: &str) -> Result<i32, String> {
    let n = args.get(name).and_then(Value::as_i64).unwrap_or(0);
    i32::try_from(n)
        .map_err(|_| format!("{name} must be a non-negative 32-bit integer"))
        .and_then(|n| if n >= 0 { Ok(n) } else { Err(format!("{name} must be non-negative")) })
}

#[cfg(windows)]
fn positive_or_remaining(args: &Value, name: &str, remaining: u32) -> u32 {
    match args.get(name).and_then(Value::as_i64) {
        Some(n) if n > 0 => u32::try_from(n).unwrap_or(u32::MAX),
        _ => remaining,
    }
}

#[cfg(windows)]
fn recognize(
    png: &[u8],
    requested: Option<&str>,
    ox: u32,
    oy: u32,
    relative: bool,
) -> Result<(String, Vec<Value>), String> {
    use windows::{
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
        core::HSTRING,
    };
    let initialized = unsafe {
        windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        )
    }
    .is_ok();
    let result = (|| {
        let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
        let writer =
            DataWriter::CreateDataWriter(&stream.GetOutputStreamAt(0).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        writer.WriteBytes(png).map_err(|e| e.to_string())?;
        pollster::block_on(writer.StoreAsync().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        writer.DetachStream().map_err(|e| e.to_string())?;
        stream.Seek(0).map_err(|e| e.to_string())?;
        let decoder =
            pollster::block_on(BitmapDecoder::CreateAsync(&stream).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let bitmap =
            pollster::block_on(decoder.GetSoftwareBitmapAsync().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let engine = match requested.filter(|v| !v.trim().is_empty()) {
            Some(tag) => OcrEngine::TryCreateFromLanguage(
                &Language::CreateLanguage(&HSTRING::from(tag.trim())).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?,
            None => OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| e.to_string())?,
        };
        let result = pollster::block_on(engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let language = engine
            .RecognizerLanguage()
            .map_err(|e| e.to_string())?
            .LanguageTag()
            .map_err(|e| e.to_string())?
            .to_string_lossy();
        let mut rows = Vec::new();
        for line in result.Lines().map_err(|e| e.to_string())? {
            let mut words = Vec::new();
            for word in line.Words().map_err(|e| e.to_string())? {
                let rect = word.BoundingRect().map_err(|e| e.to_string())?;
                let x = rect.X.round() as i32 + if relative { ox as i32 } else { 0 };
                let y = rect.Y.round() as i32 + if relative { oy as i32 } else { 0 };
                let text = word.Text().map_err(|e| e.to_string())?.to_string_lossy();
                words.push(json!({"Text":text,"X":x.max(0),"Y":y.max(0),"Width":(rect.Width.round() as i32).max(1),"Height":(rect.Height.round() as i32).max(1)}));
            }
            if words.is_empty() {
                continue;
            }
            let text = words
                .iter()
                .map(|v| v["Text"].as_str().unwrap_or_default())
                .collect::<Vec<_>>()
                .join(" ");
            let min_x = words.iter().map(|v| v["X"].as_i64().unwrap_or(0)).min().unwrap_or(0);
            let min_y = words.iter().map(|v| v["Y"].as_i64().unwrap_or(0)).min().unwrap_or(0);
            let max_x = words
                .iter()
                .map(|v| v["X"].as_i64().unwrap_or(0) + v["Width"].as_i64().unwrap_or(1))
                .max()
                .unwrap_or(min_x + 1);
            let max_y = words
                .iter()
                .map(|v| v["Y"].as_i64().unwrap_or(0) + v["Height"].as_i64().unwrap_or(1))
                .max()
                .unwrap_or(min_y + 1);
            rows.push(json!({"Text":text,"X":min_x,"Y":min_y,"Width":(max_x-min_x).max(1),"Height":(max_y-min_y).max(1),"Words":words}));
        }
        Ok((language, rows))
    })();
    if initialized {
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }
    result
}
