/**
 * Inline faster-whisper script, run with `uv run --script <file>` (PEP 723 metadata: uv builds the
 * environment and installs faster-whisper on first use). Writes `<wav>.fw.json` for every wav it is given.
 *
 * Exact command (arguments after the script path: language, model, device, compute type, wav files):
 *   uv run --script fw_transcribe.py ja large-v3 auto default chunk-0001.wav
 */
export const FASTER_WHISPER_SCRIPT = `# /// script
# requires-python = ">=3.9"
# dependencies = ["faster-whisper>=1.1"]
# ///
"""Transcribe wav files with faster-whisper; one <wav>.fw.json per input (times in seconds)."""
import json
import sys

from faster_whisper import WhisperModel


def main() -> None:
    language, model_name, device, compute_type, *wavs = sys.argv[1:]
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    for wav in wavs:
        segments, info = model.transcribe(
            wav,
            language=None if language == "auto" else language,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        out = {"language": info.language, "language_probability": info.language_probability, "segments": []}
        for segment in segments:
            out["segments"].append(
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text,
                    "words": [
                        {"start": word.start, "end": word.end, "word": word.word} for word in (segment.words or [])
                    ],
                }
            )
        with open(wav + ".fw.json", "w", encoding="utf-8") as handle:
            json.dump(out, handle, ensure_ascii=False)


main()
`;
