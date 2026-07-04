from app.services.ocr_backends.registry import (
    create_local_engine,
    get_local_engine,
    is_local_backend,
    normalize_local_backend,
    reset_local_engine,
)

__all__ = [
    "create_local_engine",
    "get_local_engine",
    "is_local_backend",
    "normalize_local_backend",
    "reset_local_engine",
]
