# SPDX-License-Identifier: Apache-2.0
"""Pydantic AI model adapter to the private Rust Jev decision service."""

from collections.abc import Awaitable, Callable
from ipaddress import ip_address

import httpx
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    UserPromptPart,
)
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage

from .contracts import DecisionInput, DecisionOutput, JevResponse

Transport = Callable[[DecisionInput], Awaitable[JevResponse]]


def validate_endpoint(endpoint: str) -> str:
    url = httpx.URL(endpoint)
    try:
        loopback = ip_address(url.host).is_loopback
    except ValueError:
        loopback = url.host == "localhost"
    if (
        url.scheme not in {"http", "https"}
        or (url.scheme == "http" and not loopback)
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path.rstrip("/") != "/v1/systemone"
    ):
        raise ValueError(
            "expected an explicit loopback HTTP or HTTPS /v1/systemone endpoint"
        )
    return str(url)


class JevHTTP:
    """Borrow an authenticated client; no credential discovery or persistence.

    Loopback HTTP or explicitly configured HTTPS only. Remote private routing
    and authorization belong to Infra. Redirects and environment proxies are off.
    """

    def __init__(self, endpoint: str, client: httpx.AsyncClient):
        self.endpoint = validate_endpoint(endpoint)
        self.client = client

    async def __call__(self, inputs: DecisionInput) -> JevResponse:
        response = await self.client.post(
            self.endpoint,
            params={"minimum_confidence": inputs.minimum_confidence},
            json=inputs.jev_request(),
            timeout=inputs.deadline_seconds,
            follow_redirects=False,
        )
        # Do not propagate provider bodies, headers or credential-bearing URLs.
        if response.status_code != 200:
            raise RuntimeError(
                f"Jev decision backend returned HTTP {response.status_code}"
            )
        return JevResponse.model_validate_json(response.content)


def bind_response(inputs: DecisionInput, response: JevResponse) -> DecisionOutput:
    """Check the application binding; Rust owns inference/distribution/policy."""
    if set(response.answers) != {"action"} or set(response.selections) != {"action"}:
        raise ValueError(
            "backend must return exactly the requested action answer and selection"
        )
    answer = response.answers["action"]
    selection = response.selections["action"]
    catalogue = {action.id for action in inputs.actions}
    if answer.choice not in catalogue or not set(answer.probabilities) <= catalogue:
        raise ValueError("backend returned an action outside the catalogue")
    if selection is not None and selection != answer.choice:
        raise ValueError("backend selection must match its candidate")
    return DecisionOutput(
        action_id=selection,
        candidate=answer.choice,
        confidence=answer.confidence,
        probabilities=answer.probabilities,
        model=response.model,
        usage=response.usage,
        status="abstained" if selection is None else "selected",
    )


class JevModel(Model):
    """Real non-streaming decision adapter; no generic chat or executable tools."""

    def __init__(self, transport: Transport):
        super().__init__()
        self.transport = transport

    @property
    def model_name(self) -> str:
        return "aphrody-yolo-jev"

    @property
    def system(self) -> str:
        return "aphrody-jev"

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        prompts = [
            part.content
            for message in messages
            for part in message.parts
            if isinstance(part, UserPromptPart) and isinstance(part.content, str)
        ]
        if len(prompts) != 1 or len(model_request_parameters.output_tools) != 1:
            raise ValueError("Yolo accepts one decision input and one typed output")
        inputs = DecisionInput.model_validate_json(prompts[0])
        response = await self.transport(inputs)
        output = bind_response(inputs, response)
        # Pydantic AI requires RequestUsage; its internal defaults are not a
        # provider measurement. Keep the application's unknown usage as None.
        usage = (
            RequestUsage(details={"aphrody_provider_usage_missing": 1})
            if response.usage is None
            else RequestUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            )
        )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    model_request_parameters.output_tools[0].name,
                    output.model_dump_json(),
                    tool_call_id="yolo-decision",
                )
            ],
            model_name=response.model,
            usage=usage,
            metadata={
                "aphrody_provider_usage": (
                    response.usage.model_dump() if response.usage is not None else None
                )
            },
        )
