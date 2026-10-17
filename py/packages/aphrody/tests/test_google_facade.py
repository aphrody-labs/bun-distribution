from aphrody.google import (
    GeminiVertex,
    GeminiWebClient,
    GoogleRuntime,
    SparkClient,
)


def test_google_facade_exports_all_clients() -> None:
    assert GeminiVertex is not None
    assert GeminiWebClient is not None
    assert SparkClient is not None
    assert GoogleRuntime is not None
