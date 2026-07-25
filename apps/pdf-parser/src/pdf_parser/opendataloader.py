from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path


DEFAULT_COMMAND = "opendataloader-pdf"
DEFAULT_OPTIONS = [
    "--format",
    "json,markdown",
    "--hybrid",
    "off",
    "--image-output",
    "off",
]


class ParserError(RuntimeError):
    pass


class ParserTimeout(ParserError):
    pass


@dataclass(frozen=True)
class OpenDataLoaderOutput:
    document_json: dict[str, object]
    markdown: str
    options: list[str]


def run_opendataloader(
    pdf_path: Path,
    output_dir: Path,
    timeout_seconds: float,
) -> OpenDataLoaderOutput:
    command = os.environ.get("KNOWLEDGE_PDF_PARSER_COMMAND", DEFAULT_COMMAND).strip()
    args = [
        command,
        str(pdf_path),
        "--output-dir",
        str(output_dir),
        *DEFAULT_OPTIONS,
    ]
    try:
        subprocess.run(
            args,
            check=True,
            cwd=output_dir,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise ParserTimeout("OpenDataLoader PDF extraction timed out.") from exc
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise ParserError("OpenDataLoader PDF extraction failed.") from exc

    json_path = find_output(output_dir, ".json")
    markdown_path = find_output(output_dir, ".md")
    if not json_path or not markdown_path:
        raise ParserError("OpenDataLoader output artifacts are missing.")

    try:
        document = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ParserError("OpenDataLoader JSON output is invalid.") from exc
    if not isinstance(document, dict):
        raise ParserError("OpenDataLoader JSON output is not a document object.")

    return OpenDataLoaderOutput(
        document_json=document,
        markdown=markdown_path.read_text(encoding="utf-8"),
        options=DEFAULT_OPTIONS,
    )


def find_output(output_dir: Path, suffix: str) -> Path | None:
    candidates = sorted(path for path in output_dir.rglob(f"*{suffix}") if path.is_file())
    return candidates[0] if candidates else None
