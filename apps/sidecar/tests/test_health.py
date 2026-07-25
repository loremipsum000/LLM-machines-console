from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from sidecar.main import app

client = TestClient(app)


def test_livez() -> None:
    response = client.get("/livez")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_healthz_alias() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_reports_degraded_without_litellm_url(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.delenv("LITELLM_URL", raising=False)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_sidecar_image_installs_ocr_runtime() -> None:
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile"
    content = dockerfile.read_text(encoding="utf-8")

    assert "apt-get install" in content
    assert "tesseract-ocr" in content
    assert "tesseract-ocr-eng" in content
    assert "tesseract-ocr-hrv" in content
    assert "ocrmypdf" in content
    assert "ghostscript" in content
    assert "rm -rf /var/lib/apt/lists/*" in content
