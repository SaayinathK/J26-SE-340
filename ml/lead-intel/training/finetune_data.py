# ml/lead-intel/training/finetune_data.py  — C3-14 Build the fine-tuning dataset for Mistral 7B (QLoRA)
#
# Goal of the fine-tuning: teach Mistral the BEHAVIOUR C3 needs, not new facts (facts stay in RAG):
#   1. answer with valid JSON only, "sources" first
#   2. cite real retrieved sources (S-labels), always including the follow-up policy
#   3. follow this tenant's follow-up policy for the lead's segment
#
# Each example = the exact prompt rag.recommend() sends (same retrieval, same S-labels)
#              + a correct answer built from the retrieved sources (rule-based "gold" answer).
# Only TRAIN-split leads are used. The 30 leads of rag_eval.py are excluded, so the
# base-vs-fine-tuned comparison is on leads the model never saw.
#
# Needs Ollama (nomic-embed-text) and the KB.  Run:  python ml/lead-intel/training/finetune_data.py
# Output: ml/lead-intel/data/finetune/train.jsonl + val.jsonl, ml/lead-intel/reports/c3-14_dataset_summary.json
import json
import re
from pathlib import Path

import numpy as np

import _paths  # noqa: F401
from agent import kb
from agent.rag import build_prompt, ground, policy_check, retrieve
from config import settings
from services.features import split
from services.scoring import LEADS, score_lead

OUT = Path(settings.FINETUNE_DIR)
SUMMARY = settings.REPORTS_DIR / "c3-14_dataset_summary.json"
PER_TENANT_SEGMENT = 40          # 3 tenants x 3 segments x 40 = 360 examples (about 320 train / 40 val)
VAL_SHARE = 0.1
rng = np.random.default_rng(42)

OPENINGS = ["Hi there!", "Hello!", "Hi!", "Good day!"]
HOT = ["Thanks for your interest in our {offer}. {hook} Our team will contact you {when} to answer your questions.",
       "We noticed your strong interest in our {offer}. {hook} Expect a personal follow-up from us {when}."]
WARM = ["Thank you for looking at our {offer}. {hook} We would like to send you {thing}.",
        "Thanks for visiting us. {hook} We will share {thing} to help you decide about our {offer}."]
COLD = ["Thanks for your interest in our {offer}. {hook} We will keep you updated with {thing}.",
        "Thank you for stopping by. {hook} You will receive {thing} so you can explore our {offer} at your own pace."]
HOOKS = {"Working Professional": "As a working professional, you can fit it around your job.",
         "Student": "As a student, you can build skills alongside your studies.",
         "Unemployed": "It can help you prepare for a new role.",
         "Businessman": "It can help you grow your business."}


def rag_eval_leads() -> set:
    """Same 30 leads rag_eval.py uses (same seed and order) -> never used for training."""
    picked, ids = {"hot": 0, "warm": 0, "cold": 0}, set()
    for r in LEADS[LEADS.tenant == "tenant_a"].sample(frac=1, random_state=42).to_dict("records"):
        seg = score_lead({**r, "lead_id": r["contact_id"]})["segment"]
        if picked[seg] < 10:
            picked[seg] += 1
            ids.add(r["contact_id"])
        if all(v == 10 for v in picked.values()):
            return ids
    return ids


def offer(tenant: str) -> str:
    for p in kb.business_docs(tenant):
        if p.startswith("Offer:"):
            return re.split(r"[.,]", p.split(":", 1)[1].strip())[0]
    return "programme"


def hook(lead: dict) -> str:
    return HOOKS.get(lead.get("occupation"), "You can learn at a pace that fits you.")


def gold_answer(lead: dict, scored: dict, hits: list[dict], rule: str, rule_label: str, tenant: str) -> dict:
    seg = scored["segment"]
    similar = next((h for h in hits if h["type"] == "lead_profile"), None)
    pattern = next((h for h in hits if h["type"] == "pattern"), None)
    sources = [rule_label] + [h["label"] for h in (similar, pattern) if h]
    action = f"Follow the {seg}-lead policy ({rule_label}): this lead should {rule}."
    if similar:
        outcome = "converted" if similar.get("converted") == 1 else "did not convert"
        action += f" A similar past lead ({similar['label']}) {outcome}."
    templates = {"hot": HOT, "warm": WARM, "cold": COLD}[seg]
    thing = re.sub(r"^(get|gets|go into|receive)\s+", "", rule).split(" within")[0]
    message = rng.choice(OPENINGS) + " " + rng.choice(templates).format(
        offer=offer(tenant), hook=hook(lead), when="within 24 hours" if "24" in rule else "today", thing=thing)
    return {"sources": sources, "next_best_action": action, "message_draft": message}


def main():
    train_ids = set(split(LEADS)[0].contact_id) - rag_eval_leads()
    rows, skipped = [], 0
    for tenant in kb.TENANTS:
        pool = LEADS[(LEADS.tenant == tenant) & LEADS.contact_id.isin(train_ids)]
        need = {"hot": PER_TENANT_SEGMENT, "warm": PER_TENANT_SEGMENT, "cold": PER_TENANT_SEGMENT}
        for r in pool.sample(frac=1, random_state=42).to_dict("records"):
            lead = {**r, "lead_id": r["contact_id"]}
            scored = score_lead(lead)
            if need[scored["segment"]] == 0:
                continue
            hits = retrieve(tenant, lead)
            prompt, rule, rule_label = build_prompt(lead, scored, hits)
            if not rule:
                skipped += 1
                continue
            answer = gold_answer(lead, scored, hits, rule, rule_label, tenant)
            # the gold answer must pass the same checks the API applies
            assert ground(answer, hits)["grounded"], answer
            assert policy_check(answer["next_best_action"], rule) == "consistent", answer
            rows.append({"tenant": tenant, "segment": scored["segment"], "lead_id": lead["lead_id"],
                         "messages": [{"role": "user", "content": prompt},
                                      {"role": "assistant", "content": json.dumps(answer)}]})
            need[scored["segment"]] -= 1
            if not any(need.values()):
                break
        print(f"{tenant}: done")

    order = rng.permutation(len(rows))
    n_val = int(len(rows) * VAL_SHARE)
    val, train = [rows[i] for i in order[:n_val]], [rows[i] for i in order[n_val:]]
    OUT.mkdir(parents=True, exist_ok=True)
    for name, part in (("train", train), ("val", val)):
        with open(OUT / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for row in part:
                f.write(json.dumps({"messages": row["messages"]}) + "\n")
    chars = [len(r["messages"][0]["content"]) for r in rows]
    summary = {"examples": len(rows), "train": len(train), "val": len(val), "skipped_no_policy": skipped,
               "by_tenant_segment": {f"{t}/{s}": sum(1 for r in rows if r["tenant"] == t and r["segment"] == s)
                                     for t in kb.TENANTS for s in ("hot", "warm", "cold")},
               "prompt_chars_median": int(np.median(chars)), "prompt_chars_max": int(max(chars)),
               "excluded": "test/val split leads and the 30 rag_eval.py leads",
               "gold_answers": "rule-based from retrieved sources: policy + similar lead + pattern"}
    SUMMARY.parent.mkdir(exist_ok=True)
    json.dump(summary, open(SUMMARY, "w"), indent=2)
    print(json.dumps(summary, indent=2))
    print("\nExample answer:\n", train[0]["messages"][1]["content"])


if __name__ == "__main__":
    main()