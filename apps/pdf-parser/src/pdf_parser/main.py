from __future__ import annotations

import hashlib
import hmac
import os
import re
import tempfile
import time
from collections.abc import Mapping
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from pdf_parser.models import (
    HealthResponse,
    PdfChunk,
    PdfExtractionArtifacts,
    PdfExtractionMetadata,
    PdfExtractionResponse,
)
from pdf_parser.opendataloader import OpenDataLoaderOutput, ParserError, ParserTimeout, run_opendataloader

SERVICE_TOKEN_HEADER = "X-LLM-Machines-Pdf-Parser-Token"
DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024
DEFAULT_MAX_PAGES = 100
DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

app = FastAPI(title="LLM Machines PDF Parser")


def healthz() -> HealthResponse:
    return HealthResponse()


def require_service_token(
    x_llm_machines_pdf_parser_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", "").strip()
    if (
        not expected
        or not x_llm_machines_pdf_parser_token
        or not hmac.compare_digest(x_llm_machines_pdf_parser_token, expected)
    ):
        raise HTTPException(status_code=401, detail="PDF parser service token is required.")


@app.post("/v1/pdf/extract", response_model=PdfExtractionResponse)
async def extract_pdf(
    source_id: str = Form(..., min_length=1, max_length=120),
    file_name: str = Form(..., min_length=1, max_length=240),
    checksum: str = Form(..., min_length=1, max_length=160),
    file: UploadFile = File(...),
    _auth: None = Depends(require_service_token),
) -> PdfExtractionResponse:
    started = time.monotonic()
    body = await file.read()
    validate_pdf_upload(body, file_name, file.content_type)
    page_count = count_pdf_pages(body)
    if page_count > max_pages():
        raise HTTPException(status_code=413, detail="PDF page count exceeds the configured limit.")

    with tempfile.TemporaryDirectory(dir=tmp_root()) as directory:
        request_dir = Path(directory)
        pdf_path = request_dir / safe_file_name(file_name)
        output_dir = request_dir / "out"
        output_dir.mkdir()
        pdf_path.write_bytes(body)
        try:
            parsed = run_opendataloader(
                pdf_path=pdf_path,
                output_dir=output_dir,
                timeout_seconds=parser_timeout_seconds(),
            )
        except ParserTimeout as exc:
            raise HTTPException(status_code=504, detail="PDF extraction timed out.") from exc
        except ParserError as exc:
            raise HTTPException(status_code=422, detail="PDF extraction failed.") from exc

    elapsed_ms = int((time.monotonic() - started) * 1000)
    response = build_response(
        parsed=parsed,
        source_id=source_id,
        file_name=file_name,
        checksum=checksum,
        fallback_page_count=page_count,
        elapsed_ms=elapsed_ms,
    )
    if len(response.model_dump_json().encode("utf-8")) > max_response_bytes():
        raise HTTPException(status_code=502, detail="PDF parser response exceeds the size limit.")
    return response


def validate_pdf_upload(body: bytes, file_name: str, content_type: str | None) -> None:
    if len(body) > max_file_bytes():
        raise HTTPException(status_code=413, detail="PDF file exceeds the configured size limit.")
    if not body.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported.")
    if not file_name.lower().endswith(".pdf") and content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported.")


def build_response(
    parsed: OpenDataLoaderOutput,
    source_id: str,
    file_name: str,
    checksum: str,
    fallback_page_count: int,
    elapsed_ms: int,
) -> PdfExtractionResponse:
    document = parsed.document_json
    chunks, page_map = extract_chunks_and_page_map(document)
    text = normalize_whitespace(
        "\n".join(chunk.content for chunk in chunks) or parsed.markdown,
    )
    page_count = int_value(document, "number of pages") or fallback_page_count
    warnings = ["weak_ocr"] if page_count > 0 and not chunks else []
    parser_report: dict[str, object] = {
        "checksum": checksum,
        "file_name": file_name,
        "markdown_sha256": sha256_text(parsed.markdown),
        "json_sha256": sha256_text(stable_document_summary(document)),
        "ocr_mode": "disabled",
        "source_id": source_id,
    }
    return PdfExtractionResponse(
        text=text,
        chunks=chunks,
        language=detect_language(text),
        warnings=warnings,
        metadata=PdfExtractionMetadata(
            parser_version=opendataloader_version(),
            page_count=page_count,
            element_count=count_elements(document),
            elapsed_ms=elapsed_ms,
            opendataloader_options=parsed.options,
        ),
        artifacts=PdfExtractionArtifacts.model_validate(
            {
                "json": document,
                "markdown": parsed.markdown,
                "page_map": page_map,
                "parser_report": parser_report,
            }
        ),
    )


def extract_chunks_and_page_map(
    document: Mapping[str, object],
) -> tuple[list[PdfChunk], list[dict[str, object]]]:
    chunks: list[PdfChunk] = []
    page_map: list[dict[str, object]] = []
    for child in sequence(document.get("kids")):
        collect_node(child, [], chunks, page_map)
    return chunks, page_map


def collect_node(
    node: object,
    section_stack: list[str],
    chunks: list[PdfChunk],
    page_map: list[dict[str, object]],
) -> None:
    if not isinstance(node, Mapping):
        return
    node_type = string_value(node, "type") or "element"
    content = node_content(node)
    page_number = int_value(node, "page number") or int_value(node, "page_number")
    element_id = string_value(node, "id")
    current_stack = section_stack
    if node_type.lower() in {"heading", "title"} and content:
        current_stack = [*section_stack, content]

    if content:
        section_path = " > ".join(current_stack) if current_stack else None
        chunk = PdfChunk(
            content=content,
            language=detect_language(content),
            page_number=page_number,
            row_range=string_value(node, "row_range"),
            search_text=content,
            section_path=section_path,
        )
        chunks.append(chunk)
        page_map.append(
            {
                "element_id": element_id,
                "type": node_type,
                "page_number": page_number,
                "section_path": section_path,
                "bounding_box": node.get("bounding box") or node.get("bounding_box"),
                "chunk_index": len(chunks) - 1,
            }
        )

    for child in sequence(node.get("kids")):
        collect_node(child, current_stack, chunks, page_map)


def node_content(node: Mapping[str, object]) -> str:
    for key in ("content", "text", "markdown"):
        value = node.get(key)
        if isinstance(value, str):
            return normalize_whitespace(value)
    if string_value(node, "type") == "table":
        return render_table(node)
    return ""


def render_table(node: Mapping[str, object]) -> str:
    rows = sequence(node.get("rows"))
    rendered_rows: list[str] = []
    for row in rows:
        cells = sequence(row.get("cells") if isinstance(row, Mapping) else None)
        values = [
            normalize_whitespace(str(cell.get("content", "")))
            for cell in cells
            if isinstance(cell, Mapping)
        ]
        if values:
            rendered_rows.append(" | ".join(values))
    return "\n".join(rendered_rows)


def count_elements(node: object) -> int:
    if not isinstance(node, Mapping):
        return 0
    return 1 + sum(count_elements(child) for child in sequence(node.get("kids")))


def count_pdf_pages(body: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page\b", body)) or 1


def sequence(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def string_value(mapping: Mapping[str, object], key: str) -> str | None:
    value = mapping.get(key)
    return value if isinstance(value, str) and value else None


def int_value(mapping: Mapping[str, object], key: str) -> int | None:
    value = mapping.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def max_file_bytes() -> int:
    return positive_int_env("KNOWLEDGE_PDF_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES)


def max_pages() -> int:
    return positive_int_env("KNOWLEDGE_PDF_MAX_PAGES", DEFAULT_MAX_PAGES)


def parser_timeout_seconds() -> float:
    value = positive_int_env(
        "KNOWLEDGE_PDF_PARSER_TIMEOUT_MS",
        DEFAULT_TIMEOUT_SECONDS * 1000,
    )
    return value / 1000


def max_response_bytes() -> int:
    return positive_int_env("KNOWLEDGE_PDF_PARSER_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES)


def positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        value = 0
    return value if value > 0 else default


def tmp_root() -> str | None:
    value = os.environ.get("KNOWLEDGE_PDF_PARSER_TMPDIR", "").strip()
    if not value:
        return None
    Path(value).mkdir(parents=True, exist_ok=True)
    return value


def safe_file_name(file_name: str) -> str:
    base = Path(file_name).name
    return base if base.lower().endswith(".pdf") else f"{base}.pdf"


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def detect_language(text: str) -> str | None:
    lowered = text.lower()
    croatian_terms = ("hrvatski", "korpuse", "znanja", "pravilnik", "odobrav")
    if any(term in lowered for term in croatian_terms):
        return "hr"
    return "en" if text else None


def sha256_text(text: str) -> str:
    return f"sha256:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"


def stable_document_summary(document: Mapping[str, object]) -> str:
    return str(sorted(document.keys()))


def opendataloader_version() -> str:
    try:
        return version("opendataloader-pdf")
    except PackageNotFoundError:
        return "unknown"


app.get("/livez", response_model=HealthResponse)(healthz)
app.get("/healthz", response_model=HealthResponse)(healthz)
app.get("/health", response_model=HealthResponse)(healthz)
