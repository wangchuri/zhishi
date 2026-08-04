from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class NoteOut(BaseModel):
    id: str
    title: str
    content_md: str
    collection_id: Optional[str] = None
    document_id: Optional[str] = None
    note_type: str = "manual"
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class NoteListOut(BaseModel):
    notes: List[NoteOut]
    total: int


class TipCreate(BaseModel):
    document_id: str
    page_number: int
    title: str
    content: str
