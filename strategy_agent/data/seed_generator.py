"""Synthetic (business brief -> strategy JSON) instruction dataset for SFT.

Honest scope: the labels are produced by the rule-based TemplateGenerator, so a model fine-tuned on this learns the OUTPUT FORMAT, the
schema and the constraint-following behaviour. It does not learn real marketing insight; that has to come from real feedback via DPO.
Everything is synthetic: no real business, person or campaign is in it.

    python -m strategy_agent.data.seed_generator --n 1200 --seed 42 --out data/strategy_sft/v1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..channels import CHANNEL_VOCAB
from ..experiments import ExperimentLog, default_log
from ..generation.generator import TemplateGenerator, parse_and_validate
from ..generation.prompt import build_prompt
from ..generation.rag import SharedEvidence, TenantEvidence
from ..schemas import BusinessProfile, Constraints, GenerateRequest, Objective, Strategy
from ..training.common import n_tokens

INDUSTRIES = ["SaaS", "retail", "fashion e-commerce", "tea exporter", "restaurant", "education", "healthcare clinic", "real estate", "fintech",
              "travel agency", "logistics", "manufacturing", "fitness studio", "nonprofit", "consulting", "automotive", "telecom", "beauty salon"]
REGIONS = ["Colombo, Sri Lanka", "Mumbai, India", "Singapore", "London, UK", "Berlin, Germany", "New York, USA", "Toronto, Canada", "Sydney, Australia",
           "Dubai, UAE", "Sao Paulo, Brazil", "Nairobi, Kenya", "Kuala Lumpur, Malaysia"]
TONES = ["professional", "friendly", "bold", "playful", "premium", "trustworthy"]
AUDIENCES = {
    "B2B": ["small business owners", "marketing managers", "procurement heads", "IT decision makers", "operations directors", "startup founders"],
    "B2C": ["young adults 18-30", "working parents", "university students", "retirees", "young professionals", "health-conscious shoppers"],
}
KPI = {"lead_gen": ("cost_per_lead", (4, 60)), "awareness": ("ctr", (0.01, 0.05)), "retention": ("conversion_rate", (0.03, 0.15)), "sales": ("roi", (1.5, 5.0))}
MAX_TOKENS = 2000            # the training sequence length is 2048; keep a little headroom
CHARS_PER_TOKEN = 3.2        # fallback estimate, used only when no tokenizer is available locally
# Every example must fit the sequence length under EACH of these tokenizers (production base first). Mistral tokenises JSON very
# differently from Qwen: a character estimate tuned on one let three examples exceed 2,048 tokens under the other.
DEFAULT_LENGTH_TOKENIZERS = ("mistralai/Mistral-7B-Instruct-v0.3", "Qwen/Qwen2.5-1.5B-Instruct")
HORIZONS = ["4 weeks", "6 weeks", "8 weeks", "12 weeks", "2 months", "3 months"]
COMPLIANCE = ["GDPR applies to EU leads", "no unsolicited SMS", "health claims must be reviewed by legal", "financial promotions need a risk warning", "avoid price guarantees"]


def load_length_tokenizers(names: tuple[str, ...] = DEFAULT_LENGTH_TOKENIZERS) -> dict:
    """The tokenizers that are available OFFLINE. Missing ones are skipped (and the card says which were used)."""
    found = {}
    for name in names:
        try:
            from transformers import AutoTokenizer

            found[name] = AutoTokenizer.from_pretrained(name, local_files_only=True)
        except Exception:
            continue
    return found


def _brief(rng: random.Random) -> GenerateRequest:
    model = rng.choice(["B2B", "B2C"])
    objective = rng.choice(list(KPI))
    kpi_name, (lo, hi) = KPI[objective]
    blocked = rng.sample(CHANNEL_VOCAB, rng.choice([0, 0, 1, 2]))
    allowed: list[str] = []
    if rng.random() < 0.2:
        allowed = [c for c in rng.sample(CHANNEL_VOCAB, rng.randint(3, 6)) if c not in blocked] or ["email"]
    return GenerateRequest(
        business_profile=BusinessProfile(industry=rng.choice(INDUSTRIES), business_model=model, target_audience=rng.choice(AUDIENCES[model]),
                                         region=rng.choice(REGIONS), brand_tone=rng.choice(TONES), monthly_budget=round(10 ** rng.uniform(2.7, 5.2), -1)),
        objective=Objective(type=objective, target_kpi=kpi_name, target_value=round(rng.uniform(lo, hi), 3), time_horizon=rng.choice(HORIZONS)),
        constraints=Constraints(channels_blocked=blocked, channels_allowed=allowed, budget_cap=None if rng.random() < 0.7 else round(10 ** rng.uniform(2.7, 5.0), -1),
                                compliance_notes=rng.sample(COMPLIANCE, rng.choice([0, 0, 1]))),
        n_strategies=rng.choice([1, 2, 3, 3, 3]),
    )


def _fake_id(rng: random.Random, prefix: str) -> str:
    return f"{prefix}-{''.join(rng.choice('abcdefghjkmnpqrstvwxyz') for _ in range(4))}-{rng.randrange(100, 999)}"


def _random_mix(rng: random.Random, allowed: list[str], blocked: list[str]) -> dict[str, float]:
    pool = [c for c in (allowed or CHANNEL_VOCAB) if c not in blocked]
    chosen = rng.sample(pool, k=min(len(pool), rng.randint(2, 4)))
    raw = [rng.random() + 0.2 for _ in chosen]
    total = sum(raw)
    return {c: round(r / total, 4) for c, r in zip(chosen, raw)}


def _evidence(rng: random.Random, req: GenerateRequest) -> tuple[list[TenantEvidence], list[SharedEvidence]]:
    """Half the examples carry synthetic evidence so the model learns to read (and cite) the evidence sections."""
    if rng.random() < 0.5:
        return [], []
    c = req.constraints
    tenant = [TenantEvidence(_fake_id(rng, "c"), f"{req.objective.type} campaign, {req.business_profile.industry}; synthetic", _random_mix(rng, c.channels_allowed, c.channels_blocked),
                             {"roi": round(rng.uniform(1, 4), 2)}, req.objective.type, round(rng.random(), 3)) for _ in range(rng.randint(0, 3))]
    shared = [SharedEvidence(_fake_id(rng, "i"), f"{req.objective.type} insight; synthetic aggregate", _random_mix(rng, c.channels_allowed, c.channels_blocked),
                             {"roi": round(rng.uniform(1, 4), 2)}, rng.randint(5, 40), round(rng.random(), 3)) for _ in range(rng.randint(0, 2))]
    return tenant, shared


def _split_of(user_prompt: str) -> str:
    h = int(hashlib.sha256(user_prompt.encode()).hexdigest(), 16) % 10
    return "train" if h < 8 else "val" if h == 8 else "test"


def build_examples(n: int, seed: int, tokenizers: Optional[dict] = None) -> list[dict]:
    tokenizers = {} if tokenizers is None else tokenizers
    rng, tg = random.Random(seed), TemplateGenerator()
    seen: set[str] = set()
    out: list[dict] = []
    attempts = 0
    while len(out) < n and attempts < n * 20:
        attempts += 1
        req = _brief(rng)
        tenant_ev, shared_ev = _evidence(rng, req)
        bundle = build_prompt(req, req.n_strategies, tenant_ev, shared_ev)
        key = bundle.prompt_hash
        if key in seen:
            continue
        try:
            completion = tg.generate(bundle)
            strategies: list[Strategy] = parse_and_validate(completion, req)       # every label must pass schema + constraint validation
        except Exception:
            continue                                                                # e.g. constraints with no feasible channel: skip the brief
        if len(strategies) != req.n_strategies:
            continue
        full = bundle.messages + [{"role": "assistant", "content": completion}]
        counts = {name: n_tokens(tok, full) for name, tok in tokenizers.items()}
        if counts:
            if max(counts.values()) > MAX_TOKENS:
                continue                                                            # would be truncated at training time under that tokenizer
        elif (len(bundle.text) + len(completion)) / CHARS_PER_TOKEN > MAX_TOKENS:
            continue
        seen.add(key)
        out.append({
            "prompt": bundle.messages,
            "completion": [{"role": "assistant", "content": completion}],
            "meta": {"example_id": key, "objective": req.objective.type, "business_model": req.business_profile.business_model,
                     "industry": req.business_profile.industry, "n_strategies": req.n_strategies, "has_evidence": bool(tenant_ev or shared_ev), "tokens": counts,
                     "request": req.model_dump(), "split": _split_of(bundle.messages[1]["content"])},
        })
    return out


def write_dataset(n: int, seed: int, out_dir: Path, tokenizers: Optional[dict] = None, experiment_log: Optional[ExperimentLog] = None) -> dict:
    t_start = datetime.now(timezone.utc)
    tokenizers = load_length_tokenizers() if tokenizers is None else tokenizers
    if experiment_log is None:
        return _write(n, seed, out_dir, tokenizers, t_start)
    with experiment_log.run("dataset", {"n": n, "seed": seed, "out_dir": str(out_dir), "length_tokenizers": sorted(tokenizers)}) as run:
        card = _write(n, seed, out_dir, tokenizers, t_start)
        run.metrics.update({"examples": card["total_examples"], **{f"split_{k}": v for k, v in card["splits"].items()}, "with_evidence": card["with_evidence"]})
        run.artifacts.append(str(out_dir))
        return card


def _write(n: int, seed: int, out_dir: Path, tokenizers: dict, t_start: datetime) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    examples = build_examples(n, seed, tokenizers)
    splits: dict[str, list[dict]] = {"train": [], "val": [], "test": []}
    for ex in examples:
        splits[ex["meta"]["split"]].append(ex)
    for name, rows in splits.items():
        with open(out_dir / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    chars = [len(e["prompt"][0]["content"]) + len(e["prompt"][1]["content"]) + len(e["completion"][0]["content"]) for e in examples]
    per_tok = {name: {"max": max(e["meta"]["tokens"][name] for e in examples), "mean": round(sum(e["meta"]["tokens"][name] for e in examples) / len(examples), 1)}
               for name in tokenizers} if examples else {}
    t_end = datetime.now(timezone.utc)
    card = {
        "name": "strategy_sft", "version": "v1", "generated_at": t_end.isoformat(), "seed": seed, "format": "prompt/completion (TRL conversational)",
        "date_range": {"generation_started": t_start.isoformat(timespec="seconds"), "generation_finished": t_end.isoformat(timespec="seconds"),
                       "note": "synthetic data: there is no real-world collection period"},
        "total_examples": len(examples), "splits": {k: len(v) for k, v in splits.items()},
        "sources": ["rule-based TemplateGenerator (labels)", "synthetic business briefs sampled from fixed industry / audience / region / constraint tables"],
        "by_objective": dict(Counter(e["meta"]["objective"] for e in examples)), "by_business_model": dict(Counter(e["meta"]["business_model"] for e in examples)),
        "by_industry": dict(Counter(e["meta"]["industry"] for e in examples)), "with_evidence": sum(e["meta"]["has_evidence"] for e in examples),
        "length_checked_with": per_tok, "max_tokens_allowed": MAX_TOKENS,
        "approx_tokens_per_example": {"mean": round(sum(chars) / len(chars) / CHARS_PER_TOKEN) if chars else 0, "max": round(max(chars) / CHARS_PER_TOKEN) if chars else 0, "estimate": f"chars / {CHARS_PER_TOKEN} (fallback)"},
        "label_source": "rule-based TemplateGenerator (deterministic teacher). NOT human- or LLM-written.",
        "schema_sha256": hashlib.sha256(json.dumps(Strategy.model_json_schema(), sort_keys=True).encode()).hexdigest()[:16],
        "validation": "every completion passes JSON-schema + pydantic + constraint-compliance validation; duplicates removed by prompt hash; every example fits the training sequence length under each tokenizer listed",
        "synthetic": True, "contains_personal_data": False,
    }
    (out_dir / "dataset_card.json").write_text(json.dumps(card, indent=2))
    (out_dir / "DATASET_CARD.md").write_text(_card_markdown(card))
    return card


def _card_markdown(c: dict) -> str:
    rows = "\n".join(f"| {k} | {v} |" for k, v in c["splits"].items())
    return f"""# Dataset card: strategy_sft {c['version']}

