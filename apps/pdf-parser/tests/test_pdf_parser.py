from __future__ import annotations

from pathlib import Path
from typing import cast

from fastapi.testclient import TestClient
from httpx import Response
from pytest import MonkeyPatch

import pdf_parser.main as parser_main
from pdf_parser.main import app
from pdf_parser.opendataloader import DEFAULT_OPTIONS, OpenDataLoaderOutput, ParserTimeout

client = TestClient(app)
fixture_root = Path(__file__).parents[3] / "test-fixtures" / "knowledge" / "pdf-parser"
token = "pdf-parser-test-token"
auth_headers = {"X-LLM-Machines-Pdf-Parser-Token": token}


def test_healthz() -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_extract_requires_service_token(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)

    missing_response = post_extract("digital-english-policy.pdf", headers={})
    wrong_response = post_extract(
        "digital-english-policy.pdf",
        headers={"X-LLM-Machines-Pdf-Parser-Token": "wrong"},
    )

    assert missing_response.status_code == 401
    assert wrong_response.status_code == 401


def test_rejects_non_pdf_upload(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)

    response = client.post(
        "/v1/pdf/extract",
        data={"source_id": "source-1", "file_name": "notes.txt", "checksum": "sha256:test"},
        files={"file": ("notes.txt", b"not a pdf", "text/plain")},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF uploads are supported."


def test_rejects_oversized_pdf(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)
    monkeypatch.setenv("KNOWLEDGE_PDF_MAX_FILE_BYTES", "8")

    response = post_extract("digital-english-policy.pdf")

    assert response.status_code == 413
    assert response.json()["detail"] == "PDF file exceeds the configured size limit."


def test_rejects_corrupt_pdf_with_controlled_error(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)

    response = post_extract("corrupt.pdf")

    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF uploads are supported."


def test_extracts_digital_english_pdf(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)
    monkeypatch.setattr(parser_main, "run_opendataloader", fake_english_parser)

    response = post_extract("digital-english-policy.pdf")

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "opendataloader-pdf"
    assert body["metadata"]["page_count"] == 1
    assert body["metadata"]["element_count"] >= 3
    assert body["artifacts"]["markdown"].startswith("# English")
    assert body["chunks"][0]["page_number"] == 1
    assert "immutable corpus snapshot" in body["text"]


def test_extracts_digital_croatian_pdf(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)
    monkeypatch.setattr(parser_main, "run_opendataloader", fake_croatian_parser)

    response = post_extract("digital-croatian-policy.pdf")

    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "hr"
    assert body["chunks"][0]["language"] == "hr"
    assert "Administratori odobravaju korpuse znanja" in body["text"]


def test_parser_timeout_returns_controlled_failure(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)

    def timeout_parser(
        pdf_path: Path,
        output_dir: Path,
        timeout_seconds: float,
    ) -> OpenDataLoaderOutput:
        raise ParserTimeout("timeout")

    monkeypatch.setattr(parser_main, "run_opendataloader", timeout_parser)

    response = post_extract("digital-english-policy.pdf")

    assert response.status_code == 504
    assert response.json()["detail"] == "PDF extraction timed out."


def test_response_does_not_expose_temp_paths_or_secrets(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_PDF_PARSER_SERVICE_TOKEN", token)
    monkeypatch.setenv("MINIO_SECRET_KEY", "super-secret-value")
    monkeypatch.setattr(parser_main, "run_opendataloader", fake_english_parser)

    response = post_extract("digital-english-policy.pdf")
    body = response.text

    assert response.status_code == 200
    assert "/tmp/" not in body
    assert "super-secret-value" not in body


def post_extract(
    fixture_name: str,
    headers: dict[str, str] | None = None,
) -> Response:
    path = fixture_root / fixture_name
    return cast(
        Response,
        client.post(
            "/v1/pdf/extract",
            data={"source_id": "source-1", "file_name": fixture_name, "checksum": "sha256:test"},
            files={"file": (fixture_name, path.read_bytes(), "application/pdf")},
            headers=auth_headers if headers is None else headers,
        ),
    )


def fake_english_parser(
    pdf_path: Path,
    output_dir: Path,
    timeout_seconds: float,
) -> OpenDataLoaderOutput:
    return OpenDataLoaderOutput(
        document_json={
            "number of pages": 1,
            "kids": [
                {
                    "content": "English digital policy PDF fixture.",
                    "id": "title-1",
                    "page number": 1,
                    "type": "heading",
                },
                {
                    "bounding box": [72, 720, 520, 744],
                    "content": "The immutable corpus snapshot must preserve page-aware citations.",
                    "id": "p-1",
                    "page number": 1,
                    "type": "paragraph",
                },
            ],
        },
        markdown="# English\n\nThe immutable corpus snapshot must preserve page-aware citations.",
        options=DEFAULT_OPTIONS,
    )


def fake_croatian_parser(
    pdf_path: Path,
    output_dir: Path,
    timeout_seconds: float,
) -> OpenDataLoaderOutput:
    return OpenDataLoaderOutput(
        document_json={
            "number of pages": 1,
            "kids": [
                {
                    "content": "Administratori odobravaju korpuse znanja za interne pravilnike.",
                    "id": "p-hr-1",
                    "page number": 1,
                    "type": "paragraph",
                }
            ],
        },
        markdown="Administratori odobravaju korpuse znanja za interne pravilnike.",
        options=DEFAULT_OPTIONS,
    )
