# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""End-to-end Audio Meeting Pipeline: Audio -> STT -> Reasoning -> Google Docs & Drive."""

from __future__ import annotations

import argparse
import datetime
import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from aphrody.google_docs import (
    AuthenticatedDocsClient,
    GoogleDocBuilder,
    resolve_access_token,
)
from aphrody.google_drive import AuthenticatedDriveClient

logger = logging.getLogger(__name__)


def extract_structured_synthesis(
    transcript_text: str, title: str, *, synthesizer: Callable[[str], str] | None = None
) -> dict[str, Any]:
    """Generate and validate a JSON synthesis from the actual meeting transcript."""
    if not transcript_text.strip():
        raise ValueError("Meeting transcript must not be empty")
    if synthesizer is None:
        from aphrody.vertex import generate

        synthesizer = generate
    prompt = (
        "Summarize the supplied meeting transcript using only facts in that transcript. "
        "Return a JSON object with executive_summary (string), demographics, "
        "key_decisions, risks_and_vigilance (lists of strings), and action_plan "
        "(list of objects with action, owner, deadline strings). Use empty lists "
        "when the transcript provides no corresponding facts.\n"
        + json.dumps(
            {"title": title, "transcript": transcript_text}, ensure_ascii=False
        )
    )
    payload = synthesizer(prompt).strip()
    if payload.startswith("```"):
        payload = payload.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    result = json.loads(payload)
    if not isinstance(result, dict) or not isinstance(
        result.get("executive_summary"), str
    ):
        raise ValueError("Synthesis must contain an executive_summary string")
    for key in ("demographics", "key_decisions", "risks_and_vigilance"):
        if not isinstance(result.get(key), list) or not all(
            isinstance(item, str) for item in result[key]
        ):
            raise ValueError(f"Synthesis field {key} must be a list of strings")
    actions = result.get("action_plan")
    if not isinstance(actions, list) or not all(
        isinstance(item, dict)
        and all(
            isinstance(item.get(key), str) for key in ("action", "owner", "deadline")
        )
        for item in actions
    ):
        raise ValueError(
            "Synthesis action_plan must contain action, owner and deadline strings"
        )
    result.update(
        title=title,
        date=datetime.date.today().isoformat(),
        duration="Not supplied by transcript metadata",
    )
    return result


