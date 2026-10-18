# Surette Nexus AI service (FastAPI + LlamaIndex). Internal only: the web app and worker call it.
FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /app app
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY surette_ml ./surette_ml
USER app
ENV ML_ENV=production PYTHONUNBUFFERED=1
EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8600/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "surette_ml.app:app", "--host", "0.0.0.0", "--port", "8600", "--workers", "2"]
