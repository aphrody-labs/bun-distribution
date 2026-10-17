//! Native Windows speech synthesis for the `computer_speak` contract.

use serde_json::Value;

/// Synthesize text with the installed Windows voice, export a WAV, and start
/// asynchronous playback using winmm. This keeps the same 32768-character
/// contract and result shape as the NativeAOT oracle.
#[cfg(windows)]
pub fn computer_speak(text: &str, requested_path: Option<&str>) -> Result<Value, String> {
    use std::{fs, os::windows::ffi::OsStrExt, path::PathBuf};

    use windows::{
        Media::SpeechSynthesis::SpeechSynthesizer,
        Storage::Streams::DataReader,
        Win32::{
            Foundation::HMODULE,
            Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME},
            System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize},
        },
        core::HSTRING,
    };

    if text.trim().is_empty() {
        return Err("text is required.".into());
    }
    if text.chars().count() > 32768 {
        return Err("text exceeds 32768 characters.".into());
    }

    // WinRT activation requires an initialized apartment. If the caller has
    // already selected another apartment, retain it and let WinRT use it.
    let initialized_here = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
    let result = (|| {
        let path = requested_path
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!(
                    "winclean-voice-{}-{}.wav",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or_default()
                ))
            });
        let path = if path.extension().is_none() {
            path.with_extension("wav")
        } else {
            path
        };
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let synthesizer = SpeechSynthesizer::new().map_err(|e| e.to_string())?;
        let stream = pollster::block_on(
            synthesizer
                .SynthesizeTextToStreamAsync(&HSTRING::from(text))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let size = stream
            .Size()
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "synthesized audio exceeds addressable memory".to_owned())?;
        let reader =
            DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        pollster::block_on(reader.LoadAsync(size).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut audio = vec![0; size as usize];
        reader.ReadBytes(&mut audio).map_err(|e| e.to_string())?;
        fs::write(&path, audio).map_err(|e| e.to_string())?;

        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let played = unsafe {
            PlaySoundW(
                windows::core::PCWSTR(wide.as_ptr()),
                Some(HMODULE::default()),
                SND_FILENAME | SND_ASYNC,
            )
            .as_bool()
        };
        if !played {
            return Err(format!(
                "PlaySound failed (error={}).",
                std::io::Error::last_os_error()
            ));
        }
        Ok(serde_json::json!({
            "success": true,
            "action": "computer_speak",
            "audioPath": path,
            "played": true
        }))
    })();
    if initialized_here {
        unsafe { CoUninitialize() };
    }
    result
}

#[cfg(not(windows))]
pub fn computer_speak(_text: &str, _requested_path: Option<&str>) -> Result<Value, String> {
    Err("computer_speak is Windows-only".into())
}
