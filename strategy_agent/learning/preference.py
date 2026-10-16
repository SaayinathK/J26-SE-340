"""Preference pairs for DPO, built from real feedback and outcomes.

Rules (chosen / rejected are single strategies, rendered as the JSON the model is trained to emit):
  edited     -> chosen = the tenant's edited version,           rejected = the original strategy        (kind "edit")
  accepted   -> chosen = the accepted strategy,                 rejected = the lowest-ranked other      (kind "accepted_vs_other")
  rejected   -> chosen = the best-ranked other (not rejected),  rejected = the rejected strategy         (kind "rejected_vs_other")
  reward>=+0.3 (needs a measured outcome) -> chosen = the strategy that was run,           rejected = the lowest-ranked other      (kind "high_reward")
  reward<=-0.3 -> chosen = the best-ranked other,               rejected = the strategy that was run    (kind "low_reward")

Pairs are tenant data: they stay in the tenant's own DB and are exported per tenant. The DPO train step itself needs a GPU
(training/dpo.py); locally we only build and store the pairs.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Optional

from ..db.tenant_store import TenantRepo

HIGH, LOW = 0.3, -0.3


def _render(strategy: dict) -> str:
    s = {k: v for k, v in strategy.items() if k not in ("rank", "evidence")}
    return json.dumps([s], ensure_ascii=False, sort_keys=True)


def _single_strategy_prompt(prompt_text: str) -> str:
    return re.sub(r"exactly \d+ different strategies", "exactly 1 strategy", prompt_text)


def messages_from_prompt_text(prompt_text: str) -> list[dict]:
    m = re.match(r"\[system\]\n(.*?)\n\[user\]\n(.*)\Z", prompt_text, re.S)
    return [{"role": "system", "content": m.group(1)}, {"role": "user", "content": m.group(2)}] if m else [{"role": "user", "content": prompt_text}]


def _by_id(strategies: list[dict], sid: Optional[str]) -> Optional[dict]:
    return next((s for s in strategies if s["strategy_id"] == sid), None)


def build_pairs(rec: dict, feedback: list[dict], reward: Optional[float]) -> list[dict]:
    strategies = sorted(rec["strategies"], key=lambda s: s["rank"])
    if not strategies:
        return []
    top = strategies[0]
    pairs: list[dict] = []

    def others(exclude_ids: set[str]) -> list[dict]:
        return [s for s in strategies if s["strategy_id"] not in exclude_ids]

    def add(kind: str, chosen: dict, rejected: dict) -> None:
        c, r = _render(chosen), _render(rejected)
        if c != r:
            pairs.append({"pair_kind": kind, "chosen": c, "rejected": r})

    executed = top
    for fb in feedback:
        s = _by_id(strategies, fb["strategy_id"]) or top
        if fb["decision"] == "edited" and fb.get("edited_version"):
            add("edit", fb["edited_version"], s)
            executed = fb["edited_version"]
        elif fb["decision"] == "accepted":
            rest = others({s["strategy_id"]})
            if rest:
                add("accepted_vs_other", s, rest[-1])
            executed = s
        elif fb["decision"] == "rejected":
            rejected_ids = {f["strategy_id"] or top["strategy_id"] for f in feedback if f["decision"] == "rejected"}
            rest = others(rejected_ids)
            if rest:
                add("rejected_vs_other", rest[0], s)
    if reward is not None and abs(reward) >= HIGH:
        ex_id = executed.get("strategy_id")
        rest = others({ex_id})
        if rest:
            if reward >= HIGH:
                add("high_reward", executed, rest[-1])
            else:
                add("low_reward", rest[0], executed)
    seen, unique = set(), []
    for p in pairs:  # de-duplicate identical pairs
        key = hashlib.sha1((p["chosen"] + "||" + p["rejected"]).encode()).hexdigest()
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def rebuild_pairs_for(repo: TenantRepo, recommendation_id: str) -> int:
    """Idempotent: pairs for a recommendation are always rebuilt from ALL its feedback and its current reward."""
    rec = repo.get_recommendation(recommendation_id)
    if rec is None:
        return 0
    repo.delete_pairs_for(recommendation_id)
    reward_row = repo.get_reward(recommendation_id)
    # reward-based pairs learn from what really happened, so they need a measured OUTCOME (feedback alone already yields its own pairs)
    has_outcome = bool(reward_row and "outcome" in reward_row["components"].get("components", {}))
    pairs = build_pairs(rec, repo.list_feedback(recommendation_id), reward_row["reward"] if has_outcome else None)
    prompt = _single_strategy_prompt(rec["prompt_text"])
    r = reward_row["reward"] if reward_row else None
    for p in pairs:
        repo.add_pair(recommendation_id=recommendation_id, pair_kind=p["pair_kind"], prompt=prompt, chosen=p["chosen"], rejected=p["rejected"],
                      reward_chosen=r if p["pair_kind"] == "high_reward" else None, reward_rejected=r if p["pair_kind"] == "low_reward" else None)
    return len(pairs)


def export_pairs_jsonl(repo: TenantRepo, path: str | Path) -> int:
    """TRL DPOTrainer conversational format. Only THIS tenant's pairs are exported."""
    rows = repo.list_pairs()
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({
                "prompt": messages_from_prompt_text(r["prompt"]),
                "chosen": [{"role": "assistant", "content": r["chosen"]}],
                "rejected": [{"role": "assistant", "content": r["rejected"]}],
                "kind": r["pair_kind"],
            }, ensure_ascii=False) + "\n")
    return len(rows)
