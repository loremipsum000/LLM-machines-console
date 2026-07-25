import os
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response
from sidecar.knowledge import router as knowledge_router

app = FastAPI(title="LLM Machines Sidecar")
app.include_router(knowledge_router)

DEFAULT_EXTRACTION_REQUEST_LIMIT_BYTES = 72 * 1024 * 1024


@app.middleware("http")
async def enforce_extraction_request_size(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    if request.url.path == "/v1/knowledge/extract":
        content_length = request.headers.get("content-length")
        limit = extraction_request_limit_bytes()
        try:
            parsed_content_length = int(content_length) if content_length else 0
        except ValueError:
            parsed_content_length = limit + 1
        if parsed_content_length > limit:
            return JSONResponse(
                status_code=413,
                content={"detail": "Knowledge extraction request exceeds the size limit."},
            )
    return await call_next(request)


def livez() -> dict[str, str]:
    return {"status": "ok"}


def readyz() -> JSONResponse:
    litellm_url = os.environ.get("LITELLM_URL")
    if not litellm_url:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "detail": "LITELLM_URL is not configured."},
        )

    request = urllib.request.Request(
        f"{litellm_url.rstrip('/')}/v1/models",
        headers=auth_headers(),
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            if 200 <= response.status < 500:
                return JSONResponse(status_code=200, content={"status": "ok"})
    except (TimeoutError, urllib.error.URLError):
        pass

    return JSONResponse(
        status_code=503,
        content={"status": "degraded", "detail": "LiteLLM readiness probe failed."},
    )


def auth_headers() -> dict[str, str]:
    key = os.environ.get("LITELLM_KEY")
    return {"Authorization": f"Bearer {key}"} if key else {}


def extraction_request_limit_bytes() -> int:
    try:
        configured = int(os.environ.get("KNOWLEDGE_SIDECAR_MAX_REQUEST_BYTES", ""))
    except ValueError:
        configured = 0
    return configured if configured > 0 else DEFAULT_EXTRACTION_REQUEST_LIMIT_BYTES


app.get("/livez")(livez)
app.get("/healthz")(livez)
app.get("/health")(livez)
app.get("/readyz")(readyz)
