# services/lead-intel/src/main.py  — C3 Lead Intelligence Agent API (port 4003, behind the C4 gateway)
# Run locally (from services/lead-intel):   uvicorn main:app --app-dir src --port 4003 --reload
from fastapi import FastAPI

from api.leads import router as leads_router
from repositories import get_repo
from services.scoring import LEADS, MODEL_VERSION

app = FastAPI(title="C3 Lead Intelligence Agent")
app.include_router(leads_router)


@app.get("/health")
def health():
    return {"ok": True, "model_version": MODEL_VERSION, "leads_loaded": len(LEADS),
            "history_storage": get_repo().kind}
