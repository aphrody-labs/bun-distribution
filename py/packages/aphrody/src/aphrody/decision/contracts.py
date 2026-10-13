# SPDX-License-Identifier: Apache-2.0
"""Versioned application contracts; authority remains with the action executor."""

import json
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

Name = Annotated[
    str, Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_.:-]+$")
]
Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class Action(Contract):
    id: Name
    description: Annotated[str, Field(min_length=1, max_length=4096)]


class DecisionInput(Contract):
    schema_version: Literal["aphrody.yolo.decision/1"] = "aphrody.yolo.decision/1"
    goal: Annotated[str, Field(min_length=1, max_length=16384)]
    # Callers supply a curated snapshot, never raw provider histories or secrets.
    observations: dict[str, JsonValue] = Field(default_factory=dict)
    actions: Annotated[list[Action], Field(min_length=2, max_length=128)]
    model: Annotated[str, Field(min_length=1, max_length=256)]
    minimum_confidence: Probability = 0.8
    deadline_seconds: Annotated[float, Field(gt=0, le=60, allow_inf_nan=False)] = 15.0

    @model_validator(mode="after")
    def unique_actions(self) -> Self:
        json.dumps(self.observations, allow_nan=False)
        if len({action.id for action in self.actions}) != len(self.actions):
            raise ValueError("action IDs must be unique")
        return self

    def jev_request(self) -> dict[str, JsonValue]:
        return {
            "state": {"goal": self.goal, "observations": self.observations},
            "model": self.model,
            "questions": {
                "action": {
                    "type": "choice",
                    "instructions": "Choose the next action from the supplied catalogue to advance the goal.",
                    "criteria": {
                        action.id: action.description for action in self.actions
                    },
                }
            },
        }


class ChoiceAnswer(Contract):
    type: Literal["choice"]
    choice: Name
    confidence: Probability
    probabilities: dict[Name, Probability] = Field(default_factory=dict)


class Usage(Contract):
    input_tokens: Annotated[int, Field(ge=0)] = 0
    output_tokens: Annotated[int, Field(ge=0)] = 0


class JevResponse(Contract):
    model: Annotated[str, Field(min_length=1)]
    answers: dict[str, ChoiceAnswer]
    usage: Usage = Field(default_factory=Usage)
    # Required: only the Rust owner may apply the confidence policy.
    selections: dict[str, Name | None]


class DecisionOutput(Contract):
    schema_version: Literal["aphrody.yolo.decision/1"] = "aphrody.yolo.decision/1"
    action_id: Name | None
    candidate: Name
    confidence: Probability
    probabilities: dict[Name, Probability]
    model: str
    usage: Usage
    status: Literal["selected", "abstained"]
    inference_owner: Literal["aphrody-jev"] = "aphrody-jev"
    # A decision is a proposal. It cannot authorize or execute an operation.
    executed: Literal[False] = False


class LabeledDecision(Contract):
    """Explicit curated supervision for eval/export; never implicit session capture."""

    id: Name
    split: Literal["train", "validation", "test"]
    source: Literal["synthetic", "owner_labeled"]
    inputs: DecisionInput
    expected_action: Name | None

    @model_validator(mode="after")
    def known_label(self) -> Self:
        if self.expected_action is not None and self.expected_action not in {
            action.id for action in self.inputs.actions
        }:
            raise ValueError("label must belong to the supplied catalogue")
        return self
