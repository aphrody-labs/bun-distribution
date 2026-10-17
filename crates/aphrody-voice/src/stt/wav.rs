// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! WAV PCM decoding and encoding, shared by every local Whisper path.
//!
//! Both local backends need the same two conversions, in opposite directions:
//!
//! - the **in-process** backend (`whisper-rs`, feature `local-whisper`) wants `Vec<f32>` mono 16
//!   kHz, so it decodes;
//! - the **driven** backend (`whisper-cli` spawned as a child process) can only be handed a file,
//!   and whisper.cpp accepts 16-bit PCM WAV, so it encodes.
//!
//! Keeping the two here means a caller that passes raw `f32` bytes gets the
//! exact same interpretation on both paths — the alternative (each backend
//! parsing its own header) is how a channel-count or bit-depth mismatch ends up
//! producing a transcript of noise on one backend and silence on the other.

/// A WAV buffer that could not be interpreted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WavError(pub String);

impl core::fmt::Display for WavError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "WAV parse error: {}", self.0)
    }
}

impl std::error::Error for WavError {}

/// Sample rate every Whisper build expects. Audio at any other rate must be
/// resampled before it reaches either backend.
pub const WHISPER_SAMPLE_RATE: u32 = 16_000;

/// The decoded content of a WAV buffer: mono `f32` samples plus the rate they
/// were stored at.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedWav {
    /// Mono samples, normalised to `[-1.0, 1.0]`.
    pub samples: Vec<f32>,
    /// Sample rate declared by the `fmt ` chunk.
    pub sample_rate: u32,
}

/// Parse a PCM WAV buffer into mono `f32` samples.
///
/// Supports 16-bit integer and 32-bit float PCM, mono or stereo (stereo is
/// averaged down), and tolerates auxiliary chunks (`LIST`, `INFO`, ...) sitting
/// between `fmt ` and `data`.
///
/// # Errors
///
/// [`WavError`] when the buffer is truncated, is not RIFF/WAVE, carries a
/// non-PCM codec, or uses a bit depth other than 16 or 32.
pub fn decode(audio: &[u8]) -> Result<DecodedWav, WavError> {
    if audio.len() < 44 {
        return Err(WavError("buffer too short to be a valid WAV".into()));
    }
    if &audio[0..4] != b"RIFF" {
        return Err(WavError("missing RIFF signature".into()));
    }
    if &audio[8..12] != b"WAVE" {
        return Err(WavError("missing WAVE signature".into()));
    }

    let mut pos = 12usize;
    let mut audio_format: u16 = 0;
    let mut num_channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut data_start: usize = 0;
    let mut data_len: usize = 0;

    while pos + 8 <= audio.len() {
        let chunk_id = &audio[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            audio[pos + 4],
            audio[pos + 5],
            audio[pos + 6],
            audio[pos + 7],
        ]) as usize;
        pos += 8;

        if chunk_id == b"fmt " {
            if chunk_size < 16 {
                return Err(WavError("fmt  chunk too short".into()));
            }
            if pos + 16 > audio.len() {
                return Err(WavError("buffer truncated inside fmt  chunk".into()));
            }
            audio_format = u16::from_le_bytes([audio[pos], audio[pos + 1]]);
            num_channels = u16::from_le_bytes([audio[pos + 2], audio[pos + 3]]);
            sample_rate = u32::from_le_bytes([
                audio[pos + 4],
                audio[pos + 5],
                audio[pos + 6],
                audio[pos + 7],
            ]);
            bits_per_sample = u16::from_le_bytes([audio[pos + 14], audio[pos + 15]]);
        } else if chunk_id == b"data" {
            data_start = pos;
            data_len = chunk_size.min(audio.len() - pos);
            break;
        }

        // RIFF pads odd-sized chunks to an even boundary.
        let advance = chunk_size + (chunk_size & 1);
        if advance == 0 {
            break;
        }
        pos += advance;
    }

    if data_start == 0 {
        return Err(WavError("no data chunk found".into()));
    }
    if audio_format != 1 && !(audio_format == 3 && bits_per_sample == 32) {
        return Err(WavError(format!(
            "unsupported audioFormat {audio_format} (only PCM=1, or IEEE float=3 at 32-bit)"
        )));
    }

    let pcm = &audio[data_start..data_start + data_len];
    let channels = usize::from(num_channels).max(1);

    let samples = match bits_per_sample {
        16 => {
            if !pcm.len().is_multiple_of(2) {
                return Err(WavError("odd byte count in a 16-bit data chunk".into()));
            }
            let interleaved: Vec<f32> = pcm
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32_768.0)
                .collect();
            downmix(interleaved, channels)
        }
        32 => {
            if !pcm.len().is_multiple_of(4) {
                return Err(WavError(
                    "byte count not a multiple of 4 in a 32-bit data chunk".into(),
                ));
            }
            let interleaved: Vec<f32> = pcm
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            downmix(interleaved, channels)
        }
        bps => {
            return Err(WavError(format!(
                "unsupported bits_per_sample {bps} (accepted: 16 or 32)"
            )));
        }
    };

    Ok(DecodedWav {
        samples,
        sample_rate,
    })
}