Synthetic instruction data for supervised fine-tuning of the Strategy Agent generator: *business brief -> ranked strategies as JSON*.

- **Generated:** {c['date_range']['generation_started']} to {c['date_range']['generation_finished']} (seed {c['seed']}); {c['date_range']['note']}
- **Sources:** {'; '.join(c['sources'])}
- **Examples:** {c['total_examples']} ({c['with_evidence']} include synthetic evidence sections)
- **Format:** {c['format']}
- **Length (real tokenizers):** {', '.join(f"{k}: max {v['max']}, mean {v['mean']}" for k, v in c['length_checked_with'].items()) or 'not checked (no tokenizer available offline)'}; limit {c['max_tokens_allowed']} tokens.
- **Label source:** {c['label_source']}
- **Validation:** {c['validation']}
- **Schema fingerprint:** `{c['schema_sha256']}`
- **Personal data:** none. Everything is synthetic.

| Split | Examples |
|---|---|
{rows}

Splits are assigned by a hash of the prompt, so the same brief can never appear in two splits.

## Coverage
- Objectives: {c['by_objective']}
- Business models: {c['by_business_model']}
- Industries: {len(c['by_industry'])} ({', '.join(sorted(c['by_industry']))})

## Limitations (read before using)
- The labels come from a rule-based generator, so a model trained on this learns **format, schema and constraint adherence**, not real marketing insight.
  Real quality gains are meant to come from preference optimisation (DPO) on real tenant feedback.
- Channel mixes follow fixed rule tables plus random synthetic evidence; they are plausible, not empirically validated.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1200)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="data/strategy_sft/v1")
    a = ap.parse_args()
    card = write_dataset(a.n, a.seed, Path(a.out), experiment_log=default_log())
    print(json.dumps({k: card[k] for k in ("total_examples", "splits", "by_objective")}, indent=2))


if __name__ == "__main__":
    main()
