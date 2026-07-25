FROM python:3.12-slim

WORKDIR /workspace/apps/sidecar

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV HOST=0.0.0.0
ENV PORT=8000

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ghostscript \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hrv \
  && rm -rf /var/lib/apt/lists/*

COPY apps/sidecar/pyproject.toml ./
COPY apps/sidecar/src ./src

RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "sidecar.main:app", "--host", "0.0.0.0", "--port", "8000"]
