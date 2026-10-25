# services/lead-intel/tests/fakes.py — offline stand-in for nomic-embed-text (tests only)
# Hashes words into a fixed-size vector so tests run without Ollama. Real runs use clients/model_client.embed.
import re
import zlib
import numpy as np

def fake_embed(texts, batch=32, dim=256):
    out = np.zeros((len(texts), dim), dtype=np.float32)
    for i, t in enumerate(texts):
        for w in re.findall(r"[a-z0-9]+", str(t).lower()):
            out[i, zlib.crc32(w.encode()) % dim] += 1.0
    out += 1e-6
    return out / np.linalg.norm(out, axis=1, keepdims=True)

def use_fake_kb(monkeypatch, tmp_path, tenants=("tenant_a",), n=300):
    """Build a small real-format KB from the first n leads of each tenant, offline."""
    from agent import kb, rag
    monkeypatch.setattr(kb, "embed", fake_embed)
    monkeypatch.setattr(rag, "embed", fake_embed)
    monkeypatch.setattr(kb, "KB_DIR", tmp_path)
    kb._CACHE.clear(); kb._BM25.clear()
    df = kb.load()
    small = df.groupby("tenant").head(n)
    for t in tenants:
        kb.build(t, small)
    return small