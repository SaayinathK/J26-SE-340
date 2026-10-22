# ml/lead-intel/training/build_kb.py  — C3-07 build the per-tenant knowledge base (needs Ollama + nomic-embed-text)
# Writes ml/lead-intel/data/kb/<tenant>_docs.jsonl + <tenant>_vectors.npy and reports/c3-07_kb_counts.csv
# Run:  python ml/lead-intel/training/build_kb.py [tenant_a tenant_b ...]     (all tenants if none given)
#       python ml/lead-intel/training/build_kb.py --counts                     (only re-count the saved files)
import sys

import _paths  # noqa: F401
from agent import kb

if __name__ == "__main__":
    if sys.argv[1:] == ["--counts"]:
        c = kb.counts_from_files()
        c.to_csv(kb.COUNTS_CSV)
        print(c)
        sys.exit()
    df = kb.load()
    for t in sys.argv[1:] or kb.TENANTS:
        kb.build(t, df)
    c = kb.counts_from_files()                           # all tenants, not only the ones just built
    c.to_csv(kb.COUNTS_CSV)
    print("\nKB summary:\n", c)
    print("\nTest search (tenant_a): 'working professional from Google who opened an email'")
    for h in kb.search("tenant_a", "working professional from Google who opened an email", k=3):
        print(f"  [{h['score']}] {h['type']}: {h['text'][:110]}")
