# services/lead-intel/conftest.py — test settings (loaded by pytest before the tests)
import os
import tempfile

# Tests must never write into the real score history used by the running API (C3-11)
os.environ.setdefault("C3_HISTORY", os.path.join(tempfile.mkdtemp(), "score_history.json"))