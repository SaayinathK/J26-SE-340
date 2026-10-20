# C3-ADR-005 — Merge the LoRA adapter into Mistral 7B and serve it as GGUF Q4_K_M in Ollama

**Date:** 20 Oct 2026 · **Status:** Accepted · **Owner:** Shathursini J (C3)

## Context
The plan was to load the QLoRA adapter in Ollama with `ADAPTER` in the Modelfile. On 19 Oct, `ollama create`
failed with "LoRA adapters are no longer supported": the `ADAPTER` instruction was removed in Ollama 0.34.1.

## Options
1. Downgrade Ollama — rejected: an old version would be a risk for the shared platform.
2. Serve the model with another runtime (e.g. vLLM) — rejected: needs a GPU and changes the C3 stack.
3. **Merge the adapter into the base weights and import one GGUF file** — chosen.

## Decision
`notebooks/03_merge_lora_to_gguf.ipynb` (Colab, CPU runtime):
merge W + (alpha / r) · B · A shard by shard → convert to GGUF with llama.cpp → quantise to Q4_K_M (4.37 GB),
the same size class as the base `mistral:7b-instruct-q4_K_M`, so the base vs fine-tuned comparison is fair.
The Modelfile uses `FROM ./models/c3-mistral-ft-Q4_K_M.gguf`; the model is created as `c3-mistral-ft`.
RAG selects it with `C3_LLM_MODEL=c3-mistral-ft`.

## Consequences
- Works with the current Ollama; `rag_eval.py` ran 30/30 with the merged model.
- The adapter was trained on a 4-bit base and merged into the full-precision base, then re-quantised:
  a small mismatch is possible, so the model was re-evaluated after merging (C3-ADR-003 results).
- The 4.4 GB file is not in git (`models/` is ignored); it is kept in Google Drive and rebuilt by notebook 03.
- Risk noted for the team: external tool changes can break deployment; pin tool versions before the final demo.
