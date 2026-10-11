"""Tenant-scoped repository.

The rule that matters: there is NO method on TenantRepo that takes a tenant_id. A repo is created from a
TenantContext (which came from the auth token) and every SELECT / UPDATE / DELETE is built by helpers that
append `tenant_id = ?` automatically. An unscoped query cannot be written through this class.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from ..auth import TenantContext
from .models import TENANT_DDL, TENANT_TABLES


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _j(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


class TenantStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._tx() as conn:
            conn.executescript(TENANT_DDL)

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

    def scoped(self, ctx: TenantContext) -> "TenantRepo":
        return TenantRepo(self, ctx)

    # ---- system-level helper for the trusted batch pipeline ONLY. Returns ids, never tenant data.
    def list_tenants_with_active_consent(self) -> list[str]:
        with self._tx() as conn:
            rows = conn.execute("SELECT tenant_id FROM consent WHERE opted_in = 1 AND revoked_at IS NULL").fetchall()
        return [r["tenant_id"] for r in rows]


class TenantRepo:
    """All data access for ONE tenant."""

    def __init__(self, store: TenantStore, ctx: TenantContext) -> None:
        if not ctx.tenant_id:
            raise ValueError("a tenant context with a tenant_id is required")
        self._store = store
        self._tid = ctx.tenant_id
        self.ctx = ctx

    # ------------------------------------------------------------------ scoped primitives (the only SQL here)
    @staticmethod
    def _check_table(table: str) -> str:
        if table not in TENANT_TABLES:
            raise ValueError(f"unknown table {table}")
        return table

    def _select(self, table: str, where: str = "", params: tuple = (), order: str = "", limit: Optional[int] = None) -> list[dict]:
        sql = f"SELECT * FROM {self._check_table(table)} WHERE tenant_id = ?" + (f" AND ({where})" if where else "")
        if order:
            sql += f" ORDER BY {order}"
        if limit:
            sql += f" LIMIT {int(limit)}"
        with self._store._tx() as conn:
            return [dict(r) for r in conn.execute(sql, (self._tid, *params)).fetchall()]

    def _insert(self, table: str, values: dict, replace: bool = False) -> None:
        cols = {**values, "tenant_id": self._tid}  # tenant_id is forced; a caller cannot override it
        verb = "INSERT OR REPLACE" if replace else "INSERT"
        sql = f"{verb} INTO {self._check_table(table)} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})"
        with self._store._tx() as conn:
            conn.execute(sql, tuple(cols.values()))

    def _update(self, table: str, values: dict, where: str, params: tuple = ()) -> int:
        sets = ", ".join(f"{k} = ?" for k in values)
        sql = f"UPDATE {self._check_table(table)} SET {sets} WHERE tenant_id = ? AND ({where})"
        with self._store._tx() as conn:
            return conn.execute(sql, (*values.values(), self._tid, *params)).rowcount

    def _delete(self, table: str, where: str = "1=1", params: tuple = ()) -> int:
        sql = f"DELETE FROM {self._check_table(table)} WHERE tenant_id = ? AND ({where})"
        with self._store._tx() as conn:
            return conn.execute(sql, (self._tid, *params)).rowcount

    # ------------------------------------------------------------------ profile
    def upsert_profile(self, profile: dict) -> None:
        existing = self._select("tenant_profiles")
        token = existing[0]["contributor_token"] if existing else None
        self._insert("tenant_profiles", {"profile_json": _j(profile), "contributor_token": token, "updated_at": _now()}, replace=True)

    def get_profile(self) -> Optional[dict]:
        rows = self._select("tenant_profiles")
        return json.loads(rows[0]["profile_json"]) if rows else None

    def get_or_create_contributor_token(self, rotate: bool = False) -> str:
        rows = self._select("tenant_profiles")
        if rows and rows[0]["contributor_token"] and not rotate:
            return rows[0]["contributor_token"]
        token = uuid.uuid4().hex
        if rows:
            self._update("tenant_profiles", {"contributor_token": token}, "1=1")
        else:
            self._insert("tenant_profiles", {"profile_json": "{}", "contributor_token": token, "updated_at": _now()})
        return token

    # ------------------------------------------------------------------ campaigns
    def add_campaign(self, *, industry: str, region: str, objective: str, monthly_budget: float, channel_mix: dict[str, float],
                     business_model: Optional[str] = None, duration_weeks: Optional[int] = None, messaging_text: str = "",
                     outcome: Optional[dict] = None, period_date: Optional[str] = None, recommendation_id: Optional[str] = None,
                     status: str = "completed") -> str:
        cid = str(uuid.uuid4())
        self._insert("campaigns", {
            "id": cid, "recommendation_id": recommendation_id, "industry": industry, "business_model": business_model,
            "region": region, "objective": objective, "monthly_budget": monthly_budget, "channel_mix_json": _j(channel_mix),
            "duration_weeks": duration_weeks, "messaging_text": messaging_text, "outcome_json": _j(outcome) if outcome else None,
            "period_date": period_date, "status": status, "share_status": "pending", "created_at": _now(),
        })
        return cid

    @staticmethod
    def _campaign(row: dict) -> dict:
        row = dict(row)
        row["channel_mix"] = json.loads(row.pop("channel_mix_json"))
        row["outcome"] = json.loads(row["outcome_json"]) if row.get("outcome_json") else None
        return row

    def get_campaign(self, campaign_id: str) -> Optional[dict]:
        rows = self._select("campaigns", "id = ?", (campaign_id,))
        return self._campaign(rows[0]) if rows else None

    def list_campaigns(self, objective: Optional[str] = None, limit: int = 50) -> list[dict]:
        rows = self._select("campaigns", "objective = ?" if objective else "", (objective,) if objective else (),
                            order="created_at DESC", limit=limit)
        return [self._campaign(r) for r in rows]

    def list_pending_share_campaigns(self) -> list[dict]:
        rows = self._select("campaigns", "status = 'completed' AND share_status = 'pending' AND outcome_json IS NOT NULL",
                            order="created_at ASC")
        return [self._campaign(r) for r in rows]

    def set_share_status(self, campaign_id: str, status: str, note: str = "") -> None:
        self._update("campaigns", {"share_status": status, "share_note": note}, "id = ?", (campaign_id,))

    def reset_share_status(self) -> int:
        """After a revocation + re-grant, previously 'shared' campaigns can be shared again."""
        return self._update("campaigns", {"share_status": "pending", "share_note": None}, "share_status IN ('shared', 'rejected')")

    def objective_baseline(self, objective: str, metric: str) -> Optional[float]:
        values = [c["outcome"][metric] for c in self.list_campaigns(objective, limit=200)
                  if c["outcome"] and metric in c["outcome"] and c.get("recommendation_id") is None]
        return sum(values) / len(values) if values else None

    # ------------------------------------------------------------------ consent
    def get_consent(self) -> dict:
        rows = self._select("consent")
        if not rows:
            return {"opted_in": False, "scopes": [], "consent_version": "v1", "granted_by": None, "granted_at": None, "revoked_at": None}
        r = rows[0]
        return {"opted_in": bool(r["opted_in"]), "scopes": json.loads(r["scopes_json"]), "consent_version": r["consent_version"],
                "granted_by": r["granted_by"], "granted_at": r["granted_at"], "revoked_at": r["revoked_at"]}

    def set_consent(self, *, opted_in: bool, scopes: list[str], consent_version: str, granted_by: Optional[str],
                    granted_at: Optional[str], revoked_at: Optional[str]) -> None:
        self._insert("consent", {"opted_in": int(opted_in), "scopes_json": _j(scopes), "consent_version": consent_version,
                                 "granted_by": granted_by, "granted_at": granted_at, "revoked_at": revoked_at}, replace=True)

    # ------------------------------------------------------------------ contribution ledger (tenant-side link only)
    def add_ledger(self, contribution_id: str, campaign_id: str) -> None:
        self._insert("contribution_ledger", {"contribution_id": contribution_id, "campaign_id": campaign_id, "created_at": _now()})

    def ledger_contribution_ids(self) -> list[str]:
        return [r["contribution_id"] for r in self._select("contribution_ledger")]

    def clear_ledger(self) -> int:
        return self._delete("contribution_ledger")

    def remove_ledger(self, contribution_id: str) -> int:
        return self._delete("contribution_ledger", "contribution_id = ?", (contribution_id,))

    # ------------------------------------------------------------------ recommendations
    def save_recommendation(self, *, recommendation_id: str, request: dict, strategies: list[dict], model_version: str,
                            adapter_id: str, generator_used: str, evidence: dict, prompt_hash: str, prompt_text: str, ranking: dict) -> None:
        self._insert("recommendations", {
            "recommendation_id": recommendation_id, "request_json": _j(request), "strategies_json": _j(strategies),
            "model_version": model_version, "adapter_id": adapter_id, "generator_used": generator_used,
            "evidence_json": _j(evidence), "prompt_hash": prompt_hash, "prompt_text": prompt_text,
            "ranking_json": _j(ranking), "created_at": _now(),
        })

    def get_recommendation(self, recommendation_id: str) -> Optional[dict]:
        rows = self._select("recommendations", "recommendation_id = ?", (recommendation_id,))
        if not rows:
            return None
        r = rows[0]
        for key in ("request", "strategies", "evidence", "ranking"):
            r[key] = json.loads(r.pop(f"{key}_json"))
        return r

    def list_recommendations(self, limit: int = 50) -> list[dict]:
        ids = [r["recommendation_id"] for r in self._select("recommendations", order="created_at DESC", limit=limit)]
        return [self.get_recommendation(i) for i in ids]  # type: ignore[misc]

    # ------------------------------------------------------------------ feedback / outcomes / rewards
    def add_feedback(self, *, recommendation_id: str, decision: str, strategy_id: Optional[str], edited_version: Optional[dict],
                     rating: Optional[int], comment: str) -> str:
        fid = str(uuid.uuid4())
        self._insert("feedback", {"id": fid, "recommendation_id": recommendation_id, "strategy_id": strategy_id, "decision": decision,
                                  "edited_version_json": _j(edited_version) if edited_version else None, "rating": rating,
                                  "comment": comment, "created_at": _now()})
        return fid

    def list_feedback(self, recommendation_id: Optional[str] = None) -> list[dict]:
        rows = self._select("feedback", "recommendation_id = ?" if recommendation_id else "",
                            (recommendation_id,) if recommendation_id else (), order="created_at ASC")
        for r in rows:
            r["edited_version"] = json.loads(r["edited_version_json"]) if r["edited_version_json"] else None
        return rows

    def add_outcome(self, *, recommendation_id: str, metrics: dict, primary_metric: str, baseline: Optional[float],
                    uplift: Optional[float], period: str) -> str:
        oid = str(uuid.uuid4())
        self._insert("outcomes", {"id": oid, "recommendation_id": recommendation_id, "metrics_json": _j(metrics),
                                  "primary_metric": primary_metric, "baseline": baseline, "uplift": uplift, "period": period,
                                  "created_at": _now()})
        return oid

    def get_outcome(self, recommendation_id: str) -> Optional[dict]:
        rows = self._select("outcomes", "recommendation_id = ?", (recommendation_id,), order="created_at DESC", limit=1)
        if not rows:
            return None
        rows[0]["metrics"] = json.loads(rows[0]["metrics_json"])
        return rows[0]

    def upsert_reward(self, recommendation_id: str, reward: float, components: dict) -> None:
        self._insert("rewards", {"recommendation_id": recommendation_id, "reward": reward, "components_json": _j(components),
                                 "updated_at": _now()}, replace=True)

    def get_reward(self, recommendation_id: str) -> Optional[dict]:
        rows = self._select("rewards", "recommendation_id = ?", (recommendation_id,))
        if not rows:
            return None
        rows[0]["components"] = json.loads(rows[0]["components_json"])
        return rows[0]

    # ------------------------------------------------------------------ preference pairs (stay in the tenant DB)
    def add_pair(self, *, recommendation_id: str, pair_kind: str, prompt: str, chosen: str, rejected: str,
                 reward_chosen: Optional[float], reward_rejected: Optional[float]) -> str:
        pid = str(uuid.uuid4())
        self._insert("preference_pairs", {"id": pid, "recommendation_id": recommendation_id, "pair_kind": pair_kind, "prompt": prompt,
                                          "chosen": chosen, "rejected": rejected, "reward_chosen": reward_chosen,
                                          "reward_rejected": reward_rejected, "created_at": _now()})
        return pid

    def list_pairs(self) -> list[dict]:
        return self._select("preference_pairs", order="created_at ASC")

    def delete_pairs_for(self, recommendation_id: str, pair_kind: Optional[str] = None) -> int:
        if pair_kind:
            return self._delete("preference_pairs", "recommendation_id = ? AND pair_kind = ?", (recommendation_id, pair_kind))
        return self._delete("preference_pairs", "recommendation_id = ?", (recommendation_id,))
