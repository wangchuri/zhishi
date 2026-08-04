"""共享测试工具：创建用户文档（学习区/生活区）。"""
from app.crud import kb as kb_crud
from app.services.storage_service import storage_service


def make_document(
    db,
    user,
    collection,
    *,
    content_hash="hash_study_001",
    display_name="chapter.md",
    md="# 第一章\n这是学习资料内容。\n\n## 小结\n重点。",
    indexing_status="processing",
):
    parsed_path = storage_service.save_global_parsed(content_hash, md)
    gdoc = kb_crud.create_global_document(
        db,
        content_hash=content_hash,
        original_filename=display_name,
        file_size=len(md.encode()),
        storage_path=f"/tmp/{display_name}",
        parsed_text_path=parsed_path,
    )
    doc = kb_crud.create_document(
        db,
        user_id=user.id,
        collection_id=collection.id,
        zone=collection.zone,
        display_name=display_name,
        content_hash=content_hash,
        global_document_id=gdoc.id,
        parsed_cache_key=parsed_path,
        indexing_status=indexing_status,
    )
    db.commit()
    return doc
