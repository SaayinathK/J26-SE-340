# services/lead-intel/src/clients/model_client.py — the only code that talks to the model server (Ollama)
# Embeddings: nomic-embed-text (768 numbers per text). Generation: the fine-tuned c3-mistral-ft.
import json

import numpy as np
import requests

from config import settings


def embed(texts: list[str], batch: int = 32) -> np.ndarray:
    """nomic-embed-text -> 768 numbers per text, normalised for cosine similarity."""
    out = []
    for i in range(0, len(texts), batch):
        chunk = texts[i:i + batch]
        r = requests.post(f"{settings.OLLAMA_URL}/api/embed",
                          json={"model": settings.EMBED_MODEL, "input": chunk}, timeout=300)
        r.raise_for_status()
        out.extend(r.json()["embeddings"])
        print(f"  embedded {min(i + batch, len(texts))}/{len(texts)}", end="\r")
    v = np.array(out, dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def generate_json(prompt: str, model: str | None = None) -> dict:
    """Ask the LLM for a JSON answer. Returns {'unparsed_text': ...} if it is not valid JSON."""
    r = requests.post(f"{settings.OLLAMA_URL}/api/generate", timeout=300, json={
        "model": model or settings.LLM_MODEL, "prompt": prompt, "stream": False, "format": "json",
        "keep_alive": "30m",
        "options": {"temperature": 0.2, "seed": 42, "num_predict": 220}})
    r.raise_for_status()
    text = r.json()["response"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"unparsed_text": text}
