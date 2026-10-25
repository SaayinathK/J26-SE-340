#!/bin/sh
# ml/lead-intel/serving/entrypoint.sh — start Ollama, then make sure the two C3 models exist:
#   nomic-embed-text (embeddings for retrieval) and c3-mistral-ft (fine-tuned LLM, from the GGUF file)
set -e
ollama serve &
SERVER=$!
until ollama list >/dev/null 2>&1; do sleep 1; done

if ! ollama list | grep -q '^nomic-embed-text'; then
  ollama pull nomic-embed-text || echo "WARNING: could not download nomic-embed-text (no internet?)"
fi
if ! ollama list | grep -q '^c3-mistral-ft'; then
  if [ -f /models/c3-mistral-ft-Q4_K_M.gguf ]; then
    sed 's#^FROM .*#FROM /models/c3-mistral-ft-Q4_K_M.gguf#' /serving/Modelfile > /tmp/Modelfile
    ollama create c3-mistral-ft -f /tmp/Modelfile
  else
    echo "WARNING: ml/models/lead-intel/c3-mistral-ft-Q4_K_M.gguf not found - see ml/lead-intel/README.md"
  fi
fi
wait $SERVER
