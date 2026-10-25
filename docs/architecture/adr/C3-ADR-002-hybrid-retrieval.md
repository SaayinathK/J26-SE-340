# C3-ADR-002 — Hybrid retrieval (0.7 embedding + 0.3 BM25) for the RAG knowledge base

**Date:** 13 Oct 2026 (re-checked on 100 queries, 20 Oct 2026) · **Status:** Accepted · **Owner:** Shathursini J (C3)

## Context
O3/O4: retrieval must find the right CRM context, be measured with precision/recall on at least 100 test
queries, and beat a naive keyword baseline on MRR within 500 ms.

## Options compared (`retrieval_eval.py tenant_a 100`, 100 rule-labelled queries over 3,175 documents)
| Method | P@5 | Recall@5 | Hit@5 | MRR | Median latency |
| --- | --- | --- | --- | --- | --- |
| BM25 (keyword baseline) | 0.448 | 0.267 | 0.920 | 0.736 | 37 ms |
| Embedding (nomic) | 0.572 | 0.292 | 0.960 | 0.861 | 110 ms |
| Hybrid 0.3 | 0.534 | 0.278 | 0.950 | 0.794 | 145 ms |
| Hybrid 0.5 | 0.576 | 0.304 | 0.970 | 0.812 | 141 ms |
| **Hybrid 0.7** | **0.590** | **0.306** | **0.970** | **0.865** | **141 ms** |
| RRF | 0.568 | 0.296 | 0.960 | 0.813 | 144 ms |

The first run on 50 queries (13 Oct) gave the same winner: hybrid 0.7 MRR 0.858 vs BM25 0.726.

## Decision
Use hybrid with alpha 0.7 (`C3_RETRIEVAL=hybrid`, `kb.HYBRID_ALPHA=0.7`). Call Ollama on 127.0.0.1, not
localhost (the Windows IPv6 fallback added about 2 s per call).

## Consequences
- MRR +17.5% over the keyword baseline; hybrid search p95 175 ms including the query embedding (`reports/c3-13_latency.csv`).
- Most of the gain comes from the embeddings: hybrid is only slightly above embedding-only on MRR (0.865 vs 0.861);
  its advantage is precision (0.590 vs 0.572) and exact matching for business questions.
- Recall@5 is low for similar-lead queries (0.13) because they have many relevant past leads and only 5 are returned;
  it is 1.0 for business and pattern questions.
- Labels are rule-based (silver labels), not judged by hand, and differences were not tested for statistical significance.
