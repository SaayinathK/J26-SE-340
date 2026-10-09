#!/usr/bin/env bash
# Serve the FINE-TUNED Mistral-7B behind the Strategy Agent UI. Requires an NVIDIA GPU.
# Run AFTER the one-time setup (venv + CUDA torch + requirements).
export GENERATOR_BACKEND=auto
export LLM_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.3
export ADAPTER_PATH=sft_adapter
export ADAPTER_ID=sft-v1
export LLM_LOAD_4BIT=true
export MODEL_VERSION=mistral-sft-v1
python -m uvicorn strategy_agent.api.main:create_app --factory --port 8100
