# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Unit tests for OpenAI Harmony protocol reasoning engine."""

from __future__ import annotations

from unittest import mock

from aphrody.inference.harmony_reasoning import (
    DEFAULT_MIN_P,
    DEFAULT_TEMPERATURE,
    DEFAULT_TOP_P,
    HarmonyParser,
    HarmonyRunner,
    OpenAICompatibleReasoningClient,
)


def test_harmony_parser_channels() -> None:
    sample_text = (
        "<|start|><|channel|>analysis<|message|>\n"
        "Étape 1: Le fermier commence avec 17 moutons.\n"
        "Étape 2: L'énoncé dit 'Tous meurent sauf 9'.\n"
        "Étape 3: Le mot-clé est 'sauf 9', ce qui signifie que 9 sont restés vivants.\n"
        "Conclusion: 9 moutons restent vivants.<|end|>\n"
        "<|start|><|channel|>commentary<|message|>\n"
        "Enigme classique résolue sans piège arithmétique.<|end|>\n"
        "<|start|><|channel|>final<|message|>\n"
        "Il lui reste 9 moutons."
    )

    res = HarmonyParser.parse(sample_text)
    assert "Étape 1" in res.analysis
    assert "9 sont restés vivants" in res.analysis
    assert res.commentary == "Enigme classique résolue sans piège arithmétique."
    assert res.final == "Il lui reste 9 moutons."
    assert "analysis" in res.channels
    assert "commentary" in res.channels
    assert "final" in res.channels


def test_harmony_parser_tag_fallback() -> None:
    sample_tag = (
        "<think>On doit faire attention aux soustractions trompeuses.</think>\n"
        "La réponse est 9."
    )
    res = HarmonyParser.parse(sample_tag)
    assert res.analysis == "On doit faire attention aux soustractions trompeuses."
    assert res.final == "La réponse est 9."


def test_harmony_parser_format_prompt() -> None:
    prompt = HarmonyParser.format_prompt(
        user_message="Résous 2+2",
        system_instruction="Tu es un assistant rigoureux.",
    )
    assert (
        "<|start|><|channel|>system<|message|>\nTu es un assistant rigoureux.<|end|>"
        in prompt
    )
    assert "<|start|><|channel|>user<|message|>\nRésous 2+2<|end|>" in prompt
    assert prompt.endswith("<|start|><|channel|>analysis<|message|>\n")


def test_openai_compatible_client_mock() -> None:
    fake_response = {
        "choices": [
            {
                "message": {
                    "content": (
                        "<|start|><|channel|>analysis<|message|>\n"
                        "Analyse de la question...\n"
                        "<|start|><|channel|>final<|message|>\n"
                        "Résultat final : 42"
                    )
                }
            }
        ],
        "usage": {"total_tokens": 120},
    }

    with mock.patch("httpx.Client.post") as mock_post:
        mock_resp = mock.MagicMock()
        mock_resp.json.return_value = fake_response
        mock_resp.status_code = 200
        mock_resp.raise_for_status = mock.MagicMock()
        mock_post.return_value = mock_resp

        client = OpenAICompatibleReasoningClient()
        res = client.generate("Question test")

        assert res.analysis == "Analyse de la question..."
        assert res.final == "Résultat final : 42"
        assert res.metadata == {"total_tokens": 120}

        # Check default hyperparams sent
        _args, kwargs = mock_post.call_args
        payload = kwargs["json"]
        assert payload["temperature"] == DEFAULT_TEMPERATURE
        assert payload["top_p"] == DEFAULT_TOP_P
        assert payload["min_p"] == DEFAULT_MIN_P


def test_openai_compatible_client_reasoning_content() -> None:
    fake_response = {
        "choices": [
            {
                "message": {
                    "reasoning_content": "Pensée interne séparée",
                    "content": "Réponse finale directe",
                }
            }
        ],
        "usage": {"total_tokens": 50},
    }

    with mock.patch("httpx.Client.post") as mock_post:
        mock_resp = mock.MagicMock()
        mock_resp.json.return_value = fake_response
        mock_resp.status_code = 200
        mock_resp.raise_for_status = mock.MagicMock()
        mock_post.return_value = mock_resp

        client = OpenAICompatibleReasoningClient()
        res = client.generate("Question")

        assert res.analysis == "Pensée interne séparée"
        assert res.final == "Réponse finale directe"


def test_harmony_runner_cli_mock() -> None:
    runner = HarmonyRunner(
        model_path="fake/path.gguf",
        cli_binary="fake/llama-cli",
    )
    with (
        mock.patch("pathlib.Path.is_file", return_value=True),
        mock.patch("subprocess.run") as mock_run,
    ):
        mock_proc = mock.MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = (
            "<|start|><|channel|>analysis<|message|>\n"
            "Calcul mental effectué.\n"
            "<|start|><|channel|>final<|message|>\n"
            "100"
        )
        mock_run.return_value = mock_proc

        res = runner.run_cli_inference("Combien vaut 10x10 ?")
        assert res.analysis == "Calcul mental effectué."
        assert res.final == "100"
