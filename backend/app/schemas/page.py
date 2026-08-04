from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import MAX_QUESTIONS_PER_DOCUMENT


class DocumentPageOut(BaseModel):
    page_number: int
    title: str
    preview: str
    char_start: int
    char_end: int
    content_length: int
    has_builtin_questions: bool = False
    is_key_page: bool = False
    segment_id: Optional[str] = None
    preview_mode: str = "markdown"
    file_type: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DocumentPageListOut(BaseModel):
    document_id: str
    document_name: str
    total_pages: int
    has_page_markers: bool
    preview_mode: str = "markdown"
    file_type: Optional[str] = None
    has_raw_file: bool = False
    pages: List[DocumentPageOut]


class DocumentPageDetailOut(DocumentPageOut):
    content: str


class PageGenerateRequest(BaseModel):
    document_id: str
    page_numbers: List[int] = Field(..., min_length=1)
    # 每页出题数可手动输入，上限与单文档题目总数限制一致（服务端还会再兜底）
    questions_per_page: int = Field(default=1, ge=1, le=MAX_QUESTIONS_PER_DOCUMENT)


class PageExtractRequest(BaseModel):
    document_id: str
    page_numbers: List[int] = Field(..., min_length=1)
