FROM python:3.12-slim-bookworm

ARG OPENDATALOADER_PDF_VERSION=2.4.7

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin pdfparser

WORKDIR /workspace/apps/pdf-parser

ENV HOME=/home/pdfparser
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV KNOWLEDGE_PDF_PARSER_TMPDIR=/tmp/llm-machines-pdf-parser

COPY apps/pdf-parser/pyproject.toml ./
COPY apps/pdf-parser/src ./src

RUN pip install --no-cache-dir "." \
  && python -c "import opendataloader_pdf; import importlib.metadata; assert importlib.metadata.version('opendataloader-pdf') == '${OPENDATALOADER_PDF_VERSION}'" \
  && mkdir -p /tmp/llm-machines-pdf-parser \
  && chown -R pdfparser:pdfparser /workspace/apps/pdf-parser /tmp/llm-machines-pdf-parser /home/pdfparser

USER 10001:10001

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "pdf_parser.main:app", "--host", "0.0.0.0", "--port", "8000"]
