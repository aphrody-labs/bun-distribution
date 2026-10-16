# SPDX-License-Identifier: Apache-2.0
"""JSON-only product bridge; Bun's SDK owns inference and native child lifetime."""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import Field, JsonValue, ValidationError

from .contracts import Contract, DecisionInput
from .workflow import YoloDecision

if TYPE_CHECKING:
    from bun_yolo import Options, Question, Result

MAX_BYTES = 1024 * 1024
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Revision = Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
LocalPath = Annotated[str, Field(min_length=1, max_length=4096)]


class RuntimePin(Contract):
    directory: LocalPath
    manifest_sha256: Digest = Field(alias="manifestSha256")


class BunPin(Contract):
    executable: LocalPath
    sha256: Digest
    revision: Revision


class NativeDecision(Contract):
    protocol: Literal["aphrody.yolo.bun-bridge/1"]
    argument: str
    runtime: RuntimePin
    bun: BunPin
    provider: dict[str, JsonValue] | None = None


def _pinned_file(path: Path, digest: str) -> None:
    if not path.is_absolute() or not path.is_file():
        raise ValueError("ERR_DECISION_ARTIFACT_PATH")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != digest:
        raise ValueError("ERR_DECISION_ARTIFACT_HASH")


def decide_bun_json(argument: str) -> str:
    """Borrow CPython; stop/join and close this call's existing native SDK owner.

    The SDK modules must be installed/configured by the caller. No resolver,
    credential file, alternate engine or persistent process registry is opened.
    """
    started = time.monotonic()
    if len(argument.encode("utf-8")) > MAX_BYTES:
        raise ValueError("ERR_DECISION_INPUT_LIMIT")
    try:
        envelope = NativeDecision.model_validate_json(argument)
        inputs = DecisionInput.model_validate_json(envelope.argument)
    except ValidationError:
        raise ValueError("ERR_DECISION_INPUT") from None
    directory, executable = (
        Path(envelope.runtime.directory),
        Path(envelope.bun.executable),
    )
    _pinned_file(directory / "manifest.json", envelope.runtime.manifest_sha256)
    _pinned_file(executable, envelope.bun.sha256)

    # Optional producer modules remain lazy. Runtime validates target, source,
    # every payload and loaded ABI; Yolo requires the additive pipe/wait APIs.
    from bun_yolo import Yolo
    from yolo_runtime import Runtime

    with Runtime(directory, max_operations=1) as runtime:
        remaining = inputs.deadline_seconds - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("ERR_DECISION_DEADLINE")
        client = Yolo(
            runtime,
            executable,
            revision=envelope.bun.revision,
            transport_timeout_ms=max(1, int(remaining * 1000)),
            env={}
            if envelope.provider and envelope.provider.get("kind") == "code"
            else {
                name: os.environ[name]
                for name in (
                    "TYPESAFE_API_KEY",
                    "TYPESAFE_BASE_URL",
                    "TYPESAFE_DEFAULT_MODEL",
                )
                if name in os.environ
            },
        )

        class BorrowedProvider:
            async def inspect_async(
                self,
                state: JsonValue,
                questions: dict[str, Question],
                *,
                model: str | None = None,
                minimum_confidence: float | None = None,
                options: Options | None = None,
            ) -> Result:
                # PythonAsync already owns this dedicated host worker. Reuse the
                # SDK's bounded native wait rather than add a Python executor.
                return client.inspect(
                    state,
                    questions,
                    provider=envelope.provider,
                    model=model,
                    minimum_confidence=minimum_confidence,
                    options=options,
                )

        async def operation():
            remaining = inputs.deadline_seconds - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError("ERR_DECISION_DEADLINE")
            try:
                async with asyncio.timeout(remaining):
                    return await YoloDecision.from_bun(BorrowedProvider()).decide(
                        inputs
                    )
            except TimeoutError:
                raise TimeoutError("ERR_DECISION_DEADLINE") from None

        output = asyncio.run(operation())
        result = output.model_dump_json()
        if len(result.encode("utf-8")) > MAX_BYTES:
            raise ValueError("ERR_DECISION_OUTPUT_LIMIT")
        return result
