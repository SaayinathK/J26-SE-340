# ml/lead-intel/serving/Dockerfile — lead-intel-model container: Ollama serving the C3 models
# The GGUF file is mounted read-only from ml/models/lead-intel (gitignored, about 4.4 GB).
FROM ollama/ollama:latest
COPY Modelfile entrypoint.sh /serving/
RUN sed -i 's/\r$//' /serving/entrypoint.sh && chmod +x /serving/entrypoint.sh
EXPOSE 11434
ENTRYPOINT ["/serving/entrypoint.sh"]