/// Average interleaved channels down to mono. A single channel passes through
/// untouched rather than through a needless copy of the arithmetic.
fn downmix(interleaved: Vec<f32>, channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved;
    }
    #[expect(
        clippy::cast_precision_loss,
        reason = "channel counts are 1..=8 in practice"
    )]
    let divisor = channels as f32;
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / divisor)
        .collect()
}

/// Reinterpret a buffer as raw little-endian `f32` samples.
///
/// This is the last-resort path for callers that hand over bare capture
/// samples with no container. Returns `None` when the length rules it out,
/// which keeps "not raw f32" distinguishable from "empty transcript".
#[must_use]
pub fn as_raw_f32(audio: &[u8]) -> Option<Vec<f32>> {
    if audio.is_empty() || !audio.len().is_multiple_of(4) {
        return None;
    }
    Some(
        audio
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect(),
    )
}

/// Encode mono `f32` samples as a 16-bit PCM WAV at `sample_rate`.
///
/// Samples are clamped before scaling: an out-of-range value silently wrapping
/// through `as i16` would turn a clipped peak into a full-scale sample of the
/// opposite sign, which whisper.cpp hears as a click.
#[must_use]
pub fn encode_pcm16(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_len = u32::try_from(samples.len() * 2).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(44 + samples.len() * 2);

    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&36u32.saturating_add(data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");

    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&sample_rate.saturating_mul(2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample

    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        #[expect(
            clippy::cast_possible_truncation,
            reason = "clamped to i16 range just above"
        )]
        let value = (clamped * 32_767.0) as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

/// Interpret arbitrary caller bytes as mono samples: WAV when the RIFF
/// signature is present, raw `f32` otherwise.
///
/// # Errors
///
/// [`WavError`] when the buffer is neither.
pub fn decode_any(audio: &[u8]) -> Result<DecodedWav, WavError> {
    if audio.len() >= 4 && &audio[..4] == b"RIFF" {
        return decode(audio);
    }
    as_raw_f32(audio)
        .map(|samples| DecodedWav {
            samples,
            sample_rate: WHISPER_SAMPLE_RATE,
        })
        .ok_or_else(|| WavError("unrecognised audio: neither WAV nor raw little-endian f32".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(bits: u16, channels: u16, rate: u32, payload: &[u8]) -> Vec<u8> {
        let mut w = Vec::new();
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + u32::try_from(payload.len()).unwrap()).to_le_bytes());
        w.extend_from_slice(b"WAVE");
        w.extend_from_slice(b"fmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        w.extend_from_slice(&channels.to_le_bytes());
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * u32::from(channels) * u32::from(bits) / 8).to_le_bytes());
        w.extend_from_slice(&(channels * bits / 8).to_le_bytes());
        w.extend_from_slice(&bits.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&u32::try_from(payload.len()).unwrap().to_le_bytes());
        w.extend_from_slice(payload);
        w
    }

    #[test]
    fn decodes_16_bit_mono_and_keeps_the_rate() {
        let payload: Vec<u8> = [0i16, 16_384, -16_384, 32_767]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let decoded = decode(&wav(16, 1, 16_000, &payload)).unwrap();
        assert_eq!(decoded.sample_rate, 16_000);
        assert_eq!(decoded.samples.len(), 4);
        assert!((decoded.samples[1] - 0.5).abs() < 1e-3);
        assert!((decoded.samples[2] + 0.5).abs() < 1e-3);
    }

    #[test]
    fn stereo_is_averaged_down_to_mono() {
        // Two frames: (1.0, -1.0) then (0.5, 0.5) -> 0.0 then 0.5.
        let payload: Vec<u8> = [32_767i16, -32_767, 16_384, 16_384]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let decoded = decode(&wav(16, 2, 16_000, &payload)).unwrap();
        assert_eq!(decoded.samples.len(), 2);
        assert!(decoded.samples[0].abs() < 1e-3, "{:?}", decoded.samples);
        assert!((decoded.samples[1] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn an_auxiliary_chunk_before_data_is_skipped() {
        let payload: Vec<u8> = [1000i16, -1000]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let mut w = wav(16, 1, 16_000, &payload);
        // Splice a LIST chunk of odd size right after `fmt `, to also exercise
        // the RIFF pad byte.
        let mut aux = Vec::from(*b"LIST");
        aux.extend_from_slice(&3u32.to_le_bytes());
        aux.extend_from_slice(b"abc\0");
        w.splice(36..36, aux);
        let decoded = decode(&w).unwrap();
        assert_eq!(decoded.samples.len(), 2);
    }

    #[test]
    fn a_bad_signature_is_an_error_not_a_panic() {
        assert!(decode(&[0u8; 64]).is_err());
        assert!(decode(b"XXXX\x00\x00\x00\x00WAVE").is_err());
    }

    #[test]
    fn unsupported_bit_depth_is_reported_with_its_value() {
        let err = decode(&wav(24, 1, 16_000, &[0u8; 6])).unwrap_err();
        assert!(err.to_string().contains("24"), "{err}");
    }

    #[test]
    fn encode_then_decode_round_trips_within_quantisation_error() {
        let samples = vec![0.0, 0.25, -0.25, 0.99, -0.99];
        let bytes = encode_pcm16(&samples, WHISPER_SAMPLE_RATE);
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.sample_rate, WHISPER_SAMPLE_RATE);
        assert_eq!(decoded.samples.len(), samples.len());
        for (got, want) in decoded.samples.iter().zip(&samples) {
            assert!((got - want).abs() < 1e-3, "{got} vs {want}");
        }
    }

    #[test]
    fn out_of_range_samples_clamp_instead_of_wrapping_sign() {
        // Without the clamp, 2.0 * 32767 wraps to a large negative i16 - a
        // full-scale click of the opposite polarity.
        let bytes = encode_pcm16(&[2.0, -2.0], WHISPER_SAMPLE_RATE);
        let decoded = decode(&bytes).unwrap();
        assert!(decoded.samples[0] > 0.99, "{:?}", decoded.samples);
        assert!(decoded.samples[1] < -0.99, "{:?}", decoded.samples);
    }

    #[test]
    fn raw_f32_needs_a_multiple_of_four_bytes() {
        assert!(as_raw_f32(&[0u8; 5]).is_none());
        assert!(as_raw_f32(&[]).is_none());
        assert_eq!(as_raw_f32(&1.0f32.to_le_bytes()).unwrap(), vec![1.0]);
    }

    #[test]
    fn decode_any_routes_on_the_riff_signature() {
        let wav_bytes = encode_pcm16(&[0.5], WHISPER_SAMPLE_RATE);
        assert_eq!(decode_any(&wav_bytes).unwrap().samples.len(), 1);
        assert_eq!(
            decode_any(&0.5f32.to_le_bytes()).unwrap().samples,
            vec![0.5]
        );
        assert!(decode_any(&[1u8, 2, 3]).is_err());
    }
}
