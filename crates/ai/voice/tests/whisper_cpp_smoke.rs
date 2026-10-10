// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! End-to-end smoke test for the driven whisper.cpp backend.
//!
//! This is the test that would have caught a backend that compiles, resolves
//! its binary, spawns cleanly — and returns an empty transcript. It needs real
//! weights and a real binary, so it **skips** (rather than fails) when the
//! machine has neither:
//!
//! ```text
//! aphrody model pull whisper-base-en
//! # whisper.cpp release unpacked under ~/.aphrody/runtimes/whisper-<tag>/
//! APHRODY_WHISPER_SMOKE_WAV=path/to/speech.wav cargo test -p aphrody-voice --test whisper_cpp_smoke
//! ```
//!
//! Skipping on a bare machine is deliberate: a hard failure there would train
//! everyone to ignore this test, which is worse than not having it.

use aphrody_voice::stt::{SttOptions, SttProvider as _, whisper_cpp::WhisperCppBackend};

/// A 16 kHz mono WAV of speech, supplied by the caller.
///
/// No audio is vendored into the repository: a fixture large enough to be
/// worth transcribing is not something to carry in git.
const WAV_ENV: &str = "APHRODY_WHISPER_SMOKE_WAV";

#[tokio::test]
async fn transcribes_real_speech_with_timed_segments() {
    let backend = WhisperCppBackend::new("whisper-base-en");

    let (binary, weights) = match backend.probe() {
        Ok(pair) => pair,
        Err(err) => {
            eprintln!("skipped: whisper.cpp backend unavailable on this machine: {err}");
            return;
        },
    };
    eprintln!("binary  {} ({})", binary.path().display(), binary.label());
    eprintln!("weights {}", weights.display());

    let Some(wav_path) = std::env::var_os(WAV_ENV) else {
        eprintln!("skipped: set {WAV_ENV} to a 16 kHz mono WAV of speech");
        return;
    };
    let audio = std::fs::read(&wav_path).expect("the WAV named by the env var must be readable");

    let transcript = backend
        .transcribe(&audio, SttOptions::default())
        .await
        .expect("transcription must succeed once binary and weights are both present");

    eprintln!("transcript: {}", transcript.text);
    assert!(!transcript.text.trim().is_empty(), "speech must not transcribe to nothing");
    assert!(!transcript.segments.is_empty(), "a non-empty transcript must carry its segments");

    // Timestamps must advance: a backend that returns every segment at 0.0 is
    // the failure mode a text-only assertion would not see.
    let last = transcript.segments.last().expect("checked non-empty above");
    assert!(last.end > 0.0, "segment end offsets must be populated, got {last:?}");
    for pair in transcript.segments.windows(2) {
        assert!(
            pair[1].start >= pair[0].start,
            "segments must be ordered in time: {:?} then {:?}",
            pair[0],
            pair[1]
        );
    }
    assert!(transcript.duration_s.unwrap_or(0.0) > 0.0, "the transcript must report a duration");
}
