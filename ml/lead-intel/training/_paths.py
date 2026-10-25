# ml/lead-intel/training/_paths.py — lets the training and evaluation scripts use the C3 service code
# (services/lead-intel/src: features, scoring, knowledge base, RAG) without copying it.
# Every script here starts with:  import _paths  # noqa: F401
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[3] / "services" / "lead-intel" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
