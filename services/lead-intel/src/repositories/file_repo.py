# services/lead-intel/src/repositories/file_repo.py — history in JSON-lines files (local runs and tests)
# One line per event, appended, never overwritten: scores.jsonl, recommendations.jsonl, outcomes.jsonl
import json
import threading
import uuid
from pathlib import Path

from repositories.base import HistoryRepo, now_iso, recommendation_fields, summarise

_LOCK = threading.Lock()


class FileHistoryRepo(HistoryRepo):
    kind = "file"

    def __init__(self, state_dir: Path):
        self.dir = Path(state_dir)

    # ---------- low level ----------
    def _file(self, name: str) -> Path:
        return self.dir / f"{name}.jsonl"

    def _append(self, name: str, row: dict) -> dict:
        with _LOCK:
            self.dir.mkdir(parents=True, exist_ok=True)
            with open(self._file(name), "a", encoding="utf-8") as f:
                f.write(json.dumps(row, default=str) + "\n")
        return row

    def _rows(self, name: str, tenant: str, lead_id: str | None = None) -> list[dict]:
        f = self._file(name)
        if not f.exists():
            return []
        with _LOCK, open(f, encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
        return [r for r in rows if r["tenant"] == tenant and (lead_id is None or r["lead_id"] == lead_id)]

    @staticmethod
    def _public(row: dict) -> dict:
        return {k: v for k, v in row.items() if k != "tenant"}

    # ---------- scores ----------
    def add_score(self, tenant, lead_id, row):
        r = {"id": str(uuid.uuid4()), "tenant": tenant, "lead_id": lead_id, **row, "created_at": now_iso()}
        return self._public(self._append("scores", r))

    def last_score(self, tenant, lead_id):
        rows = self._rows("scores", tenant, lead_id)
        return self._public(rows[-1]) if rows else None

    # ---------- recommendations ----------
    def add_recommendation(self, tenant, lead_id, rec):
        r = {"id": str(uuid.uuid4()), "tenant": tenant, "lead_id": lead_id, **recommendation_fields(rec),
             "status": "new", "created_at": now_iso()}
        return self._public(self._append("recommendations", r))

    # ---------- outcomes ----------
    def add_outcome(self, tenant, lead_id, row):
        r = {"id": str(uuid.uuid4()), "tenant": tenant, "lead_id": lead_id, **row, "created_at": now_iso()}
        return self._public(self._append("outcomes", r))

    def outcomes(self, tenant):
        return [self._public(r) for r in self._rows("outcomes", tenant)]

    # ---------- history views ----------
    def lead_history(self, tenant, lead_id):
        return {k: [self._public(r) for r in self._rows(k, tenant, lead_id)]
                for k in ("scores", "recommendations", "outcomes")}

    def leads_summary(self, tenant):
        return summarise(self._rows("scores", tenant), self._rows("recommendations", tenant),
                         self._rows("outcomes", tenant))
