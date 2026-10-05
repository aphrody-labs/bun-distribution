# SPDX-License-Identifier: Apache-2.0
"""Meeting output must derive from supplied content and validate before publication."""

import json

import pytest

from aphrody_meetings.pipeline import extract_structured_synthesis


def test_synthesis_receives_actual_transcript_and_preserves_requested_title():
    seen = []

    def synthesize(prompt):
        seen.append(prompt)
        return json.dumps(
            {
                "executive_summary": "Alice will deliver the report.",
                "demographics": [],
                "key_decisions": ["Deliver the report"],
                "risks_and_vigilance": [],
                "action_plan": [
                    {"action": "Deliver report", "owner": "Alice", "deadline": "Friday"}
                ],
            }
        )

    result = extract_structured_synthesis(
        "Alice: I will deliver the report on Friday.",
        "Weekly meeting",
        synthesizer=synthesize,
    )
    assert "Alice: I will deliver the report on Friday." in seen[0]
    assert result["title"] == "Weekly meeting"
    assert result["action_plan"][0]["owner"] == "Alice"


@pytest.mark.parametrize("payload", ["[]", "{}", "not JSON"])
def test_invalid_model_output_is_rejected(payload):
    with pytest.raises(ValueError):
        extract_structured_synthesis(
            "Alice: Hello", "Meeting", synthesizer=lambda _: payload
        )


def test_empty_transcript_is_rejected_before_provider_execution():
    def unexpected(_):
        raise AssertionError("Provider must not run")

    with pytest.raises(ValueError, match="empty"):
        extract_structured_synthesis(" ", "Meeting", synthesizer=unexpected)
