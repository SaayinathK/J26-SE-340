"""A cached model folder must be usable even when files the service never reads (README, LICENSE, .gitattributes) are missing.

Seen in practice: the weights were downloaded with an `allow_patterns` filter; newer huggingface_hub then calls the snapshot
"incomplete" under local_files_only, the generator reported the model as not installed, and an evaluation silently measured the
template fallback instead of the LLM."""
from __future__ import annotations

import pytest

pytest.importorskip("huggingface_hub")        # comes with the optional LLM extras: skip, do not fail, without it
import huggingface_hub.constants as hub_constants  # noqa: E402

from strategy_agent.generation.generator import LLMGenerator, cached_snapshot  # noqa: E402


def make_cache(root, files: dict[str, bytes], commit="abc123"):
    model = root / "models--acme--tiny"
    (model / "refs").mkdir(parents=True)
    (model / "refs" / "main").write_text(commit)
    snap = model / "snapshots" / commit
    snap.mkdir(parents=True)
    for name, data in files.items():
        (snap / name).write_bytes(data)
    return snap


def test_a_snapshot_without_readme_or_license_is_found_and_its_weights_count(tmp_path, monkeypatch):
    monkeypatch.setattr(hub_constants, "HF_HUB_CACHE", str(tmp_path))
    snap = make_cache(tmp_path, {"config.json": b"{}", "model.safetensors": b"w", "tokenizer.json": b"{}"})
    assert cached_snapshot("acme/tiny") == snap
    gen = LLMGenerator("acme/tiny", 100)
    assert gen._model_dir() == snap and gen._weights_cached() is True


def test_config_files_alone_are_still_not_a_usable_model(tmp_path, monkeypatch):
    monkeypatch.setattr(hub_constants, "HF_HUB_CACHE", str(tmp_path))
    make_cache(tmp_path, {"config.json": b"{}", "tokenizer.json": b"{}"})
    assert LLMGenerator("acme/tiny", 100)._weights_cached() is False       # no weights: never claim the model is available


def test_a_model_that_was_never_downloaded_is_not_found(tmp_path, monkeypatch):
    monkeypatch.setattr(hub_constants, "HF_HUB_CACHE", str(tmp_path))
    assert cached_snapshot("nobody/nothing") is None
    assert LLMGenerator("nobody/nothing", 100)._weights_cached() is False
