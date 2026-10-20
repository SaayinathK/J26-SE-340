# C1 Content Agent Model

This folder contains the fine-tuned Mistral 7B model for the Content Agent.

## Model Details
- Base model: unsloth/mistral-7b-instruct-v0.3
- Fine-tuned on: smangrul/ad-copy-generation + suehuynh/marketing-instruct-8k
- Training examples: 2000
- Final training loss: 1.0668
- Quantisation: Q4_K_M GGUF
- Ollama model name: c1-content-agent

## Setup
1. Download mistral-7b-instruct-v0.3.Q4_K_M.gguf from Google Drive
2. Place in this folder
3. Run: ollama create c1-content-agent -f Modelfile
4. Update .env: CONTENT_MODEL=c1-content-agent
