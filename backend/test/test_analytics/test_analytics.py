"""学习分析测试：学习时长、活跃统计、学习统计聚合。"""
from app.models.activity import DailyActivity
from app.services import analytics_service
from app.services.question_gen_service import _persist_question_core


def test_add_active_seconds_clamps_and_accumulates(db, user):
    out = analytics_service.add_active_seconds(db, user.id, 30)
    assert out["today_active_seconds"] == 30

    analytics_service.add_active_seconds(db, user.id, 500)
    out2 = analytics_service.get_activity_stats(db, user.id)
    assert out2["today_active_seconds"] == 120  # 30 + clamp(500→90)

    analytics_service.add_active_seconds(db, user.id, -5)
    out3 = analytics_service.get_activity_stats(db, user.id)
    assert out3["today_active_seconds"] == 120


def test_activity_stats_empty(db, user):
    stats = analytics_service.get_activity_stats(db, user.id)
    assert stats["today_active_seconds"] == 0
    assert stats["total_active_seconds"] == 0


def test_daily_activity_row_created(db, user):
    analytics_service.add_active_seconds(db, user.id, 10)
    row = (
        db.query(DailyActivity)
        .filter(DailyActivity.user_id == user.id)
        .first()
    )
    assert row is not None
    assert row.active_seconds == 10


def test_get_learning_stats_empty(db, user):
    stats = analytics_service.get_learning_stats(db, user.id)
    assert stats.documents.total == 0
    assert stats.questions.total == 0
    assert stats.questions.accuracy_rate is None


def _persist_q(db, user, doc, stem="1+1=?"):
    qdata = {
        "stem": stem,
        "question_type": "single_choice",
        "options": [
            {"key": "A", "text": "3"},
            {"key": "B", "text": "2"},
        ],
        "answer": "B",
        "explanation": "2 是答案",
        "tags": ["数学"],
    }
    _persist_question_core(
        db,
        user_id=user.id,
        document=doc,
        qdata=qdata,
        source_type="generated",
        segment_id=None,
        excerpt="e",
    )
    db.commit()


def test_get_learning_stats_with_doc_and_question(db, user, study_doc):
    _persist_q(db, user, study_doc)
    stats = analytics_service.get_learning_stats(db, user.id)
    assert stats.documents.total == 1
    assert stats.documents.study_zone == 1
    assert stats.documents.with_questions == 1
    assert stats.questions.total == 1
    assert stats.questions.answered == 0


def test_tag_stats_empty(db, user):
    out = analytics_service.get_tag_stats(db, user.id)
    assert out.by_tag == []
    assert out.by_question_type == []
