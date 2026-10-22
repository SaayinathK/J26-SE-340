# services/lead-intel/src/config/settings.py — every path and setting of the C3 service in one place
# Paths follow the team folder structure:
#   ml/lead-intel/data/...      data (raw + processed are gitignored)
#   ml/lead-intel/reports/...   evaluation results
#   ml/models/lead-intel/...    trained model files (gitignored)
# Each value can be overridden with an environment variable (Docker does this).
import os
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[2]                    # services/lead-intel
REPO_ROOT = Path(os.getenv("C3_REPO_ROOT", SERVICE_DIR.parents[1]))  # repository root
ML_DIR = Path(os.getenv("C3_ML_DIR", REPO_ROOT / "ml" / "lead-intel"))


def _path(env: str, default: Path) -> Path:
    return Path(os.getenv(env, default))


# ---------- data and model files ----------
DATA_DIR = ML_DIR / "data"
RAW_LEADS = _path("C3_RAW_LEADS", DATA_DIR / "raw" / "Leads.csv")
LEADS_PATH = _path("C3_LEADS_PATH", DATA_DIR / "processed" / "leads_ghl.jsonl")
KB_DIR = _path("C3_KB_DIR", DATA_DIR / "kb")
BC_DIR = _path("C3_BC_DIR", DATA_DIR / "business_context")
FINETUNE_DIR = _path("C3_FINETUNE_DIR", DATA_DIR / "finetune")
REPORTS_DIR = _path("C3_REPORTS_DIR", ML_DIR / "reports")
SEGMENTS_CSV = _path("C3_SEGMENTS", REPORTS_DIR / "c3-05_segments.csv")
MODEL_PATH = _path("C3_MODEL_PATH", REPO_ROOT / "ml" / "models" / "lead-intel" / "lead_scorer.joblib")

# ---------- model server (Ollama) ----------
# 127.0.0.1, not localhost: avoids a ~2 s IPv6 delay on Windows
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
LLM_MODEL = os.getenv("C3_LLM_MODEL", "mistral:7b-instruct-q4_K_M")
EMBED_MODEL = os.getenv("C3_EMBED_MODEL", "nomic-embed-text")
RETRIEVAL = os.getenv("C3_RETRIEVAL", "hybrid")      # C3-09 result: hybrid (alpha 0.7) beat embedding-only

# ---------- history storage (scores, recommendations, outcomes) ----------
# C3_DATABASE_URL set   -> the C3 Postgres database (Docker: lead-intel-database)
# C3_DATABASE_URL empty -> JSON-lines files in C3_STATE_DIR (local runs and tests)
DATABASE_URL = os.getenv("C3_DATABASE_URL", "").strip()
STATE_DIR = _path("C3_STATE_DIR", SERVICE_DIR / "state")

# ---------- API ----------
PORT = int(os.getenv("C3_PORT", "4003"))
