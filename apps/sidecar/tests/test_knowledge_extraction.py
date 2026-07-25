import base64
import io
import os
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from httpx import Response
from pytest import MonkeyPatch
from sidecar.main import app

client = TestClient(app)
fixture_root = Path(__file__).parents[3] / "test-fixtures" / "knowledge"
sidecar_token = "sidecar-test-token"
auth_headers = {"X-LLM-Machines-Sidecar-Token": sidecar_token}
os.environ.setdefault("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", sidecar_token)


def encoded(name: str) -> str:
    return base64.b64encode((fixture_root / name).read_bytes()).decode("ascii")


def post_extract(payload: dict[str, object]) -> Response:
    return client.post(
        "/v1/knowledge/extract",
        headers=auth_headers,
        json=payload,
    )


def make_zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_extract_requires_service_token(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWLEDGE_SIDECAR_SERVICE_TOKEN", sidecar_token)
    payload = {
        "source_type": "file",
        "file_name": "hr-pravilnik.txt",
        "mime_type": "text/plain",
        "content_base64": encoded("hr-pravilnik.txt"),
    }

    missing_response = client.post("/v1/knowledge/extract", json=payload)
    wrong_response = client.post(
        "/v1/knowledge/extract",
        headers={"X-LLM-Machines-Sidecar-Token": "wrong-token"},
        json=payload,
    )

    assert missing_response.status_code == 401
    assert wrong_response.status_code == 401


def test_extracts_croatian_text_fixture() -> None:
    response = post_extract(
        {
            "source_type": "file",
            "file_name": "hr-pravilnik.txt",
            "mime_type": "text/plain",
            "content_base64": encoded("hr-pravilnik.txt"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "hr"
    assert "Administratori objavljuju korpuse znanja" in body["text"]
    assert body["chunks"][0]["page_number"] == 1


def test_extracts_pdf_fixture_with_page_metadata() -> None:
    response = post_extract(
        {
            "source_type": "file",
            "file_name": "en-safety.pdf",
            "mime_type": "application/pdf",
            "content_base64": encoded("en-safety.pdf"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "pdf_text"
    assert body["metadata"]["parser_report"]["selectedParser"] == "docling_pdf_pending"
    assert body["metadata"]["parser_report"]["registryProfile"] == "docling_pdf_pending"
    assert body["metadata"]["parser_report"]["parserPriority"] == 40
    assert body["metadata"]["parser_report"]["licenseStatus"] == "MIT pending dependency"
    assert body["artifacts"]["parser_report"]["pageUnits"] == 1
    assert body["chunks"][0]["page_number"] == 1
    assert "page-aware extraction behavior" in body["text"]


def test_extracts_docx_fixture_text() -> None:
    response = post_extract(
        {
            "source_type": "file",
            "file_name": "hr-pravilnik.docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content_base64": encoded("hr-pravilnik.docx"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "docx_text_fallback"
    assert body["language"] == "hr"
    assert "docx-nazvanoj testnoj datoteci" in body["text"]


def test_extracts_pptx_slide_text_with_slide_citations() -> None:
    payload = make_zip(
        {
            "ppt/slides/slide1.xml": (b"<sld><t>First sovereign slide</t></sld>"),
            "ppt/slides/slide2.xml": (b"<sld><t>Second parser slide</t></sld>"),
        }
    )

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "deck.pptx",
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "pptx_zip"
    assert body["chunks"][0]["page_number"] == 1
    assert body["chunks"][1]["section_path"] == "slide.2"
    assert body["metadata"]["parser_report"]["pageUnits"] == 2


def test_rejects_blocked_archive_and_old_office_uploads() -> None:
    blocked = [
        ("bundle.zip", "application/zip"),
        ("legacy.doc", "application/msword"),
        ("legacy.ppt", "application/vnd.ms-powerpoint"),
        ("legacy.xls", "application/vnd.ms-excel"),
    ]

    for file_name, mime_type in blocked:
        response = post_extract(
            {
                "source_type": "file",
                "file_name": file_name,
                "mime_type": mime_type,
                "content_base64": base64.b64encode(b"blocked").decode("ascii"),
            },
        )

        assert response.status_code == 415
        assert "blocked" in response.json()["detail"]


def test_rejects_sources_above_page_unit_limit() -> None:
    fake_pdf = b"%PDF-1.7\n" + (b"/Type /Page\n" * 251)

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "too-many-pages.pdf",
            "mime_type": "application/pdf",
            "content_base64": base64.b64encode(fake_pdf).decode("ascii"),
        },
    )

    assert response.status_code == 413
    assert "250 page-unit" in response.json()["detail"]


def test_rejects_detected_type_spoofing() -> None:
    response = post_extract(
        {
            "source_type": "file",
            "file_name": "spoofed.txt",
            "mime_type": "text/plain",
            "content_base64": base64.b64encode(b"%PDF-1.7\nfake pdf body").decode("ascii"),
        },
    )

    assert response.status_code == 415
    assert "detected content type" in response.json()["detail"]


def test_extracts_url_snapshot_with_canonical_uri() -> None:
    response = post_extract(
        {
            "source_type": "url",
            "file_name": "url-policy.html",
            "mime_type": "text/html",
            "content_base64": encoded("url-policy.html"),
            "original_uri": "https://docs.example.test/governed-url-corpus",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["canonical_uri"] == "https://docs.example.test/governed-url-corpus"
    assert body["metadata"]["parser"] == "trafilatura"
    assert body["metadata"]["parser_report"]["selectedParser"] == "trafilatura_html"
    assert body["metadata"]["title"] == "Governed URL Corpus Fixture"
    assert body["metadata"]["headings"] == ["Governed URL Corpus Fixture"]
    assert body["chunks"][0]["section_path"] == "Governed URL Corpus Fixture"
    assert "Runtime answers must cite the stored snapshot" in body["text"]


def test_extracts_noisy_html_body_without_boilerplate() -> None:
    html = b"""
    <!doctype html>
    <html>
      <head><title>Noisy Policy</title><script>secretNav()</script></head>
      <body>
        <nav>Navigation should disappear</nav>
        <main><h2>Operational Policy</h2><p>Keep this governed body text.</p></main>
        <footer>Footer should disappear</footer>
      </body>
    </html>
    """

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "noisy.html",
            "mime_type": "text/html",
            "content_base64": base64.b64encode(html).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "trafilatura"
    assert body["metadata"]["parser_report"]["selectedParser"] == "trafilatura_html"
    assert body["metadata"]["title"] == "Noisy Policy"
    assert body["metadata"]["headings"] == ["Operational Policy"]
    assert body["chunks"][0]["section_path"] == "Operational Policy"
    assert "Keep this governed body text" in body["text"]
    assert "Navigation should disappear" not in body["text"]
    assert "Footer should disappear" not in body["text"]
    assert "secretNav" not in body["text"]


def test_extracts_table_rows_with_row_range() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "table-policy.csv",
            "mime_type": "text/csv",
            "content_base64": encoded("table-policy.csv"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["row_count"] == 2
    assert body["metadata"]["columns"] == ["policy_id", "title", "language", "owner"]
    assert body["metadata"]["column_count"] == 4
    assert body["chunks"][0]["row_range"] == "2"
    assert "Admin-only corpus ingestion" in body["chunks"][0]["content"]


def test_extracts_tsv_rows_with_row_range() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "table-policy.tsv",
            "mime_type": "text/tab-separated-values",
            "content_base64": base64.b64encode(
                b"policy_id\ttitle\towner\nTSV-001\tTab separated corpus\tsecurity\n"
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["row_count"] == 1
    assert body["metadata"]["columns"] == ["policy_id", "title", "owner"]
    assert body["chunks"][0]["row_range"] == "2"
    assert "title: Tab separated corpus" in body["chunks"][0]["content"]


def test_extracts_json_with_key_path_citations() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "policy.json",
            "mime_type": "application/json",
            "content_base64": base64.b64encode(
                b'{"policy":{"owner":"Admin","control":"sovereign parser router"}}'
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "json_structured"
    assert body["metadata"]["parser_report"]["selectedParser"] == "native_structured_data_pending"
    assert body["chunks"][0]["section_path"] == "$.policy.owner"
    assert "$.policy.control" in body["text"]


def test_extracts_jsonl_with_record_citations() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "policy.jsonl",
            "mime_type": "application/x-ndjson",
            "content_base64": base64.b64encode(
                b'{"title":"First record"}\n{"title":"Second record"}\n'
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "jsonl_structured"
    assert body["chunks"][0]["row_range"] == "1"
    assert body["chunks"][1]["section_path"] == "record[2]"


def test_extracts_xml_with_key_path_citations() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "policy.xml",
            "mime_type": "application/xml",
            "content_base64": base64.b64encode(
                b"<policy><owner>Admin</owner><control>Local parsing</control></policy>"
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "xml_structured"
    assert body["chunks"][0]["section_path"] == "$.policy.owner"
    assert "$.policy.control" in body["text"]


def test_extracts_yaml_with_key_path_citations() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "policy.yaml",
            "mime_type": "application/x-yaml",
            "content_base64": base64.b64encode(
                b"policy:\n  owner: Admin\n  control: Local YAML parsing\n"
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "yaml_structured"
    assert body["chunks"][0]["section_path"] == "$.policy.owner"
    assert "$.policy.control" in body["text"]


def test_extracts_markdown_with_section_citations() -> None:
    response = post_extract(
        {
            "source_type": "file",
            "file_name": "policy.md",
            "mime_type": "text/markdown",
            "content_base64": base64.b64encode(
                b'# Parser Router\nUse local parsers.\n\n```json\n{"mode":"local"}\n```\n'
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "markdown_sections"
    assert body["chunks"][0]["section_path"] == "Parser Router"
    assert '"mode":"local"' in body["text"]


def test_extracts_xlsx_named_table_fixture() -> None:
    response = post_extract(
        {
            "source_type": "table",
            "file_name": "table-policy.xlsx",
            "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content_base64": encoded("table-policy.xlsx"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "xlsx_text_fallback"
    assert body["metadata"]["columns"] == ["policy_id", "title", "language", "owner"]
    assert body["chunks"][0]["row_range"] == "2"
    assert "Spreadsheet fixture row range" in body["chunks"][0]["content"]


def test_extracts_ods_rows_with_sheet_metadata() -> None:
    payload = make_zip(
        {
            "content.xml": (
                b'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                b'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
                b'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
                b'<office:body><office:spreadsheet><table:table table:name="Controls">'
                b"<table:table-row><table:table-cell><text:p>control</text:p></table:table-cell>"
                b"<table:table-cell><text:p>owner</text:p></table:table-cell></table:table-row>"
                b"<table:table-row><table:table-cell><text:p>ODS-001</text:p></table:table-cell>"
                b"<table:table-cell><text:p>Admin</text:p></table:table-cell></table:table-row>"
                b"</table:table></office:spreadsheet></office:body></office:document-content>"
            ),
        }
    )

    response = post_extract(
        {
            "source_type": "table",
            "file_name": "controls.ods",
            "mime_type": "application/vnd.oasis.opendocument.spreadsheet",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "ods_zip"
    assert body["metadata"]["sheet_names"] == ["Controls"]
    assert body["metadata"]["columns"] == ["control", "owner"]
    assert body["chunks"][0]["row_range"] == "2"
    assert "owner: Admin" in body["chunks"][0]["content"]


def test_extracts_opendocument_text() -> None:
    payload = make_zip(
        {
            "content.xml": (
                b'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                b'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
                b"<office:body><office:text><text:p>OpenDocument governed corpus text.</text:p></office:text></office:body>"
                b"</office:document-content>"
            ),
        }
    )

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "manual.odt",
            "mime_type": "application/vnd.oasis.opendocument.text",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "odt_opendocument_zip"
    assert "OpenDocument governed corpus text" in body["text"]


def test_extracts_opendocument_presentation_text() -> None:
    payload = make_zip(
        {
            "content.xml": (
                b'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                b'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">'
                b"<office:body><office:presentation><draw:page>OpenDocument presentation text.</draw:page></office:presentation></office:body>"
                b"</office:document-content>"
            ),
        }
    )

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "deck.odp",
            "mime_type": "application/vnd.oasis.opendocument.presentation",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "odp_opendocument_zip"
    assert "OpenDocument presentation text" in body["text"]


def test_extracts_epub_html_text() -> None:
    payload = make_zip(
        {
            "chapter.xhtml": b"<html><body><h1>EPUB Manual</h1><p>Local fallback parser text.</p></body></html>",
        }
    )

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "manual.epub",
            "mime_type": "application/epub+zip",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["parser"] == "epub_zip_html"
    assert "Local fallback parser text" in body["text"]


def test_extracts_rtf_email_and_msg_text_fallbacks() -> None:
    cases = [
        ("policy.rtf", "application/rtf", b"{\\rtf1 Sovereign RTF parser text.}"),
        ("notice.eml", "message/rfc822", b"Subject: Policy\n\nSovereign EML parser text."),
        ("notice.msg", "application/vnd.ms-outlook", b"Sovereign MSG parser text."),
    ]

    for file_name, mime_type, content in cases:
        response = post_extract(
            {
                "source_type": "file",
                "file_name": file_name,
                "mime_type": mime_type,
                "content_base64": base64.b64encode(content).decode("ascii"),
            },
        )

        assert response.status_code == 200
        assert "Sovereign" in response.json()["text"]


def test_extracts_image_fixture_as_ocr_text() -> None:
    response = post_extract(
        {
            "source_type": "image",
            "file_name": "image-ocr.jpg",
            "mime_type": "image/jpeg",
            "content_base64": encoded("image-ocr.jpg"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["chunks"][0]["image_region"] == "full-image"
    assert body["metadata"]["ocr_mode"] == "fixture_text_fallback"
    assert body["metadata"]["pixel_reasoning"] is False
    assert "tesseract_unavailable" in body["warnings"]
    assert "administrator odobrava korpus znanja" in body["text"]


def test_uses_tesseract_when_binary_is_available(monkeypatch: MonkeyPatch) -> None:
    from sidecar import knowledge

    monkeypatch.setattr(
        knowledge,
        "run_tesseract_ocr",
        lambda _raw, _extension: ("Tesseract extracted local OCR text.", None),
    )

    response = post_extract(
        {
            "source_type": "image",
            "file_name": "real.png",
            "mime_type": "image/png",
            "content_base64": base64.b64encode(b"fake-png-bytes").decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["ocr_mode"] == "tesseract"
    assert body["warnings"] == []
    assert "Tesseract extracted local OCR text" in body["text"]


def test_records_weak_ocr_warning_for_empty_image_text() -> None:
    response = post_extract(
        {
            "source_type": "image",
            "file_name": "empty.png",
            "mime_type": "image/png",
            "content_base64": base64.b64encode(b"   \n").decode("ascii"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["chunks"] == []
    assert body["warnings"] == ["tesseract_unavailable", "weak_ocr"]


def test_rejects_path_traversal_zip_member() -> None:
    payload = make_zip(
        {
            "../evil.txt": b"do not extract",
            "word/document.xml": b"<w:document><w:t>safe text</w:t></w:document>",
        }
    )

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "evil.docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 400
    assert "unsafe path" in response.json()["detail"]


def test_rejects_zip_member_size_bomb() -> None:
    payload = make_zip(
        {
            "xl/worksheets/sheet1.xml": b"x" * (5 * 1024 * 1024 + 1),
        }
    )

    response = post_extract(
        {
            "source_type": "table",
            "file_name": "bomb.xlsx",
            "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 413
    assert "size limit" in response.json()["detail"]


def test_rejects_unsafe_xml_declarations() -> None:
    payload = make_zip(
        {
            "word/document.xml": (
                b'<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>'
                b"<w:document><w:t>&xxe;</w:t></w:document>"
            ),
        }
    )

    response = post_extract(
        {
            "source_type": "file",
            "file_name": "unsafe.docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content_base64": base64.b64encode(payload).decode("ascii"),
        },
    )

    assert response.status_code == 400
    assert "Unsafe XML" in response.json()["detail"]