def run_pipeline(
    audio_file: str | Path,
    *,
    doc_title: str | None = None,
    drive_folder_name: str = "Aphrody Transcriptions & Synthèses",
    share_public: bool = True,
    token: str | None = None,
) -> dict[str, Any]:
    """Execute the end-to-end pipeline."""
    audio_path = Path(audio_file).resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    base_name = audio_path.stem
    display_title = doc_title or f"Compte-Rendu Stratégique — {base_name}"

    # 1. Check for transcript (.txt) and subtitles (.srt)
    txt_path = audio_path.with_suffix(".txt")
    srt_path = audio_path.with_suffix(".srt")

    if not txt_path.exists():
        raise RuntimeError(
            f"Transcript {txt_path} not found. Please transcribe the audio first with faster-whisper."
        )

    transcript_text = txt_path.read_text(encoding="utf-8", errors="replace")
    logger.info(
        f"[1/5] Transcript loaded ({len(transcript_text.splitlines())} segments)"
    )

    # 2. Extract structured synthesis
    synthesis = extract_structured_synthesis(transcript_text, display_title)
    logger.info("[2/5] Structured reasoning synthesis generated")

    # 3. Initialize Google Clients
    token_fn = (lambda: token) if token else resolve_access_token
    docs_client = AuthenticatedDocsClient(token_provider=token_fn)
    drive_client = AuthenticatedDriveClient(token_provider=token_fn)

    # 4. Resolve or create target Google Drive folder & subfolder
    logger.info("[3/5] Connecting to Google Drive...")
    main_folder_id = drive_client.resolve_or_create_folder(drive_folder_name)
    subfolder_name = f"{datetime.date.today().isoformat()} - {base_name}"
    subfolder_id = drive_client.create_folder(subfolder_name, parent_id=main_folder_id)
    logger.info(f"      Subfolder created: '{subfolder_name}' (ID: {subfolder_id})")

    # 5. Build and populate the Google Doc
    logger.info("[4/5] Building Google Doc...")
    builder = GoogleDocBuilder()
    builder.add_title(display_title)
    builder.add_callout(
        f"Date: {synthesis['date']} | Durée estimée: {synthesis['duration']}\n"
        f"{synthesis['executive_summary']}",
        label="RÉSUMÉ EXÉCUTIF",
    )

    builder.add_heading("1. Diagnostic Démographique & Prospective 2025–2035", level=1)
    for d in synthesis.get("demographics", []):
        builder.add_bullet(d, bold_prefix="[DONNÉE]")

    builder.add_heading("2. Diagnostic Territorial & Réseau Viaire (RN2)", level=1)
    for rn in synthesis.get("road_network", []):
        builder.add_bullet(rn, bold_prefix="[VOIRIE]")

    builder.add_heading("3. Décisions & Arbitrages Stratégiques Validés", level=1)
    for dec in synthesis["key_decisions"]:
        builder.add_bullet(dec, bold_prefix="[DÉCISION]")

    builder.add_heading("4. Points de Vigilance & Risques Identifiés", level=1)
    for r in synthesis["risks_and_vigilance"]:
        builder.add_bullet(r, bold_prefix="[VIGILANCE]")

    builder.add_heading("5. Plan d'Action Opérationnel & Jalons", level=1)
    for step in synthesis["action_plan"]:
        builder.add_bullet(
            f"{step['action']} (Responsable: {step['owner']} — Échéance: {step['deadline']})",
            bold_prefix="[ACTION]",
        )

    builder.add_heading(
        "6. Transcription Intégrale Synchronisée de la Réunion", level=1
    )
    # Insert transcript lines (first 500 lines for document readability)
    transcript_sample = "\n".join(transcript_text.splitlines()[:500])
    builder.add_paragraph(transcript_sample)

    doc_meta = docs_client.create_document(display_title)
    doc_id = doc_meta["documentId"]
    logger.info(f"      Google Doc created: {doc_id}")

    docs_client.apply_builder(doc_id, builder)
    logger.info("      Content and styling applied via batchUpdate")

    # Move doc into the dedicated subfolder
    drive_client.move_file_to_folder(doc_id, subfolder_id)

    # 6. Upload companion files to Google Drive subfolder
    logger.info("[5/5] Uploading audio assets to Google Drive...")
    uploaded_files = []

    # Upload transcript .txt
    txt_meta = drive_client.upload_file(txt_path, folder_id=subfolder_id)
    uploaded_files.append({"name": txt_path.name, "id": txt_meta["id"]})

    # Upload markdown synthesis if exists
    md_path = audio_path.with_name(
        f"{audio_path.stem.replace('_enhanced', '')}_Synthese_Strategique.md"
    )
    if not md_path.exists():
        md_path = audio_path.with_name(f"{audio_path.stem}_Synthese_Strategique.md")
    if md_path.exists():
        md_meta = drive_client.upload_file(md_path, folder_id=subfolder_id)
        uploaded_files.append({"name": md_path.name, "id": md_meta["id"]})

    # Upload subtitles .srt if exists
    if srt_path.exists():
        srt_meta = drive_client.upload_file(srt_path, folder_id=subfolder_id)
        uploaded_files.append({"name": srt_path.name, "id": srt_meta["id"]})

    # Upload enhanced audio or base audio
    enhanced_audio = audio_path.with_name(f"{audio_path.stem}_enhanced.mp3")
    audio_to_upload = enhanced_audio if enhanced_audio.exists() else audio_path
    if audio_to_upload.exists() and audio_to_upload.stat().st_size < 100 * 1024 * 1024:
        logger.info(f"      Uploading audio ({audio_to_upload.name})...")
        audio_meta = drive_client.upload_file(audio_to_upload, folder_id=subfolder_id)
        uploaded_files.append({"name": audio_to_upload.name, "id": audio_meta["id"]})

    # Optional public sharing
    if share_public:
        drive_client.create_permission(doc_id, role="reader", type_="anyone")
        drive_client.create_permission(subfolder_id, role="reader", type_="anyone")

    doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"
    folder_url = f"https://drive.google.com/drive/folders/{subfolder_id}"

    return {
        "status": "SUCCESS",
        "doc_id": doc_id,
        "doc_url": doc_url,
        "folder_id": subfolder_id,
        "folder_url": folder_url,
        "uploaded_files": uploaded_files,
    }


def main() -> None:
    """Entrypoint for the meeting pipeline CLI."""
    parser = argparse.ArgumentParser(description="Aphrody Audio Meeting Pipeline")
    parser.add_argument("audio", help="Path to input audio file")
    parser.add_argument("--title", help="Optional document title")
    parser.add_argument(
        "--folder",
        default="Aphrody Transcriptions & Synthèses",
        help="Google Drive folder name",
    )
    parser.add_argument("--token", help="Optional explicit access token")
    args = parser.parse_args()

    result = run_pipeline(
        args.audio,
        doc_title=args.title,
        drive_folder_name=args.folder,
        token=args.token,
    )
    print("\n=== PIPELINE TERMINÉ AVEC SUCCÈS ===")
    print(f"Google Doc URL: {result['doc_url']}")
    print(f"Google Drive Dossier: {result['folder_url']}")
    print(f"Fichiers téléversés: {len(result['uploaded_files'])}")


if __name__ == "__main__":
    main()
