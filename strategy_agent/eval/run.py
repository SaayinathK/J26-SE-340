"""python -m strategy_agent.eval.run --model template|qwen|mistral|llm|auto [--adapter PATH] [--n-briefs 60] [--tenants 150] [--seed 42]

Model aliases: template (deterministic rules, always available), qwen (Qwen2.5-1.5B-Instruct, CPU), mistral (Mistral-7B-Instruct-v0.3; needs a GPU or a
lot of RAM), llm (whatever LLM_MODEL_NAME says), auto (the configured LLM if its weights are present). `--adapter PATH` loads a fine-tuned LoRA adapter on top
of the chosen base model, which adds the "fine-tuned" system to the comparison (fine-tuned vs template vs rule-based baseline).

Builds a synthetic world and population, runs the consent-gated pipeline, then evaluates: structural validity, a quality rubric, simulated
A/B against baselines, the privacy suite (PII leakage, k-anonymity audit, re-identification attacks, k / noise sweep) and the ablations.
Writes eval_reports/eval_report.md and eval_report.html.
"""
from __future__ import annotations

import argparse
import json
import platform
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from ..auth import TenantContext
from ..config import Settings
from ..db.shared_store import SharedReader, SharedStore
from ..db.tenant_store import TenantStore
from ..experiments import ExperimentLog, default_log
from ..generation.generator import Generator, LLMGenerator, TemplateGenerator, build_generators
from ..generation.rag import Retriever
from ..generation.service import StrategyService
from ..privacy.anonymizer import Anonymizer
from ..privacy.pipeline import ConsentGatedPipeline
from . import attacks, report
from .compare import evaluate_systems, make_briefs, shared_benefit
from .population import build_population
from .quality import rubric  # noqa: F401  (re-exported for convenience)
from .structural import quality_eval, structural_eval
from .simulator import OutcomeSimulator, World


def _log(msg: str) -> None:
    print(f"[eval] {msg}", flush=True)


def privacy_sweep(tenants: TenantStore, shared: SharedStore, pop, anonymizer: Anonymizer, settings: Settings, utility=None, ks=(2, 3, 5, 8), seed: int = 0) -> list[dict]:
    rows = []
    for k in ks:
        for noise in (False, True):
            s = settings.model_copy(update={"k_anonymity": k, "enable_laplace_noise": noise, "laplace_epsilon": 1.0})
            ConsentGatedPipeline(tenants, shared, anonymizer, s, noise_seed=seed).rebuild_insights()
            rows.append({"k": k, "noise": noise, "audit": attacks.k_anonymity_audit(shared, k), "reid": attacks.qi_reidentification(shared, pop),
                         "mia": attacks.aggregate_membership_inference(shared, pop, tenants), "utility": utility(f"k{k}-{int(noise)}") if utility else None})
    ConsentGatedPipeline(tenants, shared, anonymizer, settings, noise_seed=seed).rebuild_insights()   # restore the configured k / no noise
    return rows


MODEL_ALIASES = {"qwen": "Qwen/Qwen2.5-1.5B-Instruct", "mistral": "mistralai/Mistral-7B-Instruct-v0.3"}


def run(model: str = "template", n_briefs: int = 60, n_tenants: int = 150, seed: int = 42, out_dir: str = "eval_reports", n_llm_briefs: int = 6,
        simulator_samples: int = 12000, rag: str = "tfidf", k: int = 5, adapter: str = "", llm_name: Optional[str] = None,
        experiment_log: Optional[ExperimentLog] = None, llm_max_new_tokens: Optional[int] = None, load_4bit: bool = False) -> dict:
    """Runs the evaluation and, if an experiment log is given, records it (parameters, headline metrics, report paths)."""
    params = {"model": model, "n_briefs": n_briefs, "n_tenants": n_tenants, "seed": seed, "k": k, "adapter": adapter or None, "llm_name": llm_name, "rag": rag}
    if experiment_log is None:
        return _run(model, n_briefs, n_tenants, seed, out_dir, n_llm_briefs, simulator_samples, rag, k, adapter, llm_name, llm_max_new_tokens)
    with experiment_log.run("eval", params) as rec:
        R = _run(model, n_briefs, n_tenants, seed, out_dir, n_llm_briefs, simulator_samples, rag, k, adapter, llm_name, llm_max_new_tokens, load_4bit)
        sim = R["simulator"]["systems"]
        rec.metrics.update({
            "schema_validity_rate": R["structural"][0]["schema_validity_rate"], "quality_overall": R["quality"]["template"]["overall"]["mean"],
            "uplift_agent_cold": sim["agent_template_cold_start"]["mean_predicted_uplift"], "uplift_agent_with_shared": sim["agent_template_with_shared"]["mean_predicted_uplift"],
            "uplift_rule_baseline": sim["rule_baseline"]["mean_predicted_uplift"], "pii_leakage_rate": R["privacy"]["pii"]["leakage_rate"],
            "k_anonymity_ok": R["privacy"]["k_audit"]["all_published_groups_have_at_least_k"], "membership_auc": R["privacy"]["membership_inference"]["auc"],
            "finetuned_status": R["ablations"]["finetuned"]["status"], "llm_status": R["ablations"]["template_vs_llm"]["status"]})
        rec.artifacts.extend([str(Path(out_dir) / n) for n in ("eval_report.md", "eval_report.html", "eval_results.json")])
        return R


