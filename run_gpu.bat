@echo off
REM Serve the FINE-TUNED Mistral-7B behind the Strategy Agent UI. Requires an NVIDIA GPU.
REM Run AFTER the one-time setup in RUN_ON_RTX.md (venv + CUDA torch + requirements).
set GENERATOR_BACKEND=auto
set LLM_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.3
set ADAPTER_PATH=sft_adapter
set ADAPTER_ID=sft-v1
set LLM_LOAD_4BIT=true
set MODEL_VERSION=mistral-sft-v1
python -m uvicorn strategy_agent.api.main:create_app --factory --port 8100
