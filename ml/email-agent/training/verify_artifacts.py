"""Verify provided JSONL artifacts, without claiming to rebuild them from CSV.

Run prepare_email_ft.py separately to reproduce its cleaning,
grounded rewriting, and split algorithm. This verifier does not train a model.
"""
import argparse
import csv
import hashlib
import json
import re
import subprocess
from pathlib import Path

PII_RE = re.compile(r"\b(\+?\d[\d\s\-]{7,}\d|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{9,12})\b")
FACT_RE = re.compile(r"\d+(?:\.\d+)?%|\$\s?\d[\d,]*(?:\.\d+)?|\b\d+x\b")
CODE_RE = re.compile(r"\b(?:[Ss]ave|SAVE|CODE|PROMO|DEAL|OFF)\d+\b|\b[A-Z]{3,}\d{1,3}\b")
SPAM = ["free!!!", "guaranteed income", "act now!!!", "limited time offer", "click here now", "make money fast"]
CHECKS = ["json_valid", "three_emails", "unsubscribe_all", "grounded", "no_invented_offer", "under_150_words", "guardrails_pass"]


def check(prompt, text):
    """The seven reference checks from the supplied notebook's cell 5."""
    goal = re.search(r"Campaign goal: (.*)", prompt)
    context = prompt.split("You are an email marketing specialist.")[0] + " " + (goal[1] if goal else "")
    no_offer = "There is no discount or promo code" in prompt
    try:
        emails = json.loads(text[text.index("{"):text.rindex("}") + 1])["emails"]
        if not isinstance(emails, list) or not all(isinstance(email, dict) for email in emails):
            raise ValueError("Invalid emails")
        emails = [{**email, "subject": str(email.get("subject", "")), "body": str(email.get("body", ""))} for email in emails]
    except (ValueError, KeyError, TypeError):
        return dict.fromkeys(CHECKS, False)
    result = {"json_valid": True}
    result["three_emails"] = len(emails) == 3 and [email.get("send_at_days") for email in emails] == [0, 3, 7]
    result["unsubscribe_all"] = all(re.search(r"unsubscribe|opt.?out|reply\s+stop", email["body"], re.I) for email in emails)
    facts = [fact for email in emails for fact in FACT_RE.findall(email["subject"] + " " + email["body"])]
    codes = [code for email in emails for code in CODE_RE.findall(email["subject"] + " " + email["body"]) if code != "STOP"]
    result["grounded"] = all(fact.replace(" ", "") in context.replace(" ", "") for fact in facts) and all(code in context for code in codes)
    result["no_invented_offer"] = not facts and not codes if no_offer else True
    result["under_150_words"] = all(len(email["body"].split()) <= 150 for email in emails)
    pii = any(PII_RE.search(email["subject"] + " " + email["body"]) for email in emails)
    spam = any(word in (email["subject"] + " " + email["body"]).lower() for email in emails for word in SPAM)
    caps = any(len(re.findall(r"[A-Z]{4,}", (email["subject"] + " " + email["body"]).replace("STOP", ""))) > 3 for email in emails)
    result["guardrails_pass"] = bool(result["unsubscribe_all"] and result["grounded"] and not (pii or spam or caps))
    return {key: bool(value) for key, value in result.items()}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--report", type=Path, default=Path("build_report.json"))
    args = parser.parse_args()
    with args.csv.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    report = {
        "report_type": "provided_artifact_verification",
        "csv_preparation_reproduced": False,
        "preparation_status": "Artifact verification only; CSV cleaning and regeneration were not run by this verifier.",
        "csv": {"file": args.csv.name, "sha256": sha256(args.csv), "rows": len(rows), "nonempty_bodies": sum(bool((row.get("body") or "").strip()) for row in rows)},
        "ctr": {"column": "ctr(hypothetical)", "synthetic": True, "used_for_language_model_verification": False},
        "splits": {},
    }
    product_sets = {}
    all_passed = True
    for split, expected in (("train", 715), ("val", 171)):
        path = args.data / (split + ".jsonl")
        examples = [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
        contract = subprocess.run(["node", str(Path(__file__).with_name("prompt_contract.cjs"))], input=json.dumps(examples), text=True, encoding="utf-8", capture_output=True, check=True)
        checks = [check(example["messages"][0]["content"], example["messages"][1]["content"]) for example in examples]
        matches = json.loads(contract.stdout)
        counts = {key: sum(row[key] for row in checks) for key in CHECKS}
        contract_counts = {key: sum(row[key] for row in matches) for key in ("prompt_matches_app", "fixed_context_line", "app_guardrails_pass")}
        products = set()
        for example in examples:
            product = re.search(r"^Product / campaign focus: (.+)\.$", example["messages"][0]["content"], re.M)
            if product:
                products.add(product[1])
        product_sets[split] = products
        report["splits"][split] = {"file": path.name, "sha256": sha256(path), "examples": len(examples), "expected_examples": expected, "expected_count_matches": len(examples) == expected, "reference_checks_passed": counts, "app_contract_checks_passed": contract_counts, "products": sorted(products)}
        all_passed = all_passed and len(examples) == expected and all(value == len(examples) for value in [*counts.values(), *contract_counts.values()])
    overlap = sorted(product_sets["train"] & product_sets["val"])
    report["product_split"] = {"validation_product_count": len(product_sets["val"]), "overlap": overlap, "disjoint": not overlap}
    report["verification_passed"] = all_passed and not overlap and len(product_sets["val"]) == 5
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"train": report["splits"]["train"]["examples"], "validation": report["splits"]["val"]["examples"], "validation_products": len(product_sets["val"]), "all_checks_passed": report["verification_passed"], "csv_rebuilt": False, "report": str(args.report)}, indent=2))
    raise SystemExit(0 if report["verification_passed"] else 1)


if __name__ == "__main__":
    main()
