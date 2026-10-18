"""Structural + quality evaluation of a generator's RAW output (before any fallback), and rubric scores of the final strategies."""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Optional

import jsonschema
from pydantic import ValidationError

from ..generation.generator import GenerationError, Generator, extract_json, normalise_strategy_dict
from ..generation.prompt import build_prompt
from ..generation.ranking import compliance_violations
from ..schemas import SHARE_TOLERANCE, GenerateRequest, Strategy
from .quality import rubric


def structural_eval(generator: Generator, briefs: list[GenerateRequest]) -> dict:
    n_req = n_returned = n_valid = n_compliant = n_budget_ok = n_json = failures = 0
    for req in briefs:
        n_req += req.n_strategies
        try:
            raw = generator.generate(build_prompt(req, req.n_strategies, [], []))
            items = extract_json(raw)
            n_json += 1
        except Exception:
            failures += 1
            continue
        for d in items:
            n_returned += 1
            ch = d.get("channels") if isinstance(d, dict) else None
            if isinstance(ch, list) and all(isinstance(c, dict) and isinstance(c.get("budget_share"), (int, float)) for c in ch) and ch:
                n_budget_ok += abs(sum(c["budget_share"] for c in ch) - 1.0) <= SHARE_TOLERANCE
            try:
                nd = normalise_strategy_dict(d)
                jsonschema.validate(nd, Strategy.model_json_schema())
                s = Strategy.model_validate(nd)
            except (jsonschema.ValidationError, ValidationError, Exception):
                continue
            n_valid += 1
            n_compliant += not compliance_violations(s, req)
    return {"generator": generator.name, "briefs": len(briefs), "strategies_requested": n_req, "strategies_returned": n_returned,
            "json_parse_rate": round(n_json / len(briefs), 4), "schema_validity_rate": round(n_valid / n_req, 4) if n_req else None,
            "raw_budget_sum_ok_rate": round(n_budget_ok / n_returned, 4) if n_returned else None,
            "constraint_compliance_rate": round(n_compliant / n_valid, 4) if n_valid else None, "generator_failures": failures,
            "note": "measured on the generator's RAW output; the service would repair small budget-share errors and fall back on failure"}


def quality_eval(strategies_by_brief: list[tuple[GenerateRequest, list[Strategy]]]) -> dict:
    acc: dict[str, list[float]] = defaultdict(list)
    for req, strategies in strategies_by_brief:
        for s in strategies:
            for k, v in rubric(s, req).items():
                acc[k].append(v)
    return {"scale": "1 (poor) to 5 (excellent); deterministic heuristic rubric", "n_strategies": len(acc["overall"]),
            **{k: {"mean": round(sum(v) / len(v), 3), "min": min(v), "max": max(v)} for k, v in acc.items()}}
