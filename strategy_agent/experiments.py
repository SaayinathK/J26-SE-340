"""A lightweight local experiment log: the prototype's stand-in for MLflow.

Every evaluation, dataset build and training run (including dry runs) appends one JSON line to `experiments/runs.jsonl` with its
parameters, headline metrics, artifacts, duration, status and environment. Append-only, human-readable, diff-able, no server.

    python -m strategy_agent.experiments                 # the last 15 runs
    python -m strategy_agent.experiments --kind eval     # only evaluations
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

_LOCK = threading.Lock()


def _git_commit() -> Optional[str]:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=3, cwd=Path(__file__).resolve().parent)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except Exception:
        return None


def _env() -> dict:
    return {"python": platform.python_version(), "platform": platform.platform(), "git_commit": _git_commit()}


class Run:
    """Mutable handle given to the code inside `ExperimentLog.run(...)`."""

    def __init__(self) -> None:
        self.metrics: dict[str, Any] = {}
        self.artifacts: list[str] = []
        self.status = "finished"
        self.tags: dict[str, str] = {}


class ExperimentLog:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, kind: str, params: dict, metrics: Optional[dict] = None, artifacts: Optional[list[str]] = None, status: str = "finished",
            duration_s: Optional[float] = None, tags: Optional[dict] = None, started_at: Optional[str] = None) -> str:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rec = {"run_id": uuid.uuid4().hex[:12], "kind": kind, "status": status, "started_at": started_at or now, "finished_at": now,
               "duration_s": round(duration_s, 2) if duration_s is not None else None, "params": params, "metrics": metrics or {},
               "artifacts": artifacts or [], "tags": tags or {}, "env": _env()}
        line = json.dumps(rec, default=str, ensure_ascii=False) + "\n"
        with _LOCK, open(self.path, "a", encoding="utf-8") as f:    # one write call per record keeps lines intact
            f.write(line)
            f.flush()
            os.fsync(f.fileno())
        return rec["run_id"]

    @contextmanager
    def run(self, kind: str, params: dict, tags: Optional[dict] = None) -> Iterator[Run]:
        """Times the block and records it as `finished` (or `failed` with the error type if it raises). The exception still propagates."""
        r = Run()
        r.tags = dict(tags or {})
        t0, started = time.time(), datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            yield r
        except Exception as exc:
            self.log(kind, params, r.metrics, r.artifacts, "failed", time.time() - t0, {**r.tags, "error": type(exc).__name__}, started)
            raise
        self.log(kind, params, r.metrics, r.artifacts, r.status, time.time() - t0, r.tags, started)

    def list(self, kind: Optional[str] = None, last: Optional[int] = None) -> list[dict]:
        if not self.path.exists():
            return []
        rows = [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines() if line.strip()]
        rows = [r for r in rows if kind is None or r["kind"] == kind]
        return rows[-last:] if last else rows

    def get(self, run_id: str) -> Optional[dict]:
        return next((r for r in self.list() if r["run_id"] == run_id), None)


def default_log() -> ExperimentLog:
    from .config import get_settings

    s = get_settings()
    return ExperimentLog(s.resolve(s.experiment_log_path))


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Show recent experiment runs")
    ap.add_argument("--kind")
    ap.add_argument("--last", type=int, default=15)
    ap.add_argument("--log")
    a = ap.parse_args(argv)
    log = ExperimentLog(a.log) if a.log else default_log()
    rows = log.list(a.kind, a.last)
    if not rows:
        print(f"no runs recorded in {log.path}")
        return
    print(f"{'run_id':13} {'kind':9} {'status':9} {'seconds':>8}  {'finished_at':20}  headline")
    for r in rows:
        head = ", ".join(f"{k}={v}" for k, v in list(r["metrics"].items())[:3])
        print(f"{r['run_id']:13} {r['kind']:9} {r['status']:9} {r['duration_s'] if r['duration_s'] is not None else '':>8}  {r['finished_at']:20}  {head}")


if __name__ == "__main__":
    main(sys.argv[1:])
