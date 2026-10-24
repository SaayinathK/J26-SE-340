# services/lead-intel/src/repositories/postgres_repo.py — history in the C3 Postgres database (lead_intel)
# Tables: lead_scores, recommendations, lead_outcomes (services/lead-intel/db/migrations/001_init.sql).
# Every query runs inside a transaction that first sets app.current_tenant; row-level security in
# the database then only shows and accepts rows of that tenant, even if a query forgot its WHERE.
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from repositories.base import HistoryRepo, RepoUnavailable, recommendation_fields, summarise

SCORE_COLS = "score_id::text AS id, lead_id, score, segment, top_factors, confidence, alert, model_version, source, created_at"
REC_COLS = ("recommendation_id::text AS id, lead_id, score, segment, next_best_action, message_draft, sources, "
            "grounded, policy_check, policy_rule, confidence, llm_model, retrieval_method, latency_sec, status, created_at")
OUT_COLS = "outcome_id::text AS id, lead_id, outcome, score, segment, model_version, created_at"


def _clean(row: dict) -> dict:
    r = dict(row)
    r["created_at"] = r["created_at"].isoformat(timespec="milliseconds")
    for k, v in r.items():
        if isinstance(v, Decimal):                   # NUMERIC columns -> plain numbers for JSON
            r[k] = float(v)
    return r


class PostgresHistoryRepo(HistoryRepo):
    kind = "postgres"

    def __init__(self, url: str):
        self.url = url

    def _run(self, tenant: str, sql: str, params: tuple = (), many: bool = True):
        try:
            with psycopg.connect(self.url, row_factory=dict_row, connect_timeout=5) as conn:
                conn.execute("SELECT set_config('app.current_tenant', %s, true)", (tenant,))
                cur = conn.execute(sql, params)
                if cur.description is None:
                    return None
                return [_clean(r) for r in cur.fetchall()] if many else (
                    _clean(r) if (r := cur.fetchone()) else None)
        except psycopg.OperationalError as e:
            raise RepoUnavailable(str(e)) from e

    # ---------- scores ----------
    def add_score(self, tenant, lead_id, row):
        return self._run(tenant, f"""
            INSERT INTO lead_scores (tenant, lead_id, score, segment, top_factors, confidence, alert, model_version, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING {SCORE_COLS}""",
            (tenant, lead_id, row["score"], row["segment"], Jsonb(row.get("top_factors") or []),
             Jsonb(row.get("confidence")), Jsonb(row.get("alert")), row["model_version"],
             row.get("source", "api")), many=False)

    def last_score(self, tenant, lead_id):
        return self._run(tenant, f"""
            SELECT {SCORE_COLS} FROM lead_scores WHERE tenant = %s AND lead_id = %s
            ORDER BY created_at DESC, score_id DESC LIMIT 1""", (tenant, lead_id), many=False)

    # ---------- recommendations ----------
    def add_recommendation(self, tenant, lead_id, rec):
        f = recommendation_fields(rec)
        return self._run(tenant, f"""
            INSERT INTO recommendations (tenant, lead_id, score, segment, next_best_action, message_draft, sources,
                grounded, policy_check, policy_rule, confidence, llm_model, retrieval_method, latency_sec, response)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING {REC_COLS}""",
            (tenant, lead_id, f["score"], f["segment"], f["next_best_action"], f["message_draft"],
             Jsonb(f["sources"]), f["grounded"], f["policy_check"], f["policy_rule"], f["confidence"], f["llm_model"],
             f["retrieval_method"], f["latency_sec"], Jsonb(rec)), many=False)

    # ---------- outcomes ----------
    def add_outcome(self, tenant, lead_id, row):
        return self._run(tenant, f"""
            INSERT INTO lead_outcomes (tenant, lead_id, outcome, score, segment, model_version)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING {OUT_COLS}""",
            (tenant, lead_id, row["outcome"], row["score"], row["segment"], row["model_version"]), many=False)

    def outcomes(self, tenant):
        return self._run(tenant, f"SELECT {OUT_COLS} FROM lead_outcomes WHERE tenant = %s "
                                 "ORDER BY created_at, outcome_id", (tenant,))

    # ---------- history views ----------
    def lead_history(self, tenant, lead_id):
        q = "FROM {t} WHERE tenant = %s AND lead_id = %s ORDER BY created_at, {pk}"
        return {
            "scores": self._run(tenant, f"SELECT {SCORE_COLS} " + q.format(t="lead_scores", pk="score_id"),
                                (tenant, lead_id)),
            "recommendations": self._run(tenant, f"SELECT {REC_COLS} " + q.format(t="recommendations",
                                                                                  pk="recommendation_id"),
                                         (tenant, lead_id)),
            "outcomes": self._run(tenant, f"SELECT {OUT_COLS} " + q.format(t="lead_outcomes", pk="outcome_id"),
                                  (tenant, lead_id)),
        }

    def leads_summary(self, tenant):
        s = self._run(tenant, "SELECT lead_id, score, segment, created_at FROM lead_scores "
                              "WHERE tenant = %s ORDER BY created_at, score_id", (tenant,))
        r = self._run(tenant, "SELECT lead_id, created_at FROM recommendations "
                              "WHERE tenant = %s ORDER BY created_at, recommendation_id", (tenant,))
        o = self._run(tenant, "SELECT lead_id, outcome, created_at FROM lead_outcomes "
                              "WHERE tenant = %s ORDER BY created_at, outcome_id", (tenant,))
        return summarise(s, r, o)
