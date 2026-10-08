"""Pluggable generators behind ONE interface.

    production : fine-tuned Mistral 7B (QLoRA) served by vLLM
    prototype  : LLMGenerator (a small local instruct model on CPU)  +  TemplateGenerator (deterministic, always available)

Only the generator is swapped; the prompt, validation, ranking, privacy pipeline and learning loop do not change.
Generation must never crash a request: parse -> validate -> retry once -> fall back to the template generator.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import jsonschema
from pydantic import ValidationError

from ..channels import CHANNEL_VOCAB, canonical_channel
from ..learning.feedback import primary_metric
from ..schemas import GenerateRequest, Strategy
from .prompt import PromptBundle
from .ranking import compliance_violations

log = logging.getLogger("strategy_agent.generation")
_NS = uuid.UUID("0b8c3f0e-5d41-4e0e-8f55-3c1d2a9b7e11")


class GenerationError(Exception):
    """The generator produced nothing usable."""


# ======================================================================================== parsing / validation
def extract_json(text: str) -> list[dict]:
    """Find the first JSON array (or object) in model output, tolerating code fences and surrounding prose."""
    text = re.sub(r"```(?:json)?", "", text)
    decoder = json.JSONDecoder()
    for m in re.finditer(r"[\[{]", text):
        try:
            value, _ = decoder.raw_decode(text[m.start():])
        except ValueError:
            continue
        if isinstance(value, dict):
            value = value.get("strategies", [value]) if isinstance(value.get("strategies"), list) else [value]
        if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
            return value
    raise GenerationError("no JSON array of objects found in output")


_ALLOWED_KEYS = set(Strategy.model_fields)


def normalise_strategy_dict(d: dict, warnings: Optional[list[str]] = None) -> dict:
    """Light, documented repair: drop unknown keys, fill id/rank/evidence, canonicalise channel names, renormalise shares that
    are close to 1 (small models are bad at arithmetic). Anything else that is wrong stays wrong and fails validation."""
    d = {k: v for k, v in d.items() if k in _ALLOWED_KEYS}
    d.setdefault("strategy_id", str(uuid.uuid4()))
    d.setdefault("rank", 1)
    d.setdefault("evidence", {"tenant_sources": [], "shared_insights": []})
    chans = d.get("channels")
    if isinstance(chans, list):
        merged: dict[str, float] = {}
        for c in chans:
            if isinstance(c, dict) and "channel" in c and isinstance(c.get("budget_share"), (int, float)):
                ch = canonical_channel(str(c["channel"]))
                merged[ch] = merged.get(ch, 0.0) + float(c["budget_share"])
        total = sum(merged.values())
        if merged and abs(total - 1.0) > 0.02 and 0.5 <= total <= 1.5:
            merged = {k: v / total for k, v in merged.items()}
            if warnings is not None:
                warnings.append("repaired budget shares to sum to 1")
        d["channels"] = [{"channel": k, "budget_share": round(v, 4)} for k, v in merged.items()]
    return d


def validate_strategy(d: dict, req: GenerateRequest, warnings: Optional[list[str]] = None) -> Strategy:
    d = normalise_strategy_dict(d, warnings)
    try:
        jsonschema.validate(d, Strategy.model_json_schema())  # structural check against the published schema
        s = Strategy.model_validate(d)                         # semantic check (budget sums, ranges)
    except (jsonschema.ValidationError, ValidationError) as exc:
        raise GenerationError(f"schema validation failed: {str(exc)[:160]}") from exc
    problems = compliance_violations(s, req)
    if problems:
        raise GenerationError("constraint violation: " + "; ".join(problems))
    return s


def parse_and_validate(raw: str, req: GenerateRequest, warnings: Optional[list[str]] = None) -> list[Strategy]:
    items = extract_json(raw)
    good, errors = [], []
    for item in items:
        try:
            good.append(validate_strategy(item, req, warnings))
        except GenerationError as exc:
            errors.append(str(exc))
    if not good:
        raise GenerationError("; ".join(errors[:2]) or "empty")
    return good


# ======================================================================================== interface
class Generator(ABC):
    name = "generator"

    def available(self) -> bool:
        return True

    @abstractmethod
    def generate(self, bundle: PromptBundle) -> str:
        """Return raw text containing a JSON array of strategies."""


# ======================================================================================== template (rule based)
BASE_MIX = {
    ("B2C", "awareness"): {"meta_ads": .30, "tiktok_ads": .15, "youtube_ads": .15, "influencer": .20, "social": .10, "google_ads": .10},
    ("B2C", "lead_gen"): {"meta_ads": .30, "google_ads": .25, "landing_page": .15, "email": .15, "social": .10, "sms": .05},
    ("B2C", "retention"): {"email": .35, "sms": .20, "whatsapp": .15, "social": .10, "content_marketing": .10, "referral": .10},
    ("B2C", "sales"): {"meta_ads": .30, "google_ads": .30, "email": .15, "influencer": .10, "landing_page": .10, "sms": .05},
    ("B2B", "awareness"): {"linkedin_ads": .30, "content_marketing": .25, "seo": .15, "events": .15, "pr": .10, "google_ads": .05},
    ("B2B", "lead_gen"): {"linkedin_ads": .30, "google_ads": .20, "content_marketing": .15, "webinar": .15, "email": .15, "landing_page": .05},
    ("B2B", "retention"): {"email": .35, "content_marketing": .20, "webinar": .15, "events": .15, "referral": .15},
    ("B2B", "sales"): {"linkedin_ads": .25, "email": .25, "google_ads": .20, "events": .15, "webinar": .10, "referral": .05},
}
PERF = {"google_ads", "meta_ads", "linkedin_ads", "landing_page", "email", "tiktok_ads"}
CONTENT = {"content_marketing", "seo", "social", "influencer", "youtube_ads", "pr", "events"}
LIFECYCLE = {"email", "sms", "whatsapp", "referral", "webinar", "content_marketing"}
# (title, tilted channels, tilt factor, confidence offset, uplift factor)
ARCHETYPES = [
    ("Balanced growth", None, 1.0, 0.05, 1.00),
    ("Performance-first", PERF, 1.5, 0.00, 1.10),
    ("Brand and content-led", CONTENT, 1.6, -0.03, 0.90),
    ("Lifecycle and retention-led", LIFECYCLE, 1.6, -0.02, 1.00),
    ("Lean test-and-learn", "lean", 1.0, -0.05, 0.80),
]
ANGLES_BY_OBJECTIVE = {
    "lead_gen": ["risk_reversal", "education_expertise", "trust_security"],
    "awareness": ["social_proof_community", "premium_quality", "convenience_simplicity"],
    "retention": ["convenience_simplicity", "social_proof_community", "price_value"],
    "sales": ["price_value", "urgency_scarcity", "trust_security"],
}
ANGLE_TEXT = {
    "risk_reversal": "Try it risk-free", "education_expertise": "Show expertise through useful guidance", "trust_security": "Build trust and reassurance",
    "social_proof_community": "Social proof and community", "premium_quality": "Quality and craftsmanship", "convenience_simplicity": "Make it effortless",
    "price_value": "Clear value for money", "urgency_scarcity": "A reason to act now",
}
UPLIFT_RANGE = {"lead_gen": ("cpl_reduction", .08, .20), "awareness": ("reach_growth", .10, .30), "retention": ("repeat_rate_increase", .05, .15),
                "sales": ("roi_increase", .10, .25)}
SUPPORT_KPIS = {"lead_gen": [("conversion_rate", 0.05), ("ctr", 0.02)], "awareness": [("ctr", 0.02), ("conversion_rate", 0.01)],
                "retention": [("conversion_rate", 0.08), ("ctr", 0.03)], "sales": [("roi", 2.0), ("conversion_rate", 0.03)]}


def _round_mix(mix: dict[str, float]) -> dict[str, float]:
    total = sum(mix.values())
    out = {k: round(v / total, 4) for k, v in mix.items()}
    drift = round(1.0 - sum(out.values()), 4)
    top = max(out, key=out.get)
    out[top] = round(out[top] + drift, 4)
    return out


class TemplateGenerator(Generator):
    """Deterministic, rule-based strategy assembly from the brief. Same input -> same output. Needs no model, so it always runs."""

    name = "template"

    def generate(self, bundle: PromptBundle) -> str:
        req, n = bundle.request, bundle.n
        return json.dumps([self._strategy(bundle, req, i) for i in range(n)])

    # -------------------------------------------------------------------------------------
    def _mix(self, bundle: PromptBundle, req: GenerateRequest, idx: int) -> dict[str, float]:
        p, c = req.business_profile, req.constraints
        mix = dict(BASE_MIX[(p.business_model, req.objective.type)])
        title, tilt, factor, _, _ = ARCHETYPES[idx % len(ARCHETYPES)]
        if isinstance(tilt, set):
            mix = {ch: v * (factor if ch in tilt else 0.7) for ch, v in mix.items()}
        elif tilt == "lean":
            mix = dict(sorted(mix.items(), key=lambda kv: -kv[1])[:3])
        # blend toward the evidence (own history + anonymised cross-business insights); 25% at most, support-weighted
        ev = [(e.channel_mix, max(0.1, e.score)) for e in bundle.tenant_evidence if e.channel_mix] + \
             [(e.channel_mix, float(e.support_count)) for e in bundle.shared_evidence if e.channel_mix]
        if ev:
            tw = sum(w for _, w in ev)
            blend: dict[str, float] = {}
            for m, w in ev:
                for ch, share in m.items():
                    blend[ch] = blend.get(ch, 0.0) + share * w / tw
            base_total = sum(mix.values())
            keys = set(mix) | set(blend)
            mix = {ch: 0.75 * mix.get(ch, 0.0) / base_total + 0.25 * blend.get(ch, 0.0) for ch in keys}
        mix = {ch: v for ch, v in mix.items() if v > 0 and ch not in c.channels_blocked}
        if c.channels_allowed:
            mix = {ch: v for ch, v in mix.items() if ch in c.channels_allowed}
            if not mix:
                mix = {ch: 1.0 for ch in c.channels_allowed if ch in CHANNEL_VOCAB} or {c.channels_allowed[0]: 1.0}
        if not mix:
            mix = {"email": 1.0}
        return _round_mix(mix)

    def _strategy(self, bundle: PromptBundle, req: GenerateRequest, idx: int) -> dict:
        p, o = req.business_profile, req.objective
        title, _, _, conf_off, uplift_factor = ARCHETYPES[idx % len(ARCHETYPES)]
        mix = self._mix(bundle, req, idx)
        top = [ch for ch, _ in sorted(mix.items(), key=lambda kv: -kv[1])]
        weeks = max(4, min(o.horizon_weeks, 12))
        n_ev = len(bundle.tenant_evidence) + len(bundle.shared_evidence)
        metric, lo, hi = UPLIFT_RANGE[o.type]
        boost = min(0.06, 0.02 * n_ev)
        angles = [f"{ANGLE_TEXT[a]} ({p.brand_tone} tone)" for a in ANGLES_BY_OBJECTIVE[o.type]]
        if p.business_model == "B2B":
            angles = [a.replace("Make it effortless", "Show the time saved") for a in angles]
        timeline_weeks = sorted({1, 2, max(3, weeks // 2), max(4, weeks - 1), weeks})
        actions = {
            1: [f"Set up tracking, audiences and the budget split across {', '.join(top[:3])}", "Prepare two creative variants per top channel"],
            2: [f"Launch on {top[0]}" + (f" and {top[1]}" if len(top) > 1 else ""), "A/B test two messaging angles"],
        }
        timeline = []
        for w in timeline_weeks:
            if w in actions:
                acts = actions[w]
            elif w == weeks:
                acts = [f"Report results against {o.target_kpi}", "Document learnings and decide what to scale"]
            else:
                acts = ["Review early results; move budget to the best-performing channels", "Refresh the weakest creative"]
            timeline.append({"week": w, "actions": acts})
        kpis = [{"name": o.target_kpi, "target": o.target_value}] + [{"name": n_, "target": t} for n_, t in SUPPORT_KPIS[o.type] if n_ != o.target_kpi][:2]
        segs = [p.target_audience, f"Look-alikes of existing {p.business_model} customers in {p.region}", "Re-engagement of past leads and visitors"]
        evid_text = (f" It draws on {len(bundle.tenant_evidence)} of this business's own past campaigns and {len(bundle.shared_evidence)} "
                     f"anonymised cross-business insight(s).") if n_ev else " No past evidence was available, so it relies on rule-based defaults for this objective and business model."
        return {
            "strategy_id": str(uuid.uuid5(_NS, f"{bundle.prompt_hash}:{idx}")),
            "title": f"{title}: {o.type.replace('_', ' ')} for {p.industry}",
            "summary": f"A {weeks}-week {title.lower()} plan to reach {o.target_kpi} {o.target_value:g} for a {p.business_model} {p.industry} business targeting {p.target_audience}.",
            "channels": [{"channel": ch, "budget_share": s} for ch, s in mix.items()],
            "audience_segments": segs, "messaging_angles": angles, "timeline": timeline, "kpis": kpis,
            "expected_uplift": {"metric": metric, "low": round(lo * uplift_factor + boost, 3), "high": round(hi * uplift_factor + boost, 3)},
            "rationale": f"The {title.lower()} mix emphasises {', '.join(top[:2])}, which suit a {p.business_model} {o.type.replace('_', ' ')} goal." + evid_text,
            "evidence": {"tenant_sources": [e.campaign_id for e in bundle.tenant_evidence], "shared_insights": [e.insight_id for e in bundle.shared_evidence]},
            "confidence": round(min(0.9, max(0.35, 0.55 + 0.05 * min(n_ev, 4) + conf_off)), 3),
            "rank": 1,
        }


# ======================================================================================== local LLM
def cached_snapshot(repo_id: str) -> Optional[Path]:
    """The snapshot folder of a hub model in the local cache (the commit `refs/main` points to, else the newest), or None. Whether the WEIGHTS in it
    are complete is decided separately (`LLMGenerator._weights_cached`), so a missing README or LICENSE does not hide a usable model."""
    try:
        from huggingface_hub.constants import HF_HUB_CACHE

        root = Path(HF_HUB_CACHE) / ("models--" + repo_id.replace("/", "--"))
        ref = root / "refs" / "main"
        if ref.exists() and (root / "snapshots" / ref.read_text().strip()).is_dir():
            return root / "snapshots" / ref.read_text().strip()
        snapshots = [p for p in (root / "snapshots").glob("*") if p.is_dir()]
        return max(snapshots, key=lambda p: p.stat().st_mtime) if snapshots else None
    except Exception:
        return None


class LLMGenerator(Generator):
    """A local instruct model on CPU (default Qwen2.5-1.5B-Instruct), optionally with a fine-tuned LoRA adapter on top.

    Production: Mistral-7B-Instruct + the QLoRA adapter trained by training/sft_qlora.py (and refined by training/dpo.py), served by vLLM.
    Prototype: set LLM_MODEL_NAME (any causal chat model, a Hub id or a local directory) and ADAPTER_PATH (a PEFT adapter directory).
    """

    name = "llm"

    def __init__(self, model_name: str, max_new_tokens: int = 1800, adapter_path: str = "", load_4bit: bool = False) -> None:
        self.model_name, self.max_new_tokens, self.adapter_path, self.load_4bit = model_name, max_new_tokens, adapter_path, load_4bit
        self._tok = self._model = None
        self._failed = False

    def _model_dir(self) -> Optional[Path]:
        if Path(self.model_name).is_dir():  # a local directory (for example a model saved after training)
            return Path(self.model_name)
        try:
            from huggingface_hub import snapshot_download

            return Path(snapshot_download(self.model_name, local_files_only=True))
        except Exception:  # newer huggingface_hub calls a cache "incomplete" when files we never need (README, LICENSE) are absent
            return cached_snapshot(self.model_name)

    def _weights_cached(self) -> bool:
        """True only if the model WEIGHTS are available locally (config / tokenizer files alone are not enough)."""
        path = self._model_dir()
        if path is None:
            return False
        index = path / "model.safetensors.index.json"
        if index.exists():  # sharded model: every listed shard must be present
            try:
                shards = set(json.loads(index.read_text())["weight_map"].values())
            except Exception:
                return False
            return bool(shards) and all((path / f).exists() for f in shards)
        return any(path.glob("*.safetensors")) or any(path.glob("pytorch_model*.bin"))

    def _adapter_ok(self) -> bool:
        """If an adapter is configured it must exist: we never silently serve the base model while claiming a fine-tuned one."""
        return (not self.adapter_path) or (Path(self.adapter_path) / "adapter_config.json").exists()

    def available(self) -> bool:
        if self._failed:
            return False
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401

            if self.adapter_path:
                import peft  # noqa: F401
            if self.load_4bit:  # 4-bit loading needs an NVIDIA GPU and bitsandbytes (a 7B model does not fit a 16 GB card in 16-bit)
                import bitsandbytes  # noqa: F401

                if not torch.cuda.is_available():
                    return False
        except Exception:
            return False
        return self._weights_cached() and self._adapter_ok()

    def _load(self):
        if self._model is None:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            src = str(self._model_dir() or self.model_name)
            self._tok = AutoTokenizer.from_pretrained(src, local_files_only=True)
            if self.load_4bit:
                from transformers import BitsAndBytesConfig

                from ..gpu import native_bf16

                compute = torch.bfloat16 if native_bf16() else torch.float16
                bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=compute)
                model = AutoModelForCausalLM.from_pretrained(src, quantization_config=bnb, device_map="auto", local_files_only=True)
            else:
                model = AutoModelForCausalLM.from_pretrained(src, torch_dtype=torch.bfloat16, local_files_only=True)
            if self.adapter_path:
                from peft import PeftModel

                model = PeftModel.from_pretrained(model, self.adapter_path)
                if not self.load_4bit:
                    model = model.merge_and_unload()  # merged for faster inference; a 4-bit base keeps the adapter separate (no lossy merge)
            self._model = model.eval()
        return self._tok, self._model

    def generate(self, bundle: PromptBundle) -> str:
        try:
            import torch

            from .chat import render_chat

            tok, model = self._load()
            text = render_chat(tok, bundle.messages, add_generation_prompt=True)       # version-proof: render to text, then tokenise
            enc = tok(text, return_tensors="pt", add_special_tokens=False).to(model.device)
            with torch.no_grad():
                out = model.generate(**enc, max_new_tokens=self.max_new_tokens, do_sample=False, pad_token_id=tok.pad_token_id or tok.eos_token_id)
            return tok.decode(out[0, enc["input_ids"].shape[1]:], skip_special_tokens=True)
        except Exception as exc:
            self._failed = True
            raise GenerationError(f"local model failed: {type(exc).__name__}") from exc


def build_generators(backend: str, model_name: str, max_new_tokens: int, adapter_path: str = "", load_4bit: bool = False) -> tuple[Optional[Generator], TemplateGenerator]:
    """(primary, fallback). `template` never touches a model; `auto` / `llm` use the local model only if it is available."""
    fallback = TemplateGenerator()
    if backend == "template":
        return None, fallback
    llm = LLMGenerator(model_name, max_new_tokens, adapter_path, load_4bit)
    return (llm if (backend == "llm" or llm.available()) else None), fallback
