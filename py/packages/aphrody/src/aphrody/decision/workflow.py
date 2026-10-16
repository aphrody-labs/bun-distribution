# SPDX-License-Identifier: Apache-2.0
"""Bounded private decision graph: validate -> infer -> return proposal."""

import asyncio
from typing import Self

import httpx
from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits
from pydantic_graph import GraphBuilder, StepContext

from .backend import JevHTTP, JevModel, Transport
from .bun_transport import BunTransport, NativeClient
from .contracts import DecisionInput, DecisionOutput


class YoloDecision:
    def __init__(self, transport: Transport):
        self.agent = Agent(
            JevModel(transport),
            output_type=DecisionOutput,
            name="aphrody_yolo_decision",
            retries=0,
        )
        self.agent.instrument = False
        builder = GraphBuilder(
            name="aphrody_yolo_decision",
            input_type=DecisionInput,
            output_type=DecisionOutput,
            auto_instrument=False,
        )

        @builder.step
        async def infer(ctx: StepContext[None, None, DecisionInput]) -> DecisionOutput:
            inputs = ctx.inputs
            result = await self.agent.run(
                inputs.model_dump_json(),
                usage_limits=UsageLimits(request_limit=1),
            )
            return result.output

        builder.add(
            builder.edge_from(builder.start_node).to(infer),
            builder.edge_from(infer).to(builder.end_node),
        )
        self.graph = builder.build()

    @classmethod
    def from_bun(cls, client: NativeClient) -> Self:
        """Borrow a caller-qualified SDK client; retain this same Agent/Graph."""
        return cls(BunTransport(client))

    async def decide(self, inputs: DecisionInput) -> DecisionOutput:
        # Deadline also applies to injected transports and graph overhead.
        async with asyncio.timeout(inputs.deadline_seconds):
            return await self.graph.run(inputs=inputs)


async def decide_async_json(
    argument: str,
    endpoint: str | None = None,
    *,
    token: str | None = None,
    bun_client: NativeClient | None = None,
) -> str:
    inputs = DecisionInput.model_validate_json(argument)
    if bun_client is not None:
        if endpoint is not None or token is not None:
            raise ValueError(
                "select either the borrowed Bun client or the private HTTP backend"
            )
        output = await YoloDecision.from_bun(bun_client).decide(inputs)
        return output.model_dump_json()
    if endpoint is None:
        raise ValueError(
            "an explicit borrowed Bun client or private HTTP endpoint is required"
        )
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(
        trust_env=False,
        follow_redirects=False,
        headers=headers,
    ) as client:
        output = await YoloDecision(JevHTTP(endpoint, client)).decide(inputs)
    return output.model_dump_json()


def decide_json(argument: str, *, bun_client: NativeClient | None = None) -> str:
    """Borrow an explicit Bun client, or select the private host HTTP config.

    This synchronous boundary cannot run inside an existing Python asyncio loop;
    Python services use decide_async_json or YoloDecision.decide instead.
    """
    if bun_client is not None:
        return asyncio.run(decide_async_json(argument, bun_client=bun_client))

    import os

    endpoint = os.environ.get("APHRODY_YOLO_DECISION_ENDPOINT")
    if not endpoint:
        raise RuntimeError(
            "APHRODY_YOLO_DECISION_ENDPOINT must select a qualified private Jev service"
        )
    return asyncio.run(
        decide_async_json(
            argument,
            endpoint,
            token=os.environ.get("APHRODY_YOLO_DECISION_TOKEN"),
        )
    )
