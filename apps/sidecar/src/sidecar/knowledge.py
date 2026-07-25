import base64
import binascii
import csv
import hmac
import html
import importlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from collections.abc import Callable
from types import ModuleType
from typing import Literal, cast

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/v1/knowledge", tags=["knowledge"])

SERVICE_TOKEN_HEADER = "X-LLM-Machines-Sidecar-Token"
MAX_DECODED_BYTES = 50 * 1024 * 1024
MAX_BASE64_LENGTH = ((MAX_DECODED_BYTES + 2) // 3) * 4
MAX_PAGE_UNITS = 250
ESTIMATED_PAGE_CHARS = 3000
MAX_ZIP_MEMBERS = 256
MAX_ZIP_MEMBER_BYTES = 5 * 1024 * 1024
MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 20 * 1024 * 1024

BLOCKED_UPLOAD_EXTENSIONS = {"zip", "doc", "ppt", "xls"}
BLOCKED_UPLOAD_MIME_TYPES = {
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-ole-storage",
}

ALLOWED_UPLOAD_FORMATS: dict[str, set[str]] = {
    "bmp": {"image/bmp"},
    "csv": {"application/csv", "text/csv"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "eml": {"message/rfc822", "text/plain"},
    "epub": {"application/epub+zip"},
    "html": {"application/xhtml+xml", "text/html"},
    "jpeg": {"image/jpeg"},
    "jpg": {"image/jpeg"},
    "json": {"application/json", "text/json", "text/plain"},
    "jsonl": {"application/jsonl", "application/x-ndjson", "text/plain"},
    "md": {"text/markdown", "text/plain", "text/x-markdown"},
    "msg": {"application/vnd.ms-outlook", "application/octet-stream"},
    "odp": {"application/vnd.oasis.opendocument.presentation"},
    "ods": {"application/vnd.oasis.opendocument.spreadsheet"},
    "odt": {"application/vnd.oasis.opendocument.text"},
    "pdf": {"application/pdf"},
    "png": {"image/png"},
    "pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    "rtf": {"application/rtf", "text/rtf"},
    "tif": {"image/tiff"},
    "tiff": {"image/tiff"},
    "tsv": {"text/tab-separated-values", "text/tsv"},
    "txt": {"text/plain"},
    "webp": {"image/webp"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    "xml": {"application/xml", "text/xml"},
    "yaml": {"application/x-yaml", "text/plain", "text/yaml"},
    "yml": {"application/x-yaml", "text/plain", "text/yaml"},
}

TABLE_EXTENSIONS = {"csv", "json", "jsonl", "ods", "tsv", "xlsx", "xml", "yaml", "yml"}
STRUCTURED_EXTENSIONS = {"json", "jsonl", "xml", "yaml", "yml"}
IMAGE_EXTENSIONS = {"bmp", "jpeg", "jpg", "png", "tif", "tiff", "webp"}
TEXT_FALLBACK_EXTENSIONS = {
    "eml",
    "epub",
    "html",
    "json",
    "jsonl",
    "md",
    "msg",
    "odt",
    "odp",
    "rtf",
    "txt",
    "xml",
    "yaml",
    "yml",
}


class KnowledgeExtractionRequest(BaseModel):
    source_type: Literal["file", "url", "image", "table"]
    file_name: str = Field(min_length=1, max_length=240)
    mime_type: str = Field(min_length=1, max_length=160)
    content_base64: str = Field(min_length=1, max_length=MAX_BASE64_LENGTH)
    original_uri: str | None = None


class KnowledgeChunk(BaseModel):
    content: str
    search_text: str
    language: str | None = None
    page_number: int | None = None
    section_path: str | None = None
    row_range: str | None = None
    image_region: str | None = None


class KnowledgeExtractionResponse(BaseModel):
    text: str
    chunks: list[KnowledgeChunk]
    language: str | None = None
    warnings: list[str]
    metadata: dict[str, object]
    artifacts: dict[str, object] = Field(default_factory=dict)


class ParserRoute(BaseModel):
    declared_mime: str
    detected_type: str
    extension: str
    fallback_parser: str | None
    license_status: str
    parser_priority: int
    mismatch_flags: list[str]
    selected_parser: str
    source_type: Literal["file", "url", "image", "table"]


class ParserProfile(BaseModel):
    profile_id: str
    supported_extensions: set[str]
    source_types: set[str]
    supported_mime_types: set[str]
    license_status: str
    priority: int
    max_bytes: int
    max_page_units: int
    fallback_eligible: bool
    fallback_parser: str | None


PARSER_REGISTRY: tuple[ParserProfile, ...] = (
    ParserProfile(
        profile_id="trafilatura_html",
        supported_extensions={"html"},
        source_types=set(),
        supported_mime_types={"text/html"},
        license_status="Apache-2.0",
        priority=10,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_html_text",
    ),
    ParserProfile(
        profile_id="native_structured_data_pending",
        supported_extensions=STRUCTURED_EXTENSIONS,
        source_types=set(),
        supported_mime_types=set().union(
            *(ALLOWED_UPLOAD_FORMATS[ext] for ext in STRUCTURED_EXTENSIONS)
        ),
        license_status="stdlib native parser",
        priority=15,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_structured_text",
    ),
    ParserProfile(
        profile_id="duckdb_table_pending",
        supported_extensions=TABLE_EXTENSIONS - STRUCTURED_EXTENSIONS,
        source_types=set(),
        supported_mime_types=set().union(
            *(ALLOWED_UPLOAD_FORMATS[ext] for ext in TABLE_EXTENSIONS)
        ),
        license_status="MIT pending dependency",
        priority=20,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_table_text",
    ),
    ParserProfile(
        profile_id="tesseract_ocr_pending",
        supported_extensions=IMAGE_EXTENSIONS,
        source_types=set(),
        supported_mime_types=set().union(
            *(ALLOWED_UPLOAD_FORMATS[ext] for ext in IMAGE_EXTENSIONS)
        ),
        license_status="Apache-2.0 pending dependency",
        priority=30,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="fixture_text_ocr",
    ),
    ParserProfile(
        profile_id="docling_pdf_pending",
        supported_extensions={"pdf"},
        source_types=set(),
        supported_mime_types=ALLOWED_UPLOAD_FORMATS["pdf"],
        license_status="MIT pending dependency",
        priority=40,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_pdf_literal_text",
    ),
    ParserProfile(
        profile_id="docling_docx_pending",
        supported_extensions={"docx"},
        source_types=set(),
        supported_mime_types=ALLOWED_UPLOAD_FORMATS["docx"],
        license_status="MIT pending dependency",
        priority=50,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_docx_zip_text",
    ),
    ParserProfile(
        profile_id="docling_pptx_pending",
        supported_extensions={"pptx"},
        source_types=set(),
        supported_mime_types=ALLOWED_UPLOAD_FORMATS["pptx"],
        license_status="MIT pending dependency",
        priority=60,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_pptx_zip_text",
    ),
    ParserProfile(
        profile_id="opendocument_pending",
        supported_extensions={"odp", "ods", "odt"},
        source_types=set(),
        supported_mime_types=set().union(
            *(ALLOWED_UPLOAD_FORMATS[ext] for ext in {"odp", "ods", "odt"})
        ),
        license_status="MIT/Apache-compatible local fallback pending broad parser",
        priority=70,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_opendocument_text",
    ),
    ParserProfile(
        profile_id="unstructured_markitdown_fallback_pending",
        supported_extensions=TEXT_FALLBACK_EXTENSIONS,
        source_types=set(),
        supported_mime_types=set().union(
            *(ALLOWED_UPLOAD_FORMATS[ext] for ext in TEXT_FALLBACK_EXTENSIONS)
        ),
        license_status="Apache-2.0/MIT pending dependency",
        priority=90,
        max_bytes=MAX_DECODED_BYTES,
        max_page_units=MAX_PAGE_UNITS,
        fallback_eligible=True,
        fallback_parser="local_text_family",
    ),
)


def require_sidecar_service_token(
    x_llm_machines_sidecar_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", "").strip()
    if (
        not expected
        or not x_llm_machines_sidecar_token
        or not hmac.compare_digest(x_llm_machines_sidecar_token, expected)
    ):
        raise HTTPException(status_code=401, detail="Sidecar service token is required.")


@router.post("/extract", response_model=KnowledgeExtractionResponse)
def extract_knowledge_source(
    request: KnowledgeExtractionRequest,
    _auth: None = Depends(require_sidecar_service_token),
) -> KnowledgeExtractionResponse:
    started_at = time.perf_counter()
    raw = decode_request_content(request.content_base64)
    text = decode_text(raw)
    route = route_request(request, raw)

    if route.selected_parser == "trafilatura_html":
        response = extract_html(text, request.original_uri)
    elif route.selected_parser == "native_structured_data_pending":
        response = extract_structured_data(text, route.extension)
    elif route.selected_parser == "duckdb_table_pending":
        response = extract_table(raw, text, request.file_name.lower())
    elif route.selected_parser == "tesseract_ocr_pending":
        response = extract_image_text(raw, text, route.extension)
    elif route.selected_parser == "docling_pdf_pending":
        response = extract_pdf(raw, text)
    elif route.selected_parser == "docling_docx_pending":
        response = extract_docx(raw, text)
    elif route.selected_parser == "docling_pptx_pending":
        response = extract_pptx(raw, text)
    elif route.selected_parser == "opendocument_pending":
        response = extract_opendocument(raw, text, route.extension)
    elif route.selected_parser == "unstructured_markitdown_fallback_pending":
        response = extract_text_family(raw, text, route.extension)
    else:
        response = extract_text_pages(text, warning=None)

    return finalize_response(response, route, raw, started_at)


def route_request(request: KnowledgeExtractionRequest, raw: bytes) -> ParserRoute:
    extension = extension_for_file_name(request.file_name)
    declared_mime = request.mime_type.strip().lower()
    detected_type = detect_content_type(raw, extension)
    mismatch_flags: list[str] = []

    if not extension:
        raise HTTPException(status_code=415, detail="Knowledge source must include an extension.")
    if extension in BLOCKED_UPLOAD_EXTENSIONS or declared_mime in BLOCKED_UPLOAD_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Knowledge source format is blocked.")
    if extension not in ALLOWED_UPLOAD_FORMATS:
        raise HTTPException(status_code=415, detail="Knowledge source format is not supported.")
    if declared_mime not in ALLOWED_UPLOAD_FORMATS[extension]:
        raise HTTPException(
            status_code=415,
            detail="Knowledge source MIME type does not match the allowed format.",
        )

    if detected_type != "unknown" and detected_type != extension:
        mismatch_flags.append(f"detected_{detected_type}_for_{extension}")
        raise HTTPException(
            status_code=415,
            detail="Knowledge source detected content type does not match the allowed format.",
        )

    profile = select_parser_profile(request.source_type, extension, declared_mime)

    return ParserRoute(
        declared_mime=declared_mime,
        detected_type=detected_type,
        extension=extension,
        fallback_parser=profile.fallback_parser,
        license_status=profile.license_status,
        parser_priority=profile.priority,
        mismatch_flags=mismatch_flags,
        selected_parser=profile.profile_id,
        source_type=request.source_type,
    )


def select_parser_profile(
    source_type: Literal["file", "url", "image", "table"],
    extension: str,
    declared_mime: str,
) -> ParserProfile:
    matching_profiles = [
        profile
        for profile in PARSER_REGISTRY
        if extension in profile.supported_extensions
        and declared_mime in profile.supported_mime_types
        and (not profile.source_types or source_type in profile.source_types)
    ]
    if not matching_profiles:
        raise HTTPException(status_code=415, detail="No approved parser profile is available.")
    return sorted(matching_profiles, key=lambda profile: profile.priority)[0]


def finalize_response(
    response: KnowledgeExtractionResponse,
    route: ParserRoute,
    raw: bytes,
    started_at: float,
) -> KnowledgeExtractionResponse:
    page_units = page_units_for(route, response.text, raw)
    if page_units > MAX_PAGE_UNITS:
        raise HTTPException(
            status_code=413,
            detail=f"Knowledge source exceeds the {MAX_PAGE_UNITS} page-unit limit.",
        )

    quality_warnings = [*route.mismatch_flags, *response.warnings]
    duration_ms = int((time.perf_counter() - started_at) * 1000)
    parser_report: dict[str, object] = {
        "bytes": len(raw),
        "chunksCreated": len(response.chunks),
        "citationsCreated": citation_count(response.chunks),
        "detectedType": route.detected_type,
        "durationMs": duration_ms,
        "fallbackParser": route.fallback_parser,
        "licenseBoundary": "MIT/Apache/BSD/MPL-2.0 only; GPL/AGPL paths disabled",
        "licenseStatus": route.license_status,
        "pageUnits": page_units,
        "parserPriority": route.parser_priority,
        "registryProfile": route.selected_parser,
        "qualityScore": quality_score(response, quality_warnings),
        "qualityWarnings": quality_warnings,
        "selectedParser": route.selected_parser,
    }
    metadata = {
        **response.metadata,
        "detected_type": route.detected_type,
        "fallback_parser": route.fallback_parser,
        "mismatch_flags": route.mismatch_flags,
        "page_units": page_units,
        "parser_report": parser_report,
        "selected_parser": route.selected_parser,
    }
    artifacts = {
        **response.artifacts,
        "parser_report": parser_report,
    }
    return KnowledgeExtractionResponse(
        text=response.text,
        chunks=response.chunks,
        language=response.language,
        warnings=quality_warnings,
        metadata=metadata,
        artifacts=artifacts,
    )


def extension_for_file_name(file_name: str) -> str | None:
    match = re.search(r"\.([a-z0-9]+)$", file_name.strip(), flags=re.IGNORECASE)
    return match.group(1).lower() if match else None


def detect_content_type(raw: bytes, extension: str | None) -> str:
    prefix = raw[:512].lstrip()
    lower_prefix = prefix.lower()
    if prefix.startswith(b"%PDF"):
        return "pdf"
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if prefix.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if prefix.startswith((b"II*\x00", b"MM\x00*")):
        return "tiff"
    if prefix.startswith(b"RIFF") and b"WEBP" in prefix[:16]:
        return "webp"
    if prefix.startswith(b"PK\x03\x04"):
        return (
            extension
            if extension in {"docx", "epub", "odp", "ods", "odt", "pptx", "xlsx"}
            else "zip"
        )
    if lower_prefix.startswith((b"<!doctype html", b"<html")):
        return "html"
    if lower_prefix.startswith(b"{\\rtf"):
        return "rtf"
    if lower_prefix.startswith((b"{", b"[")):
        return "jsonl" if extension == "jsonl" else "json"
    if extension in {"csv", "md", "txt", "tsv", "yaml", "yml"}:
        return extension
    return "unknown"


def page_units_for(route: ParserRoute, text: str, raw: bytes) -> int:
    if route.extension == "pdf":
        return max(count_pdf_pages(raw), estimated_text_pages(text))
    if route.extension in {"pptx", "odp"}:
        return max(count_deck_slides(raw, route.extension), 1 if text else 0)
    if route.extension in IMAGE_EXTENSIONS:
        return 1
    if route.extension in TABLE_EXTENSIONS:
        return 1 if raw else 0
    return estimated_text_pages(text)


def estimated_text_pages(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text) + ESTIMATED_PAGE_CHARS - 1) // ESTIMATED_PAGE_CHARS)


def count_pdf_pages(raw: bytes) -> int:
    decoded = raw.decode("latin-1", errors="ignore")
    if not decoded.startswith("%PDF"):
        return 0
    return max(len(re.findall(r"/Type\s*/Page\b", decoded)), 1)


def count_deck_slides(raw: bytes, extension: str) -> int:
    if not zipfile.is_zipfile(io.BytesIO(raw)):
        return 0
    prefix = "ppt/slides/slide" if extension == "pptx" else "Pictures/"
    with open_safe_zip(raw) as deck:
        if extension == "pptx":
            return len(
                [
                    name
                    for name in deck.namelist()
                    if name.startswith(prefix) and name.endswith(".xml")
                ]
            )
        try:
            manifest = deck.read("content.xml")
        except KeyError:
            return 0
    return manifest.decode("utf-8", errors="ignore").count("<draw:page")


def citation_count(chunks: list[KnowledgeChunk]) -> int:
    return sum(
        1
        for chunk in chunks
        if chunk.page_number or chunk.section_path or chunk.row_range or chunk.image_region
    )


def quality_score(response: KnowledgeExtractionResponse, warnings: list[str]) -> float:
    if not response.text or not response.chunks:
        return 0.0
    return max(0.1, 1.0 - (0.15 * len(warnings)))


def extract_html(text: str, original_uri: str | None) -> KnowledgeExtractionResponse:
    canonical = extract_canonical(text)
    title = extract_title(text)
    headings = extract_headings(text)
    body, parser, warnings = extract_html_body(text, original_uri)
    language = detect_language(body)
    chunk = KnowledgeChunk(
        content=body,
        search_text=body,
        language=language,
        section_path=headings[0] if headings else title or "html.body",
    )
    return KnowledgeExtractionResponse(
        text=body,
        chunks=[chunk] if body else [],
        language=language,
        warnings=warnings,
        metadata={
            "canonical_uri": canonical,
            "final_uri": original_uri,
            "headings": headings,
            "parser": parser,
            "redirect_chain": [],
            "title": title,
        },
    )


def extract_html_body(text: str, original_uri: str | None) -> tuple[str, str, list[str]]:
    extracted = extract_with_trafilatura(text, original_uri)
    if extracted:
        return extracted, "trafilatura", []

    fallback = strip_html_boilerplate(text)
    warning = "trafilatura_unavailable" if trafilatura_module() is None else "trafilatura_empty"
    return fallback, "local_html_text", [warning]


def extract_with_trafilatura(text: str, original_uri: str | None) -> str:
    module = trafilatura_module()
    if module is None:
        return ""
    extractor = cast(Callable[..., str | None], getattr(module, "extract"))
    extracted = extractor(
        remove_html_boilerplate_elements(text),
        include_comments=False,
        output_format="txt",
        url=original_uri,
    )
    return normalize_whitespace(extracted or "")


def trafilatura_module() -> ModuleType | None:
    try:
        module = importlib.import_module("trafilatura")
    except ImportError:
        return None
    if not hasattr(module, "extract"):
        return None
    return module


def extract_table(raw: bytes, text: str, file_name: str) -> KnowledgeExtractionResponse:
    if file_name.endswith(".xlsx") and zipfile.is_zipfile(io.BytesIO(raw)):
        return extract_xlsx(raw)
    if file_name.endswith(".ods") and zipfile.is_zipfile(io.BytesIO(raw)):
        return extract_ods(raw)

    delimiter = "\t" if file_name.endswith(".tsv") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    return build_table_response(
        rows,
        parser="xlsx_text_fallback" if file_name.endswith(".xlsx") else "delimited_text",
    )


def extract_xlsx(raw: bytes) -> KnowledgeExtractionResponse:
    with open_safe_zip(raw) as workbook:
        shared_strings = read_shared_strings(workbook)
        sheet_name = next(
            (name for name in workbook.namelist() if name.startswith("xl/worksheets/sheet")),
            None,
        )
        if not sheet_name:
            return KnowledgeExtractionResponse(
                text="",
                chunks=[],
                language=None,
                warnings=["empty_xlsx"],
                metadata={"parser": "xlsx_zip", "row_count": 0},
            )
        sheet_xml = workbook.read(sheet_name)
        reject_unsafe_xml(sheet_xml)
        root = ET.fromstring(sheet_xml)

    rows: list[list[str]] = []
    for row in root.findall(".//{*}row"):
        values: list[str] = []
        for cell in row.findall("{*}c"):
            value = cell.find("{*}v")
            raw_value = value.text if value is not None and value.text else ""
            if cell.attrib.get("t") == "s" and raw_value.isdigit():
                values.append(shared_strings[int(raw_value)])
            else:
                values.append(raw_value)
        rows.append(values)

    return build_table_response(rows, parser="xlsx_zip", sheet_names=[sheet_name])


def extract_ods(raw: bytes) -> KnowledgeExtractionResponse:
    with open_safe_zip(raw) as document:
        try:
            content_xml = document.read("content.xml")
        except KeyError:
            return KnowledgeExtractionResponse(
                text="",
                chunks=[],
                language=None,
                warnings=["empty_ods"],
                metadata={"parser": "ods_zip", "row_count": 0, "sheet_names": []},
            )
    reject_unsafe_xml(content_xml)
    root = ET.fromstring(content_xml)
    table = root.find(".//{*}table")
    if table is None:
        return KnowledgeExtractionResponse(
            text="",
            chunks=[],
            language=None,
            warnings=["empty_ods"],
            metadata={"parser": "ods_zip", "row_count": 0, "sheet_names": []},
        )

    sheet_name = (
        table.attrib.get("{urn:oasis:names:tc:opendocument:xmlns:table:1.0}name") or "sheet1"
    )
    rows: list[list[str]] = []
    for row in table.findall("{*}table-row"):
        values: list[str] = []
        for cell in row.findall("{*}table-cell"):
            text_value = normalize_whitespace(
                " ".join(node.text or "" for node in cell.findall(".//{*}p") if node.text)
            )
            values.append(text_value)
        if any(values):
            rows.append(values)
    return build_table_response(rows, parser="ods_zip", sheet_names=[sheet_name])


def extract_structured_data(text: str, extension: str) -> KnowledgeExtractionResponse:
    if extension == "json":
        return extract_json_structured(text)
    if extension == "jsonl":
        return extract_jsonl_structured(text)
    if extension == "xml":
        return extract_xml_structured(text)
    if extension in {"yaml", "yml"}:
        return extract_yaml_structured(text)
    return extract_text_pages(
        text, warning=None, metadata={"parser": f"{extension}_structured_text"}
    )


def extract_json_structured(text: str) -> KnowledgeExtractionResponse:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return extract_text_pages(
            text, warning="json_parse_error", metadata={"parser": "json_text"}
        )

    chunks = [
        KnowledgeChunk(
            content=f"{path}: {json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else value}",
            search_text=f"{path} {value}",
            language=detect_language(str(value)),
            section_path=path,
        )
        for path, value in flatten_json(payload)
    ]
    output = "\n".join(chunk.content for chunk in chunks)
    return KnowledgeExtractionResponse(
        text=output,
        chunks=chunks,
        language=detect_language(output),
        warnings=[],
        metadata={"parser": "json_structured", "path_count": len(chunks)},
    )


def extract_jsonl_structured(text: str) -> KnowledgeExtractionResponse:
    chunks: list[KnowledgeChunk] = []
    warnings: list[str] = []
    for index, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
            rendered = "; ".join(
                f"{path}: {value}" for path, value in flatten_json(payload, f"record[{index}]")
            )
        except json.JSONDecodeError:
            warnings.append("jsonl_parse_error")
            rendered = normalize_whitespace(line)
        chunks.append(
            KnowledgeChunk(
                content=rendered,
                search_text=rendered,
                language=detect_language(rendered),
                row_range=str(index),
                section_path=f"record[{index}]",
            )
        )
    output = "\n".join(chunk.content for chunk in chunks)
    return KnowledgeExtractionResponse(
        text=output,
        chunks=chunks,
        language=detect_language(output),
        warnings=sorted(set(warnings)),
        metadata={"parser": "jsonl_structured", "record_count": len(chunks)},
    )


def extract_xml_structured(text: str) -> KnowledgeExtractionResponse:
    raw = text.encode("utf-8")
    reject_unsafe_xml(raw)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return extract_text_pages(text, warning="xml_parse_error", metadata={"parser": "xml_text"})

    paths = flatten_xml(root)
    chunks = [
        KnowledgeChunk(
            content=f"{path}: {value}",
            search_text=f"{path} {value}",
            language=detect_language(value),
            section_path=path,
        )
        for path, value in paths
    ]
    output = "\n".join(chunk.content for chunk in chunks)
    return KnowledgeExtractionResponse(
        text=output,
        chunks=chunks,
        language=detect_language(output),
        warnings=[],
        metadata={"parser": "xml_structured", "path_count": len(chunks)},
    )


def extract_yaml_structured(text: str) -> KnowledgeExtractionResponse:
    chunks: list[KnowledgeChunk] = []
    key_stack: list[tuple[int, str]] = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$", line)
        if not match:
            continue
        indent = len(match.group(1))
        key = match.group(2)
        value = match.group(3).strip()
        key_stack = [(level, name) for level, name in key_stack if level < indent]
        key_stack.append((indent, key))
        path = "$." + ".".join(name for _, name in key_stack)
        if value:
            chunks.append(
                KnowledgeChunk(
                    content=f"{path}: {value}",
                    search_text=f"{path} {value}",
                    language=detect_language(value),
                    section_path=path,
                )
            )
    output = "\n".join(chunk.content for chunk in chunks)
    return KnowledgeExtractionResponse(
        text=output,
        chunks=chunks,
        language=detect_language(output),
        warnings=[] if chunks else ["yaml_no_scalar_values"],
        metadata={"parser": "yaml_structured", "path_count": len(chunks)},
    )


def flatten_json(payload: object, prefix: str = "$") -> list[tuple[str, object]]:
    if isinstance(payload, dict):
        flattened: list[tuple[str, object]] = []
        for key, value in payload.items():
            flattened.extend(flatten_json(value, f"{prefix}.{key}"))
        return flattened
    if isinstance(payload, list):
        flattened = []
        for index, value in enumerate(payload):
            flattened.extend(flatten_json(value, f"{prefix}[{index}]"))
        return flattened
    return [(prefix, payload)]


def flatten_xml(root: ET.Element, prefix: str = "$") -> list[tuple[str, str]]:
    tag = root.tag.split("}", maxsplit=1)[-1]
    path = f"{prefix}.{tag}"
    values: list[tuple[str, str]] = []
    text = normalize_whitespace(root.text or "")
    if text:
        values.append((path, text))
    for child in list(root):
        values.extend(flatten_xml(child, path))
    return values


def extract_image_text(
    raw: bytes, fallback_text: str, extension: str
) -> KnowledgeExtractionResponse:
    tesseract_text, tesseract_warning = run_tesseract_ocr(raw, extension)
    extracted = normalize_whitespace(tesseract_text or fallback_text)
    warnings: list[str] = []
    if tesseract_warning:
        warnings.append(tesseract_warning)
    if not extracted:
        warnings.append("weak_ocr")
    chunk = KnowledgeChunk(
        content=extracted,
        search_text=extracted,
        language=detect_language(extracted) if extracted else None,
        image_region="full-image",
    )
    return KnowledgeExtractionResponse(
        text=extracted,
        chunks=[chunk] if extracted else [],
        language=chunk.language,
        warnings=warnings,
        metadata={
            "ocr_engine": "tesseract",
            "ocr_mode": "tesseract" if tesseract_text else "fixture_text_fallback",
            "pixel_reasoning": False,
        },
    )


def run_tesseract_ocr(raw: bytes, extension: str) -> tuple[str, str | None]:
    binary = shutil.which("tesseract")
    if not binary:
        return "", "tesseract_unavailable"

    suffix = f".{extension if extension != 'jpg' else 'jpeg'}"
    with tempfile.NamedTemporaryFile(suffix=suffix) as image_file:
        image_file.write(raw)
        image_file.flush()
        try:
            result = subprocess.run(
                [binary, image_file.name, "stdout", "--psm", "6"],
                check=False,
                capture_output=True,
                text=True,
                timeout=15,
            )
        except subprocess.TimeoutExpired:
            return "", "tesseract_timeout"

    if result.returncode != 0:
        return "", "tesseract_failed"
    return normalize_whitespace(result.stdout), None


def extract_pdf(raw: bytes, fallback_text: str) -> KnowledgeExtractionResponse:
    extracted = extract_pdf_text(raw)
    text = extracted or fallback_text
    return extract_text_pages(
        text,
        warning=None if extracted or fallback_text else "empty_pdf",
        metadata={"parser": "pdf_text"},
    )


def extract_docx(raw: bytes, fallback_text: str) -> KnowledgeExtractionResponse:
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with open_safe_zip(raw) as document:
            try:
                xml = document.read("word/document.xml")
            except KeyError:
                xml = b""
        if xml:
            reject_unsafe_xml(xml)
            root = ET.fromstring(xml)
            text = "\n".join(node.text or "" for node in root.findall(".//{*}t") if node.text)
            return extract_text_pages(text, warning=None, metadata={"parser": "docx_zip"})

    return extract_text_pages(
        fallback_text,
        warning=None if fallback_text else "empty_docx",
        metadata={"parser": "docx_text_fallback"},
    )


def extract_pptx(raw: bytes, fallback_text: str) -> KnowledgeExtractionResponse:
    if zipfile.is_zipfile(io.BytesIO(raw)):
        slide_text: list[tuple[int, str]] = []
        with open_safe_zip(raw) as deck:
            slide_names = sorted(
                [
                    name
                    for name in deck.namelist()
                    if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                ],
                key=slide_sort_key,
            )
            for index, name in enumerate(slide_names, start=1):
                xml = deck.read(name)
                reject_unsafe_xml(xml)
                root = ET.fromstring(xml)
                text = normalize_whitespace(
                    " ".join(node.text or "" for node in root.findall(".//{*}t") if node.text)
                )
                if text:
                    slide_text.append((index, text))
        if slide_text:
            chunks = [
                KnowledgeChunk(
                    content=text,
                    search_text=text,
                    language=detect_language(text),
                    page_number=index,
                    section_path=f"slide.{index}",
                )
                for index, text in slide_text
            ]
            full_text = "\n".join(text for _, text in slide_text)
            return KnowledgeExtractionResponse(
                text=full_text,
                chunks=chunks,
                language=detect_language(full_text),
                warnings=[],
                metadata={"parser": "pptx_zip", "slide_count": len(slide_text)},
            )

    return extract_text_pages(
        fallback_text,
        warning=None if fallback_text else "empty_pptx",
        metadata={"parser": "pptx_text_fallback"},
    )


def slide_sort_key(name: str) -> int:
    match = re.search(r"slide(\d+)\.xml$", name)
    return int(match.group(1)) if match else 0


def extract_opendocument(
    raw: bytes,
    fallback_text: str,
    extension: str,
) -> KnowledgeExtractionResponse:
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with open_safe_zip(raw) as document:
            try:
                xml = document.read("content.xml")
            except KeyError:
                xml = b""
        if xml:
            reject_unsafe_xml(xml)
            root = ET.fromstring(xml)
            text = normalize_whitespace(
                " ".join(node.text or "" for node in root.iter() if node.text)
            )
            return extract_text_pages(
                text,
                warning=None,
                metadata={"parser": f"{extension}_opendocument_zip"},
            )

    return extract_text_pages(
        fallback_text,
        warning=None if fallback_text else f"empty_{extension}",
        metadata={"parser": f"{extension}_text_fallback"},
    )


def extract_text_family(
    raw: bytes,
    fallback_text: str,
    extension: str,
) -> KnowledgeExtractionResponse:
    if extension == "rtf":
        text = re.sub(r"\\[a-z]+-?\d* ?", " ", fallback_text)
        text = text.replace("{", " ").replace("}", " ")
        return extract_text_pages(text, warning=None, metadata={"parser": "rtf_text"})
    if extension == "epub" and zipfile.is_zipfile(io.BytesIO(raw)):
        with open_safe_zip(raw) as book:
            html_parts = [
                book.read(name).decode("utf-8", errors="ignore")
                for name in book.namelist()
                if name.endswith((".html", ".xhtml", ".htm"))
            ]
        return extract_text_pages(
            normalize_whitespace(" ".join(strip_html(part) for part in html_parts)),
            warning=None if html_parts else "empty_epub",
            metadata={"parser": "epub_zip_html"},
        )
    if extension in {"html", "xml"}:
        return extract_text_pages(
            strip_html(fallback_text), warning=None, metadata={"parser": f"{extension}_text"}
        )
    if extension == "md":
        return extract_markdown(fallback_text)
    return extract_text_pages(
        fallback_text,
        warning=None if fallback_text else f"empty_{extension}",
        metadata={"parser": f"{extension}_text"},
    )


def extract_markdown(text: str) -> KnowledgeExtractionResponse:
    sections: list[tuple[str, list[str]]] = []
    current_heading = "markdown.body"
    current_lines: list[str] = []
    for line in text.splitlines():
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            if current_lines:
                sections.append((current_heading, current_lines))
            current_heading = normalize_whitespace(heading_match.group(2))
            current_lines = [line]
        else:
            current_lines.append(line)
    if current_lines:
        sections.append((current_heading, current_lines))

    chunks = []
    for heading, lines in sections:
        content = normalize_whitespace("\n".join(lines))
        if not content:
            continue
        chunks.append(
            KnowledgeChunk(
                content=content,
                search_text=content,
                language=detect_language(content),
                section_path=heading,
            )
        )
    output = "\n".join(chunk.content for chunk in chunks)
    return KnowledgeExtractionResponse(
        text=output,
        chunks=chunks,
        language=detect_language(output),
        warnings=[],
        metadata={"parser": "markdown_sections", "section_count": len(chunks)},
    )


def extract_text_pages(
    text: str,
    warning: str | None,
    metadata: dict[str, str | int | list[str] | None] | None = None,
) -> KnowledgeExtractionResponse:
    normalized = normalize_whitespace(text)
    language = detect_language(normalized)
    chunk = KnowledgeChunk(
        content=normalized,
        search_text=normalized,
        language=language,
        page_number=1,
    )
    return KnowledgeExtractionResponse(
        text=normalized,
        chunks=[chunk] if normalized else [],
        language=language,
        warnings=[warning] if warning else [],
        metadata={"page_count": 1 if normalized else 0, **(metadata or {})},
    )


def build_table_response(
    rows: list[list[str]],
    parser: str,
    sheet_names: list[str] | None = None,
) -> KnowledgeExtractionResponse:
    if not rows:
        return KnowledgeExtractionResponse(
            text="",
            chunks=[],
            language=None,
            warnings=["empty_table"],
            metadata={
                "column_count": 0,
                "columns": [],
                "parser": parser,
                "row_count": 0,
                "sheet_names": sheet_names or [],
            },
        )

    header = rows[0]
    chunks: list[KnowledgeChunk] = []
    rendered_rows: list[str] = []
    for index, row in enumerate(rows[1:], start=2):
        rendered = "; ".join(
            f"{header[column] if column < len(header) else f'column_{column + 1}'}: {value}"
            for column, value in enumerate(row)
        )
        rendered_rows.append(rendered)
        chunks.append(
            KnowledgeChunk(
                content=rendered,
                search_text=rendered,
                language=detect_language(rendered),
                row_range=str(index),
            )
        )

    text_output = "\n".join(rendered_rows)
    return KnowledgeExtractionResponse(
        text=text_output,
        chunks=chunks,
        language=detect_language(text_output),
        warnings=[],
        metadata={
            "column_count": len(header),
            "columns": header,
            "parser": parser,
            "row_count": max(0, len(rows) - 1),
            "sheet_names": sheet_names or [],
        },
    )


def read_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    try:
        xml = workbook.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    reject_unsafe_xml(xml)
    root = ET.fromstring(xml)
    return [
        "".join(node.text or "" for node in item.findall(".//{*}t"))
        for item in root.findall(".//{*}si")
    ]


def extract_pdf_text(raw: bytes) -> str:
    decoded = raw.decode("latin-1", errors="ignore")
    if not decoded.startswith("%PDF"):
        return ""
    literal_strings = re.findall(r"\(([^()]*)\)", decoded)
    return normalize_whitespace(" ".join(literal_strings))


def extract_canonical(text: str) -> str | None:
    match = re.search(
        r"<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']",
        text,
        flags=re.IGNORECASE,
    )
    return match.group(1) if match else None


def extract_title(text: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.DOTALL | re.IGNORECASE)
    return normalize_whitespace(html.unescape(match.group(1))) if match else None


def extract_headings(text: str) -> list[str]:
    headings = re.findall(r"<h[1-6][^>]*>(.*?)</h[1-6]>", text, flags=re.DOTALL | re.IGNORECASE)
    return [strip_html(heading) for heading in headings if strip_html(heading)]


def strip_html(text: str) -> str:
    return normalize_whitespace(html.unescape(re.sub(r"<[^>]+>", " ", text)))


def strip_html_boilerplate(text: str) -> str:
    body = remove_html_boilerplate_elements(text)
    body = re.sub(r"<[^>]+>", " ", body)
    return normalize_whitespace(html.unescape(body))


def remove_html_boilerplate_elements(text: str) -> str:
    body = re.sub(r"<(script|style).*?</\1>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    return re.sub(r"<(nav|footer|aside).*?</\1>", " ", body, flags=re.DOTALL | re.IGNORECASE)


def decode_text(raw: bytes) -> str:
    for encoding in ("utf-8", "cp1250", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def decode_request_content(content_base64: str) -> bytes:
    if content_base64.strip() != content_base64 or len(content_base64) % 4 != 0:
        raise HTTPException(status_code=400, detail="content_base64 must be strict base64.")
    try:
        raw = base64.b64decode(content_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(
            status_code=400, detail="content_base64 must be strict base64."
        ) from exc
    if len(raw) > MAX_DECODED_BYTES:
        raise HTTPException(status_code=413, detail="Decoded content exceeds 50 MiB.")
    if base64.b64encode(raw).decode("ascii") != content_base64:
        raise HTTPException(status_code=400, detail="content_base64 must be canonical base64.")
    return raw


def open_safe_zip(raw: bytes) -> zipfile.ZipFile:
    archive = zipfile.ZipFile(io.BytesIO(raw))
    try:
        validate_zip_archive(archive)
    except Exception:
        archive.close()
        raise
    return archive


def validate_zip_archive(archive: zipfile.ZipFile) -> None:
    infos = archive.infolist()
    if len(infos) > MAX_ZIP_MEMBERS:
        raise HTTPException(status_code=413, detail="Archive has too many entries.")

    total_size = 0
    for info in infos:
        name = info.filename.replace("\\", "/")
        if is_unsafe_zip_member_name(name):
            raise HTTPException(status_code=400, detail="Archive contains an unsafe path.")
        if info.file_size > MAX_ZIP_MEMBER_BYTES:
            raise HTTPException(status_code=413, detail="Archive member exceeds size limit.")
        total_size += info.file_size
        if total_size > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES:
            raise HTTPException(status_code=413, detail="Archive exceeds uncompressed size limit.")


def is_unsafe_zip_member_name(name: str) -> bool:
    parts = [part for part in name.split("/") if part]
    return (
        not name
        or name.startswith("/")
        or re.match(r"^[a-z]:", name, flags=re.IGNORECASE) is not None
        or any(part == ".." for part in parts)
    )


def reject_unsafe_xml(xml: bytes) -> None:
    prefix = xml[:2048].decode("utf-8", errors="ignore").upper()
    if "<!DOCTYPE" in prefix or "<!ENTITY" in prefix:
        raise HTTPException(status_code=400, detail="Unsafe XML declarations are not allowed.")


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def detect_language(text: str) -> str | None:
    lowered = text.lower()
    if any(token in lowered for token in ["korpus", "znanja", "administrator", "odobrav"]):
        return "hr"
    if text:
        return "en"
    return None
