# services/lead-intel/tests/conftest.py — test settings (loaded by pytest before the tests)
import os
import tempfile

# Tests never write into the real lead history used by the running API:
# they use JSON-lines files in a fresh temporary folder, never the database.
os.environ["C3_STATE_DIR"] = tempfile.mkdtemp(prefix="c3-test-state-")
os.environ["C3_DATABASE_URL"] = ""
