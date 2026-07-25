from pydantic import BaseModel, ConfigDict, Field


class PdfChunk(BaseModel):
    content: str
    search_text: str
    language: str | None = None
    page_number: int | None = None
    section_path: str | None = None
    row_range: str | None = None
    image_region: str | None = None


class PdfExtractionArtifacts(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_json: dict[str, object] = Field(alias="json")
    markdown: str
    page_map: list[dict[str, object]]
    parser_report: dict[str, object]


class PdfExtractionMetadata(BaseModel):
    parser: str = "opendataloader-pdf"
    parser_version: str
    page_count: int
    element_count: int
    elapsed_ms: int
    opendataloader_options: list[str]
    ocr_mode: str = "disabled"


class PdfExtractionResponse(BaseModel):
    text: str
    chunks: list[PdfChunk]
    language: str | None = None
    warnings: list[str]
    metadata: PdfExtractionMetadata
    artifacts: PdfExtractionArtifacts


class HealthResponse(BaseModel):
    status: str = Field(default="ok")
