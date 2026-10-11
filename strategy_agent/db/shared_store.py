"""Shared-insights database. It has no tenant_id column anywhere.

SharedReader : read-only, handed to the API. Only published, aggregated insights are readable through it.
SharedStore  : the writer, used only by privacy/pipeline.py (the sole component allowed to write here).
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from .models import SHARED_DDL


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SharedReader:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._tx() as conn:
            conn.executescript(SHARED_DDL)

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _insight(r: sqlite3.Row) -> dict:
        return {"contribution_id": r["insight_id"], "industry_bucket": r["industry_bucket"], "region": r["region"],
                "budget_band": r["budget_band"], "objective": r["objective"], "channel_mix": json.loads(r["channel_mix_json"]),
                "outcome_metrics": json.loads(r["outcome_metrics_json"]), "support_count": r["support_count"],
                "angle": r["angle"], "summary": r["summary"]}

    def query_insights(self, industry_bucket: Optional[str] = None, objective: Optional[str] = None,
                       region: Optional[str] = None, limit: int = 20) -> list[dict]:
        sql, params = "SELECT * FROM insights WHERE 1=1", []
        for col, val in (("industry_bucket", industry_bucket), ("objective", objective), ("region", region)):
            if val:
                sql += f" AND {col} = ?"
                params.append(val)
        sql += " ORDER BY support_count DESC, insight_id ASC LIMIT ?"
        params.append(int(limit))
        with self._tx() as conn:
            return [self._insight(r) for r in conn.execute(sql, params).fetchall()]

    def count_insights(self) -> int:
        with self._tx() as conn:
            return conn.execute("SELECT COUNT(*) FROM insights").fetchone()[0]


class SharedStore(SharedReader):
    """Writer. Keep this object away from the API routes: they get a SharedReader."""

    def add_contribution(self, rec: dict) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO contributions (contribution_id, contributor_token, industry_bucket, region, budget_band, objective,"
                " channel_mix_json, outcome_json, angle, duration_bucket, period, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (rec["contribution_id"], rec["contributor_token"], rec["industry_bucket"], rec["region"], rec["budget_band"],
                 rec["objective"], json.dumps(rec["channel_mix"], sort_keys=True), json.dumps(rec["outcome_metrics"], sort_keys=True),
                 rec.get("angle"), rec.get("duration_bucket"), rec.get("period"), _now()),
            )

    def list_contributions(self) -> list[dict]:
        with self._tx() as conn:
            rows = conn.execute("SELECT * FROM contributions ORDER BY created_at, contribution_id").fetchall()
        return [{"contribution_id": r["contribution_id"], "contributor_token": r["contributor_token"],
                 "industry_bucket": r["industry_bucket"], "region": r["region"], "budget_band": r["budget_band"],
                 "objective": r["objective"], "channel_mix": json.loads(r["channel_mix_json"]),
                 "outcome_metrics": json.loads(r["outcome_json"]), "angle": r["angle"],
                 "duration_bucket": r["duration_bucket"], "period": r["period"]} for r in rows]

    def count_contributions(self) -> int:
        with self._tx() as conn:
            return conn.execute("SELECT COUNT(*) FROM contributions").fetchone()[0]

    def delete_contributions(self, contribution_ids: list[str]) -> int:
        if not contribution_ids:
            return 0
        with self._tx() as conn:
            marks = ",".join("?" for _ in contribution_ids)
            return conn.execute(f"DELETE FROM contributions WHERE contribution_id IN ({marks})", contribution_ids).rowcount

    def replace_insights(self, insights: list[dict]) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM insights")
            for i in insights:
                conn.execute(
                    "INSERT INTO insights (insight_id, industry_bucket, region, budget_band, objective, channel_mix_json,"
                    " outcome_metrics_json, support_count, angle, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (i.get("insight_id") or i["contribution_id"], i["industry_bucket"], i["region"], i["budget_band"], i["objective"],
                     json.dumps(i["channel_mix"], sort_keys=True), json.dumps(i["outcome_metrics"], sort_keys=True),
                     i["support_count"], i.get("angle"), i["summary"], _now()),
                )

    _OPAQUE = {"contribution_id", "contributor_token", "insight_id", "created_at"}

    def dump_all_text(self, include_opaque: bool = False) -> str:
        """Every stored VALUE as one string, for leak scans. Random ids, tokens and timestamps are excluded by default (they cannot
        carry meaning and only cause coincidental digit matches); `opaque_ids_are_random_hex` checks their format separately."""
        out: list[str] = []
        with self._tx() as conn:
            for table in ("contributions", "insights"):
                for r in conn.execute(f"SELECT * FROM {table}").fetchall():
                    out.extend(str(v) for k, v in dict(r).items() if v is not None and (include_opaque or k not in self._OPAQUE))
        return "\n".join(out)

    def opaque_ids_are_random_hex(self) -> bool:
        """Ids / tokens must be pure hex (uuid-shaped), so nothing identifying can be hidden inside them."""
        import re
        pat = re.compile(r"^[0-9a-f-]{32,36}$")
        with self._tx() as conn:
            vals = [r[0] for r in conn.execute("SELECT contribution_id FROM contributions")] + \
                   [r[0] for r in conn.execute("SELECT contributor_token FROM contributions")] + [r[0] for r in conn.execute("SELECT insight_id FROM insights")]
        return all(pat.match(v) for v in vals)
