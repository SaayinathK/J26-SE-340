FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.docker.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.docker.txt -c requirements.lock.txt
COPY *.py ./
COPY tests ./tests
COPY reports/c3-05_segments.csv ./reports/c3-05_segments.csv
COPY data/business_context ./data/business_context
RUN mkdir -p models data/processed data/kb /state
EXPOSE 3001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3001"]
COPY .streamlit ./.streamlit
