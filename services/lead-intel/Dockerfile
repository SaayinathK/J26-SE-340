# services/lead-intel/Dockerfile — C3 Lead Intelligence API (port 4003)
# The repository layout is kept inside the image (/app/services/lead-intel), and docker-compose
# mounts ./ml at /app/ml (read-only), so the code finds the model, data and reports at the same paths.
FROM python:3.13-slim
WORKDIR /app/services/lead-intel
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/services/lead-intel/src C3_REPO_ROOT=/app C3_STATE_DIR=/state
COPY requirements.docker.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.docker.txt -c requirements.lock.txt
COPY src ./src
COPY db ./db
COPY tests ./tests
COPY pytest.ini ./
COPY streamlit ./streamlit
COPY .streamlit ./.streamlit
RUN mkdir -p /state /app/ml
EXPOSE 4003
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "4003"]
