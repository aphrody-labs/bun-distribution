# SPDX-License-Identifier: Apache-2.0
"""Optional application adapter borrowing the qualified Bun runtime SDK client.

The existing graph/eval contracts remain application-owned. Bun/Rust owns
inference, response validation, confidence selection and child cancellation.
"""

from typing import Any, Protocol

from .contracts import DecisionInput, JevResponse


class NativeClient(Protocol):
    async def inspect_async(
        self, state: Any, questions: Any, **options: Any
    ) -> Any: ...


class BunTransport:
    """Inject explicitly into YoloDecision after native SDK qualification.

    The caller owns the client's Runtime, executable pin and private provider
    environment. No credentials, process, provider or alternate engine is opened
    here. The application continues to receive the Rust-selected abstention.
    """

    def __init__(self, client: NativeClient):
        self.client = client

    async def __call__(self, inputs: DecisionInput) -> JevResponse:
        request = inputs.jev_request()
        response = await self.client.inspect_async(
            request["state"],
            request["questions"],
            model=inputs.model,
            minimum_confidence=inputs.minimum_confidence,
            options={
                "timeout": max(1, int(inputs.deadline_seconds * 1000)),
                "maxRetries": 0,
            },
        )
        # Preserve the versioned application boundary without rebuilding native
        # confidence policy. Existing graph/evals consume this same contract.
        return JevResponse.model_validate(response)
