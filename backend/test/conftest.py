"""
pytest 共享 fixtures — 内存 SQLite、临时存储、默认用户与知识库分区。
所有测试在隔离环境运行，不写真实数据库 / storage / chroma。
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
TEST_DIR = Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

os.environ.setdefault("RAG_BACKEND", "local")
os.environ.setdefault("DOCUMENT_PIPELINE_ASYNC", "false")
os.environ.setdefault("QUESTION_GEN_ASYNC", "false")
os.environ.setdefault("IMAGE_OCR_ASYNC", "false")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.crud import kb as kb_crud
from app.models import User
from app.services.storage_service import LocalStorage, storage_service

from helpers import make_document

# 旧版 plain-python 脚本（部分引用了已移除的 generate_questions / 依赖网络）
collect_ignore = [
    "test_s2_kb.py",
    "test_s3_segment.py",
    "test_s4_questions.py",
    "test_s5_quiz.py",
    "test_s6_tutor.py",
    "test_s7_citation.py",
    "test_local_rag.py",
    "test_fill_blank_grade.py",
    "test_pdf_ocr.py",
    "test_async_config.py",
    "test_parsed_pages.py",
    "test_kb_upload_fix.py",
    "test_dify_kb.py",
    "test_question_gen_agent.py",
]


@pytest.fixture(autouse=True)
def _tmp_storage(tmp_path, monkeypatch):
    """将全局 storage_service 后端重定向到临时目录，避免污染 backend/storage。"""
    ls = LocalStorage(str(tmp_path / "storage"))
    monkeypatch.setattr(storage_service, "_backend", ls)
    return ls


@pytest.fixture(autouse=True)
def _no_chroma_indexing(monkeypatch):
    """DB 相关测试禁用真实 Chroma 索引，避免加载模型 / 写 data/chroma。"""
    monkeypatch.setattr("app.core.config.is_local_rag", lambda: False)


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def user(db):
    u = User(
        email="pytest@test.local",
        password_hash="x",
        username="pytest_user",
        nickname="PyTest",
        is_active=True,
        plan_level=0,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture()
def collections(db, user):
    cols = kb_crud.seed_default_collections(db, user.id, None)
    db.commit()
    return cols


@pytest.fixture()
def study_collection(collections):
    return next(c for c in collections if c.zone == "study")


@pytest.fixture()
def life_collection(collections):
    return next(c for c in collections if c.zone == "life")


@pytest.fixture()
def study_doc(db, user, study_collection):
    return make_document(db, user, study_collection)
