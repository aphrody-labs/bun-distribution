# SPDX-License-Identifier: Apache-2.0
"""Yolo TypeSafe SDK: upstream public types/lifecycle, private Jev transport.

System One Adapter MIT source reviewed at e1d4cc938204b22fc5a3c3aca7044072fe3f712d.
No upstream code or inference algorithms are copied. Provider comparisons use
the actual optional system-one-adapter package with explicitly supplied models.
"""

import json
from collections.abc import Mapping
from typing import Any, cast

import httpx
from typesafe_sdk import (
    AsyncTypeSafeClient as SDKAsyncClient,
)
from typesafe_sdk import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    Questions,
    RetryPolicy,
    Score,
    ScoreAnswer,
    SystemOneResponse,
    TypeSafeError,
    Usage,
)
from typesafe_sdk import (
    TypeSafeClient as SDKClient,
)

from .backend import validate_endpoint

__all__ = [
    "YoloTypeSafeClient",
    "AsyncYoloTypeSafeClient",
    "TypeSafeClient",
    "AsyncTypeSafeClient",
    "Choice",
    "ChoiceAnswer",
    "Noul",
    "NoulAnswer",
    "Score",
    "ScoreAnswer",
    "SystemOneResponse",
    "Usage",
    "RetryPolicy",
    "TypeSafeError",
    "comparison_client",
]


def _root(base_url: str) -> str:
    # Same endpoint qualification as the decision graph, without creating I/O.
    url = httpx.URL(base_url)
    if url.path.rstrip("/") not in {"", "/v1"}:
        raise ValueError("Yolo TypeSafe base_url must select an origin or /v1 root")
    endpoint = str(url.copy_with(path="/v1/systemone"))
    validate_endpoint(endpoint)
    # TypeSafe SDK already appends /v1/systemone to its origin.
    return str(url.copy_with(path="/")).rstrip("/")


def _text(value: Any) -> str:
    return (
        value
        if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, allow_nan=False)
    )


def _questions(questions: Mapping[str, Any]) -> Questions:
    """Adapt SDK JSON-content conveniences to Rust's textual descriptions."""
    result = {}
    for name, question in questions.items():
        raw = (
            question.model_dump(mode="json")
            if hasattr(question, "model_dump")
            else dict(question)
        )
        kind = raw.get("type")
        instructions = raw.get("instructions")
        if kind == "noul" and not instructions and not raw.get("criteria"):
            raise TypeSafeError("Noul requires instructions or criteria")
        raw["instructions"] = (
            _text(instructions)
            if instructions is not None
            else "Evaluate the supplied criteria."
        )
        criteria = raw.get("criteria")
        if kind in {"choice", "noul"} and criteria is not None:
            raw["criteria"] = {
                key: key if value is None else _text(value)
                for key, value in criteria.items()
            }
        elif kind == "score" and criteria is not None:
            raw["criteria"] = [_text(value) for value in criteria]
        result[name] = raw
    return cast(Questions, result)


class YoloTypeSafeClient(SDKClient):
    """Drop-in TypeSafe system_one protocol on an explicitly selected Jev root.

    Authentication, retries, custom response models, typed views and lifecycle
    are upstream SDK contracts. No default provider/key/environment selection.
    """

    def __init__(self, *, base_url: str, api_key: str, model: str, **options: Any):
        super().__init__(
            base_url=_root(base_url), api_key=api_key, model=model, **options
        )

    def system_one(self, state: Any, questions: Mapping[str, Any], **options: Any):
        return super().system_one(state, _questions(questions), **options)


class AsyncYoloTypeSafeClient(SDKAsyncClient):
    def __init__(self, *, base_url: str, api_key: str, model: str, **options: Any):
        super().__init__(
            base_url=_root(base_url), api_key=api_key, model=model, **options
        )

    async def system_one(
        self, state: Any, questions: Mapping[str, Any], **options: Any
    ):
        return await super().system_one(state, _questions(questions), **options)


TypeSafeClient = YoloTypeSafeClient
AsyncTypeSafeClient = AsyncYoloTypeSafeClient


def comparison_client(*, asynchronous: bool = False, **options: Any):
    """Use the actual optional upstream adapter; no provider inference copy."""
    from system_one_adapter import AsyncSystemOneAdapterClient, SystemOneAdapterClient

    cls = AsyncSystemOneAdapterClient if asynchronous else SystemOneAdapterClient
    return cls(**options)
