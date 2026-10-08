"""The Colab notebook cannot be run here (no Colab, no GPU), so check everything that can be checked offline:
valid notebook JSON, parseable Python cells, and that every command-line flag it uses exists in the real scripts."""
from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
NB = ROOT / "strategy_agent" / "training" / "colab_finetune_mistral.ipynb"


@pytest.fixture(scope="module")
def cells():
    return json.loads(NB.read_text())["cells"]


def _split(source: str) -> tuple[str, list[str]]:
    """(python code, shell commands) of a code cell; handles `!cmd` lines and backslash continuations."""
    py, shell, lines, i = [], [], source.split("\n"), 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith(("!", "%")):
            cmd = line.lstrip()[1:]
            while cmd.rstrip().endswith("\\") and i + 1 < len(lines):
                i += 1
                cmd = cmd.rstrip()[:-1] + " " + lines[i].strip()
            shell.append(cmd)
        else:
            py.append(line)
        i += 1
    return "\n".join(py), shell


def _code(cells):
    return ["".join(c["source"]) for c in cells if c["cell_type"] == "code"]


def test_notebook_is_valid_and_declares_a_gpu_runtime():
    nbformat = pytest.importorskip("nbformat")
    nb = nbformat.read(NB, as_version=4)
    nbformat.validate(nb)
    assert nb.metadata["accelerator"] == "GPU" and len(nb.cells) >= 15


def test_every_python_cell_parses(cells):
    for src in _code(cells):
        ast.parse(_split(src)[0])


def test_every_flag_the_notebook_passes_exists_in_the_real_scripts(cells):
    seen: dict[str, set[str]] = {}
    for src in _code(cells):
        for cmd in _split(src)[1]:
            m = re.search(r"python3? -m (strategy_agent[\w.]+)", cmd)
            if m:
                seen.setdefault(m.group(1), set()).update(re.findall(r"(?<![\w-])(--[a-z][a-z0-9-]*)", cmd))
    assert {"strategy_agent.training.sft_qlora", "strategy_agent.eval.run"} <= set(seen)
    for module, flags in seen.items():
        help_text = subprocess.run([sys.executable, "-m", module, "--help"], capture_output=True, text=True, cwd=ROOT).stdout
        for flag in flags:
            assert flag in help_text, f"{module} has no option {flag}"


def test_python_subprocess_cells_use_real_flags(cells):
    """Cells that call the scripts through subprocess.run([... "-m", "strategy_agent.x", "--flag" ...]) (the dry-run check and the optional DPO step)."""
    checked = 0
    for src in _code(cells):
        for module in re.findall(r'"-m",\s*"(strategy_agent[\w.]+)"', src) or re.findall(r'"(strategy_agent\.training\.\w+)"', src):
            flags = set(re.findall(r'"(--[a-z][a-z0-9-]*)"', src))
            help_text = subprocess.run([sys.executable, "-m", module, "--help"], capture_output=True, text=True, cwd=ROOT).stdout
            assert flags and all(f in help_text for f in flags), (module, [f for f in flags if f not in help_text])
            checked += 1
    assert checked >= 2


def test_the_dry_run_cell_stops_the_notebook_if_alignment_or_fit_fails(cells):
    src = next(s for s in _code(cells) if '"--dry-run"' in s)
    assert 'd["alignment"]["aligned"]' in src and 'd["fits"]' in src and "do NOT train" in src and src.count("assert") >= 3


def test_library_pins_match_the_versions_the_scripts_were_tested_with(cells):
    lock = (ROOT / "requirements-lock.txt").read_text()
    install = next(s for s in _code(cells) if "pip install" in s and "trl==" in s)
    for name, version in re.findall(r'"?([A-Za-z0-9_-]+)==([0-9.]+)"?', install):
        assert re.search(rf"^{re.escape(name)}=={re.escape(version)}$", lock, re.M | re.I), f"{name}=={version} is not what was tested"


def test_safety_and_honesty_guards_are_in_the_notebook(cells):
    text = "\n".join("".join(c["source"]) for c in cells)
    assert "torch.cuda.is_available()" in text and "--resume" in text and "--load-4bit" in text            # GPU check, disconnect recovery, 4-bit eval
    assert "n < 50" in text and "fell back to the template" in text and "not run on Colab by its author" in text
    assert "mistralai/Mistral-7B-Instruct-v0.3" in text


def test_the_upload_cell_survives_a_rerun_from_inside_the_project_folder(cells, tmp_path, monkeypatch):
    """Real failure on Colab: files.upload() saves into the CURRENT folder, and a re-run of this cell starts inside the project folder it is about to
    delete -> FileNotFoundError. Run the cell's own code against a fake google.colab (whose upload writes relative to the cwd, like the real one),
    starting from a deleted working directory."""
    import io
    import os
    import shutil
    import types
    import zipfile

    src = next(s for s in _code(cells) if "files.upload()" in s)
    root = tmp_path / "content"                                       # stands in for Colab's /content
    root.mkdir()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("strategy_agent/__init__.py", "")
    data = buf.getvalue()

    def fake_upload():
        with open("strategy_agent_colab.zip", "ab") as f:             # relative to the cwd, exactly like google.colab.files.upload
            f.write(data)
        return {"strategy_agent_colab.zip": data}

    google, colab = types.ModuleType("google"), types.ModuleType("google.colab")
    colab.files = types.SimpleNamespace(upload=fake_upload)
    colab.drive = types.SimpleNamespace(mount=lambda *_a, **_k: None)
    google.colab = colab
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.colab", colab)
    code = _split(src)[0].replace("/content", str(root)).replace("USE_DRIVE", "False") if "USE_DRIVE" in src else _split(src)[0].replace("/content", str(root))
    stale = root / "strategy-agent"                                   # the previous run's project folder, which the notebook is "inside"
    stale.mkdir()
    monkeypatch.chdir(stale)
    shutil.rmtree(stale)                                              # the cwd no longer exists: the state that broke the upload
    exec(compile(code, "storage_cell", "exec"), {"USE_DRIVE": False, "__name__": "__main__"})
    assert (root / "strategy-agent" / "strategy_agent" / "__init__.py").exists()
    assert os.path.realpath(os.getcwd()) == os.path.realpath(root / "strategy-agent")
