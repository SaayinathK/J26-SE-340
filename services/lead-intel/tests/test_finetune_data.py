# services/lead-intel/tests/test_finetune_data.py — C3-14 the fine-tuning examples are correct by construction
import json
import finetune_data as fd
from tests.fakes import use_fake_kb

def test_examples_are_grounded_policy_consistent_and_exclude_eval_leads(monkeypatch, tmp_path):
    use_fake_kb(monkeypatch, tmp_path / "kb", tenants=("tenant_a", "tenant_b", "tenant_c"), n=400)
    monkeypatch.setattr(fd, "OUT", tmp_path / "ft")
    monkeypatch.setattr(fd, "SUMMARY", tmp_path / "summary.json")
    monkeypatch.setattr(fd, "PER_TENANT_SEGMENT", 3)
    fd.main()
    rows = [json.loads(l) for f in ("train", "val") for l in open(tmp_path / "ft" / f"{f}.jsonl")]
    assert len(rows) == 27                                       # 3 tenants x 3 segments x 3
    for r in rows:
        user, answer = r["messages"][0]["content"], json.loads(r["messages"][1]["content"])
        assert set(answer) == {"sources", "next_best_action", "message_draft"}
        assert all(f"{s}:" in user for s in answer["sources"])   # every cited label exists in the prompt
    summary = json.load(open(tmp_path / "summary.json"))
    assert summary["examples"] == 27