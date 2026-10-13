"""The lightweight local experiment log (the MLflow stand-in)."""
from __future__ import annotations

import json
import threading

import pytest

from strategy_agent import experiments
from strategy_agent.data.seed_generator import write_dataset
from strategy_agent.experiments import ExperimentLog


def test_log_and_list_round_trip(tmp_path):
    log = ExperimentLog(tmp_path / "x" / "runs.jsonl")
    rid = log.log("eval", {"k": 5}, {"auc": 0.7}, ["report.html"], duration_s=1.234)
    log.log("sft", {"lr": 2e-4}, {"loss": 1.0})
    rows = log.list()
    assert [r["kind"] for r in rows] == ["eval", "sft"] and rows[0]["run_id"] == rid and rows[0]["duration_s"] == 1.23
    assert log.get(rid)["metrics"] == {"auc": 0.7} and log.get("nope") is None
    assert [r["kind"] for r in log.list(kind="sft")] == ["sft"] and len(log.list(last=1)) == 1
    assert {"python", "platform", "git_commit"} <= set(rows[0]["env"])
    assert ExperimentLog(tmp_path / "empty.jsonl").list() == []


def test_run_context_records_success_and_failure_and_still_raises(tmp_path):
    log = ExperimentLog(tmp_path / "runs.jsonl")
    with log.run("eval", {"a": 1}) as r:
        r.metrics["m"] = 2
        r.artifacts.append("out/")
    with pytest.raises(ValueError):
        with log.run("eval", {"a": 2}) as r:
            r.metrics["partial"] = 1
            raise ValueError("boom")
    with log.run("sft", {}) as r:
        r.status = "dry_run"
    ok, bad, dry = log.list()
    assert ok["status"] == "finished" and ok["metrics"] == {"m": 2} and ok["artifacts"] == ["out/"] and ok["duration_s"] >= 0
    assert bad["status"] == "failed" and bad["tags"]["error"] == "ValueError" and bad["metrics"] == {"partial": 1}      # the error TYPE, not its message
    assert dry["status"] == "dry_run"


def test_concurrent_appends_keep_every_line_valid_json(tmp_path):
    log = ExperimentLog(tmp_path / "runs.jsonl")
    threads = [threading.Thread(target=lambda i=i: [log.log("eval", {"i": i, "j": j}, {"x": j}) for j in range(20)]) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    lines = (tmp_path / "runs.jsonl").read_text().splitlines()
    assert len(lines) == 160 and all(json.loads(line)["kind"] == "eval" for line in lines)
    assert len({json.loads(line)["run_id"] for line in lines}) == 160


def test_cli_lists_runs(tmp_path, capsys):
    log = ExperimentLog(tmp_path / "runs.jsonl")
    experiments.main(["--log", str(tmp_path / "runs.jsonl")])
    assert "no runs recorded" in capsys.readouterr().out
    log.log("eval", {}, {"pii_leakage_rate": 0.0, "k_anonymity_ok": True})
    experiments.main(["--log", str(tmp_path / "runs.jsonl"), "--kind", "eval"])
    out = capsys.readouterr().out
    assert "eval" in out and "pii_leakage_rate=0.0" in out and "finished" in out


def test_dataset_builds_are_recorded(tmp_path):
    log = ExperimentLog(tmp_path / "runs.jsonl")
    write_dataset(30, 4, tmp_path / "ds", experiment_log=log)
    rec = log.list("dataset")[0]
    assert rec["params"]["n"] == 30 and rec["metrics"]["examples"] == 30 and str(tmp_path / "ds") in rec["artifacts"] and rec["status"] == "finished"