def _run(model: str, n_briefs: int, n_tenants: int, seed: int, out_dir: str, n_llm_briefs: int, simulator_samples: int, rag: str, k: int, adapter: str,
         llm_name: Optional[str], llm_max_new_tokens: Optional[int] = None, load_4bit: bool = False) -> dict:
    t0 = time.time()
    work = Path(tempfile.mkdtemp(prefix="strategy_agent_eval_"))
    settings = Settings(tenant_db_path=str(work / "tenant.sqlite"), shared_db_path=str(work / "shared.sqlite"), k_anonymity=k,
                        generator_backend="template", rag_backend=rag, allow_dev_auth=True)
    tenants, shared = TenantStore(settings.tenant_db_path), SharedStore(settings.shared_db_path)
    reader, anonymizer = SharedReader(settings.shared_db_path), Anonymizer()

    _log(f"training the outcome simulator ({simulator_samples} samples per objective) ...")
    world = World(seed)
    sim = OutcomeSimulator(world, seed=seed, n_train=simulator_samples)
    _log(f"simulator held-out R^2: {sim.r2}")

    _log(f"building {n_tenants} synthetic tenants and running the consent-gated pipeline ...")
    pop = build_population(tenants, world, n_tenants=n_tenants, seed=seed)
    pipe = ConsentGatedPipeline(tenants, shared, anonymizer, settings, noise_seed=seed)
    batch = pipe.run_batch()
    _log(f"pipeline: {batch}")
    insights = shared.query_insights(limit=10_000)
    if not insights:
        raise RuntimeError("no insights were published; the population is too sparse for the configured k")

    briefs = make_briefs(insights, n_briefs, seed)
    retriever = Retriever(rag)
    template_service = StrategyService(settings, tenants, reader, None, TemplateGenerator(), retriever)

    _log("privacy: PII leakage scan, k-anonymity audit, re-identification attacks, k / noise sweep (with utility) ...")
    privacy = {"pii": attacks.pii_leakage_scan(shared, pop, anonymizer), "k_audit": attacks.k_anonymity_audit(shared, settings.k_anonymity),
               "reidentification": attacks.qi_reidentification(shared, pop), "membership_inference": attacks.aggregate_membership_inference(shared, pop, tenants),
               "sweep": privacy_sweep(tenants, shared, pop, anonymizer, settings, lambda tag: shared_benefit(sim, template_service, briefs[:40], tag), seed=seed),
               "pipeline_batch": batch}

    _log(f"simulated A/B on {len(briefs)} briefs ...")
    simulator = evaluate_systems(world, sim, {"agent_template": template_service}, briefs, seed, progress=_log)

    generators: list[Generator] = [TemplateGenerator()]
    llm_status: dict = {"status": "not_run", "reason": "the local LLM was not requested (use --model qwen | mistral | llm | auto)."}
    ft_status: dict = {"status": "not_run", "reason": "no fine-tuned adapter was given (--adapter PATH). Fine-tuning needs a GPU: see docs/strategy_agent.md, section 10."}
    llm_service: Optional[StrategyService] = None
    llm_label = "agent_finetuned" if adapter else "agent_llm"
    if model != "template":
        base_name = llm_name or MODEL_ALIASES.get(model) or settings.llm_model_name
        llm = LLMGenerator(base_name, llm_max_new_tokens or settings.max_new_tokens, adapter, load_4bit)
        if llm.available():
            generators.append(llm)
            llm_service = StrategyService(settings, tenants, reader, llm, TemplateGenerator(), retriever)
        else:
            why = (f"the adapter {adapter} was not found" if adapter and not llm._adapter_ok() else
                   f"the model {base_name} is not available locally (weights are not cached, or torch / transformers / peft is missing)")
            llm_status = {"status": "not_run", "reason": f"{why}. Make it available, then run `python -m strategy_agent.eval.run --model {model}" + (f" --adapter {adapter}" if adapter else "") + "`."}
            if adapter:
                ft_status = {"status": "not_run", "reason": llm_status["reason"]}

    _log("structural evaluation ...")
    structural = [structural_eval(g, briefs if g.name == "template" else briefs[:n_llm_briefs]) for g in generators]

    _log("quality rubric ...")
    quality = {}
    for name, svc, subset in [("template", template_service, briefs)] + ([("llm", llm_service, briefs[:n_llm_briefs])] if llm_service else []):
        pairs = []
        for i, req in enumerate(subset):
            res = svc.generate(TenantContext(f"quality-{name}-{i}", "eval", ("tenant_admin",)), req.model_copy(update={"use_shared_insights": True}))
            pairs.append((req, res.strategies))
        quality[name] = quality_eval(pairs)

    if llm_service is not None:
        _log(f"local LLM vs template on {n_llm_briefs} briefs (slow on CPU) ...")
        sub = evaluate_systems(world, sim, {"agent_template": template_service, llm_label: llm_service}, briefs[:n_llm_briefs], seed, progress=_log)
        keep = {k: v for k, v in sub["systems"].items() if k.startswith("agent_")}
        llm_status = {"status": "run", "n_briefs": n_llm_briefs, "systems": keep, "base_model": base_name, "adapter": adapter or None,
                      "note": "small sample on CPU: treat differences as indicative only"}
        if adapter:
            ft_status = {"status": "run", "adapter": adapter, "base_model": base_name, "n_briefs": n_llm_briefs}

    llm_note = ("the deterministic template generator was evaluated; " + (("the fine-tuned model (base + adapter) was also evaluated on a small subset." if adapter else "the local LLM was also evaluated on a small subset.") if llm_service else
                "no LLM was evaluated in this run, so no claim is made about LLM or fine-tuned quality. Production fine-tunes Mistral 7B (QLoRA); only the generator is swapped."))
    R = {
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": seed, "n_briefs": len(briefs), "n_tenants": n_tenants,
                 "n_consenting": len(pop.consenting), "k": settings.k_anonymity, "pii_detector": anonymizer.engine, "retrieval": retriever.engine,
                 "runtime_seconds": round(time.time() - t0, 1), "python": sys.version.split()[0], "platform": platform.platform(), "generator_note": llm_note},
        "structural": structural, "quality": quality, "simulator": simulator, "privacy": privacy,
        "ablations": {"shared_vs_none": simulator["paired_comparisons"], "template_vs_llm": llm_status, "finetuned": ft_status},
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "eval_report.md").write_text(report.render_markdown(R))
    (out / "eval_report.html").write_text(report.render_html(R))
    (out / "eval_results.json").write_text(json.dumps(R, indent=2, default=str))
    _log(f"done in {R['meta']['runtime_seconds']}s -> {out}/eval_report.html")
    return R


