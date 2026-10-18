"""Recheck local fine-tuning evidence without loading or retraining the model."""
import csv
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "evidence/planner/checks"
FT = ROOT / "ml/finetune"
CHECKS = ["json_valid", "three_emails", "unsubscribe_all", "grounded",
          "no_invented_offer", "under_150_words", "guardrails_pass"]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    summary = {"audit_date": "2026-10-21", "model_inference_rerun": False}
    for model in ["base", "fine-tuned"]:
        path = ROOT / f"evidence/c4-ft/c4-ft_eval_{model}.csv"
        with path.open(encoding="utf-8-sig", newline="") as file:
            rows = list(csv.DictReader(file))
        flags = [{key: row[key].lower() == "true" for key in CHECKS} for row in rows]
        summary[model] = {
            "prompts": len(rows), "all_checks_passed": sum(all(row.values()) for row in flags),
            "all_checks_pass_percent": 100 * sum(all(row.values()) for row in flags) / len(rows),
            "per_check_passed": {key: sum(row[key] for row in flags) for key in CHECKS},
            "failed_rows": [{"i": rows[i]["i"], "failed": [k for k in CHECKS if not row[k]]}
                            for i, row in enumerate(flags) if not all(row.values())],
            "sha256": digest(path),
        }
    with (ROOT / "evidence/c4-ft/c4-ft_training_log.csv").open(newline="", encoding="utf-8-sig") as file:
        evaluations = [{"step": int(r["step"]), "eval_loss": float(r["eval_loss"])}
                       for r in csv.DictReader(file) if r["eval_loss"]]
    summary["validation_loss"] = {"first": evaluations[0], "last": evaluations[-1],
                                  "best_recorded": min(evaluations, key=lambda r: r["eval_loss"])}
    adapter = FT / "models/c4-email-lora/adapter_model.safetensors"
    with adapter.open("rb") as file:
        header_size = struct.unpack("<Q", file.read(8))[0]
        if header_size > adapter.stat().st_size - 8:
            raise ValueError("Invalid adapter header size")
        header = json.loads(file.read(header_size))
    tensors = {k: v for k, v in header.items() if k != "__metadata__"}
    data_size = adapter.stat().st_size - 8 - header_size
    offsets_valid = all(0 <= v["data_offsets"][0] <= v["data_offsets"][1] <= data_size
                        for v in tensors.values())
    summary["adapter"] = {"bytes": adapter.stat().st_size, "sha256": digest(adapter),
                           "tensors": len(tensors), "offsets_valid": offsets_valid,
                           "loaded_for_inference": False}
    with tempfile.TemporaryDirectory(prefix="c4_planner_rebuild_") as folder:
        result = subprocess.run([sys.executable, str(FT / "prepare_email_ft.py"), "--csv",
                                 str(FT / "Email_Marketing_Campaign_CTR_Dataset.csv"),
                                 "--out", folder], capture_output=True, text=True, encoding="utf-8")
        (OUT / "dataset-rebuild.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
        rebuild = {"exit_code": result.returncode, "original_script_present": True}
        if result.returncode == 0:
            rebuilt = Path(folder)
            report = json.loads((rebuilt / "build_report.json").read_text())
            (OUT / "dataset-rebuild-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            rebuild["report"] = report
            rebuild["splits"] = {}
            for split in ["train", "val"]:
                expected = FT / f"data/{split}.jsonl"
                actual = rebuilt / f"{split}.jsonl"
                expected_rows = [json.loads(line) for line in expected.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
                actual_rows = [json.loads(line) for line in actual.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
                rebuild["splits"][split] = {
                    "provided_count": len(expected_rows), "rebuilt_count": len(actual_rows),
                    "bytes_identical": digest(expected) == digest(actual),
                    "parsed_examples_identical": expected_rows == actual_rows,
                    "provided_sha256": digest(expected), "rebuilt_sha256": digest(actual),
                }
        summary["dataset_reproduction"] = rebuild
    (OUT / "fine-tuning-audit.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    if not offsets_valid or summary["dataset_reproduction"]["exit_code"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
