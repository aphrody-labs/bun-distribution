from pathlib import Path

import pytest

from aphrody.background_review import BackgroundReview


@pytest.fixture(autouse=True)
def isolated_review_state(monkeypatch, tmp_path):
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path / "state"))
    monkeypatch.delenv("APHRODY_SECRETS_DIR", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.chdir(tmp_path)


def test_background_review_defaults_use_state_home(tmp_path):
    # A consumer checkout must not become the SDK's default mutable storage.
    (tmp_path / ".git").mkdir()
    reviewer = BackgroundReview()
    assert reviewer.memory_file == tmp_path / "state" / "memory" / "memory.md"
    assert reviewer.skills_dir == tmp_path / "state" / "skills"
    assert not reviewer.memory_file.exists()
    assert not reviewer.skills_dir.exists()


def test_background_review_resolves_home_at_instantiation(monkeypatch, tmp_path):
    first = BackgroundReview()
    second_home = tmp_path / "another-state"
    monkeypatch.setenv("APHRODY_HOME", str(second_home))
    second = BackgroundReview()
    assert first.memory_file == tmp_path / "state" / "memory" / "memory.md"
    assert second.memory_file == second_home / "memory" / "memory.md"
    assert second.skills_dir == second_home / "skills"


def test_background_review_private_directory_override(monkeypatch, tmp_path):
    private = tmp_path / "private"
    monkeypatch.setenv("APHRODY_SECRETS_DIR", str(private))
    first = BackgroundReview()
    assert first.memory_file == private / "memory.md"
    assert first.skills_dir == private / "skills"
    second_private = tmp_path / "second-private"
    monkeypatch.setenv("APHRODY_SECRETS_DIR", str(second_private))
    second = BackgroundReview()
    assert second.memory_file == second_private / "memory.md"
    assert second.skills_dir == second_private / "skills"


def test_background_review_default_home_ignores_checkout(monkeypatch, tmp_path):
    monkeypatch.delenv("APHRODY_HOME", raising=False)
    (tmp_path / ".git").mkdir()
    reviewer = BackgroundReview()
    assert (
        reviewer.memory_file == tmp_path / "home" / ".aphrody" / "memory" / "memory.md"
    )
    assert reviewer.skills_dir == tmp_path / "home" / ".aphrody" / "skills"


def test_background_review_explicit_overrides_remain_authoritative(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("APHRODY_SECRETS_DIR", str(tmp_path / "private"))
    memory = tmp_path / "explicit-memory.md"
    skills = tmp_path / "explicit-skills"
    db = tmp_path / "explicit-db.sqlite"
    reviewer = BackgroundReview(db_path=db, memory_file=memory, skills_dir=skills)
    assert reviewer.db_path == db
    assert reviewer.memory_file == memory
    assert reviewer.skills_dir == skills


def test_default_review_updates_write_only_configured_state(tmp_path):
    reviewer = BackgroundReview()
    reviewer._apply_updates(
        {
            "memory_update": "Configured state memory.",
            "skills_update": {
                "skill_name": "test",
                "file_path": "test.md",
                "content": "Configured state skill.",
            },
        }
    )
    assert reviewer.memory_file.read_text(encoding="utf-8").endswith(
        "Configured state memory.\n"
    )
    assert (
        (reviewer.skills_dir / "test.md")
        .read_text(encoding="utf-8")
        .endswith("Configured state skill.\n")
    )
    assert not (tmp_path / "var").exists()


def test_background_review_parsing():
    reviewer = BackgroundReview()

    # Standard JSON
    res = reviewer._parse_json_response(
        '{"memory_update": "hello", "skills_update": null}'
    )
    assert res is not None
    assert res["memory_update"] == "hello"

    # JSON inside code block
    res_code = reviewer._parse_json_response(
        '```json\n{"memory_update": "hello", "skills_update": null}\n```'
    )
    assert res_code is not None
    assert res_code["memory_update"] == "hello"

    # Malformed leading/trailing junk
    res_junk = reviewer._parse_json_response(
        'Some text here: {"memory_update": "hello", "skills_update": null} trailing junk'
    )
    assert res_junk is not None
    assert res_junk["memory_update"] == "hello"


def test_background_review_apply_updates(tmp_path):
    mem_file = tmp_path / "memory.md"
    skills_dir = tmp_path / "skills"

    reviewer = BackgroundReview(
        memory_file=mem_file,
        skills_dir=skills_dir,
    )

    updates = {
        "memory_update": "User likes Python.",
        "skills_update": {
            "skill_name": "build",
            "file_path": "build.md",
            "content": "Run uv run pytest to build.",
        },
    }

    reviewer._apply_updates(updates)

    # Verify memory update written
    assert mem_file.exists()
    mem_content = mem_file.read_text(encoding="utf-8")
    assert "User likes Python." in mem_content

    # Verify skills update written
    skill_file = skills_dir / "build.md"
    assert skill_file.exists()
    skill_content = skill_file.read_text(encoding="utf-8")
    assert "Run uv run pytest to build." in skill_content
    assert "# Skill: build" in skill_content