def main() -> None:
    ap = argparse.ArgumentParser(description="Strategy Agent evaluation")
    ap.add_argument("--model", default="template", choices=["template", "qwen", "mistral", "llm", "auto"], help="generator alias to evaluate")
    ap.add_argument("--adapter", default="", help="path of a fine-tuned LoRA adapter to load on top of the base model")
    ap.add_argument("--llm-name", default=None, help="override the base model id / local directory")
    ap.add_argument("--load-4bit", action="store_true", help="load the LLM in 4-bit NF4 (NVIDIA GPU + bitsandbytes); needed for Mistral 7B on a 16 GB GPU")
    ap.add_argument("--n-briefs", type=int, default=60)
    ap.add_argument("--tenants", type=int, default=150)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="eval_reports")
    ap.add_argument("--llm-briefs", type=int, default=6, help="briefs used for the (slow) LLM evaluation")
    ap.add_argument("--rag", default="tfidf", choices=["tfidf", "auto", "embeddings"])
    a = ap.parse_args()
    run(a.model, a.n_briefs, a.tenants, a.seed, a.out, a.llm_briefs, rag=a.rag, adapter=a.adapter, llm_name=a.llm_name, experiment_log=default_log(), load_4bit=a.load_4bit)


if __name__ == "__main__":
    main()
