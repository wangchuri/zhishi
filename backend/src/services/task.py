"""目标和每日任务：落库、按目标和学情派发、检查器、超时。"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..core.config import config
from ..core.database import SessionLocal
from ..core.storage import storage
from ..models import Document, QuestionProvenance, QuestionRef, QuizAnswer
from ..models.goal import DailyTask, Goal, UserProfile


USER_ID = 1
logger = logging.getLogger(__name__)

_refill_lock = threading.Lock()
_refill_idle = threading.Event()
_refill_idle.set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return date.today()


def _due_at(for_date: date) -> datetime:
    """当天结束：次日 00:00 本地。过了仍未完成则标 expired。"""
    return datetime.combine(for_date + timedelta(days=1), time.min)


def _loads(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def fingerprint(checker: str, payload: dict[str, Any]) -> str:
    blob = json.dumps({"checker": checker, "payload": payload}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:40]


def href_for(kind: str, payload: dict[str, Any]) -> str:
    if kind == "upload":
        return "/knowledge/upload"
    if kind == "generate":
        doc = payload.get("document_id") or ""
        pages = ",".join(str(p) for p in payload.get("page_numbers") or [])
        return f"/question-gen/doc/{doc}?pages={pages}"
    if kind == "quiz":
        doc = payload.get("document_id") or ""
        ids = ",".join(payload.get("question_ids") or [])
        return f"/quiz/session?document_id={doc}&question_ids={ids}"
    return "/quiz"


def action_for(kind: str) -> str:
    return {"upload": "去上传", "generate": "去出题", "quiz": "去刷题"}.get(kind, "去完成")


def task_out(row: DailyTask) -> dict[str, Any]:
    payload = _loads(row.payload_json)
    return {
        "id": row.id,
        "goal_id": row.goal_id,
        "for_date": row.for_date,
        "title": row.title,
        "description": row.description,
        "kind": row.kind,
        "payload": payload,
        "checker": row.checker,
        "status": row.status,
        "href": row.href or href_for(row.kind, payload),
        "action": action_for(row.kind),
        "due_at": row.due_at,
        "completed_at": row.completed_at,
        "expired_at": row.expired_at,
    }


def goal_out(row: Goal) -> dict[str, Any]:
    return {
        "id": row.id,
        "text": row.text,
        "attributes": _loads(row.attributes_json) or None,
        "valid_until": row.valid_until,
        "status": row.status,
        "created_at": row.created_at,
    }


def get_active_goal(db: Session) -> Optional[Goal]:
    return (
        db.query(Goal)
        .filter(Goal.user_id == USER_ID, Goal.status == "active")
        .order_by(Goal.created_at.desc())
        .first()
    )


def upsert_active_goal(
    db: Session,
    text: str,
    attributes: Optional[dict[str, Any]] = None,
    valid_until: Optional[date] = None,
) -> Goal:
    text = (text or "").strip()
    if not text:
        raise ValueError("目标不能为空")
    for old in db.query(Goal).filter(Goal.user_id == USER_ID, Goal.status == "active"):
        old.status = "paused"
    row = Goal(
        user_id=USER_ID,
        text=text,
        attributes_json=json.dumps(attributes, ensure_ascii=False) if attributes else None,
        valid_until=valid_until,
        status="active",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _due_day(row: DailyTask) -> date:
    """到期日：due_at 的日历日；没有则次日。恢复后会把 due_at 延到今天结束。"""
    due: Any = row.due_at
    if isinstance(due, str):
        raw = due.replace("Z", "+00:00").split(".")[0]
        try:
            due = datetime.fromisoformat(raw)
        except ValueError:
            due = None
    if isinstance(due, datetime):
        if due.tzinfo is not None:
            due = due.astimezone().replace(tzinfo=None)
        return due.date()
    if isinstance(due, date):
        return due
    return row.for_date + timedelta(days=1)


def expire_overdue_tasks(db: Session) -> int:
    """昨天及更早仍 pending、且宽限期已过的任务标为超时。每天的行都留着。"""
    today = _today()
    rows = (
        db.query(DailyTask)
        .filter(
            DailyTask.user_id == USER_ID,
            DailyTask.status == "pending",
            DailyTask.for_date < today,
        )
        .all()
    )
    if not rows:
        return 0
    now = _now()
    n = 0
    for row in rows:
        if _due_day(row) > today:
            continue
        row.status = "expired"
        row.expired_at = now
        n += 1
    if n:
        db.commit()
    return n


def list_today_tasks(db: Session) -> list[DailyTask]:
    expire_overdue_tasks(db)
    today = _today()
    return (
        db.query(DailyTask)
        .filter(DailyTask.user_id == USER_ID, DailyTask.for_date == today)
        .order_by(DailyTask.created_at.asc())
        .all()
    )


def list_task_history(db: Session, *, days: int = 14) -> list[DailyTask]:
    expire_overdue_tasks(db)
    cutoff = _today() - timedelta(days=max(1, days))
    return (
        db.query(DailyTask)
        .filter(DailyTask.user_id == USER_ID, DailyTask.for_date >= cutoff)
        .order_by(DailyTask.for_date.desc(), DailyTask.created_at.asc())
        .all()
    )


def _study_docs(db: Session) -> list[Document]:
    return (
        db.query(Document)
        .filter(Document.zone == "study", Document.indexing_status != "failed")
        .order_by(Document.created_at.desc())
        .all()
    )


def library_brief(db: Session, *, limit: int = 12) -> list[dict[str, Any]]:
    """给 Tina 的书单简略：书名、页数、题量、对错不会、开头一句。"""
    from ..utils import parse_tags

    out: list[dict[str, Any]] = []
    for doc in _study_docs(db)[:limit]:
        pages = _page_numbers(doc)
        stats = _doc_question_stats(db, doc.id)
        parsed = (storage.read_parsed(doc.id) or "").strip()
        excerpt = " ".join(parsed.split())[:160]
        out.append({
            "name": doc.display_name,
            "pages": len(pages) or int(doc.pdf_page_count or 0),
            "question_count": len(stats["question_ids"]),
            "undone": len(stats["undone"]),
            "unknown": len(stats["unknown"]),
            "wrong": len(stats["wrong"]),
            "correct": stats["correct"],
            "tags": parse_tags(doc.tags)[:8],
            "excerpt": excerpt,
            "indexing_status": doc.indexing_status or "",
        })
    return out
    return (
        db.query(Document)
        .filter(Document.zone == "study", Document.indexing_status != "failed")
        .order_by(Document.created_at.desc())
        .all()
    )


def _page_numbers(doc: Document) -> list[int]:
    pages = storage.list_pages(doc.id)
    nums = [n for n, _ in pages]
    if nums:
        return nums
    parsed = storage.read_parsed(doc.id) or ""
    return [1] if parsed.strip() else []


def _pages_with_questions(db: Session, document_id: str) -> set[int]:
    rows = (
        db.query(QuestionProvenance.page_number)
        .filter(
            QuestionProvenance.document_id == document_id,
            QuestionProvenance.page_number.isnot(None),
        )
        .distinct()
        .all()
    )
    return {int(n) for (n,) in rows if n is not None}


def _question_ids_for_doc(db: Session, document_id: str) -> list[str]:
    rows = (
        db.query(QuestionProvenance.question_id)
        .filter(QuestionProvenance.document_id == document_id)
        .all()
    )
    seen: list[str] = []
    for (qid,) in rows:
        if qid not in seen:
            seen.append(qid)
    return seen


def _doc_question_stats(db: Session, document_id: str) -> dict[str, Any]:
    ids = _question_ids_for_doc(db, document_id)
    refs = {
        r.question_id: r
        for r in db.query(QuestionRef).filter(QuestionRef.document_id == document_id).all()
    }
    undone: list[str] = []
    unknown: list[str] = []
    wrong: list[str] = []
    correct = 0
    for qid in ids:
        ref = refs.get(qid)
        if ref is None or (ref.attempt_count or 0) == 0:
            undone.append(qid)
        elif ref.last_status == "unknown":
            unknown.append(qid)
        elif ref.last_status == "wrong":
            wrong.append(qid)
        elif ref.last_status == "correct":
            correct += 1
    return {
        "question_ids": ids,
        "undone": undone,
        "unknown": unknown,
        "wrong": wrong,
        "correct": correct,
        "attempted": len(ids) - len(undone),
    }


def _pick_quiz_pool(stats: dict[str, Any]) -> tuple[list[str], str]:
    if stats["undone"]:
        return list(stats["undone"]), "没做"
    if stats["unknown"]:
        return list(stats["unknown"]), "不会"
    if stats["wrong"]:
        return list(stats["wrong"]), "错题"
    return list(stats["question_ids"]), "复习"


def _today_usage(db: Session) -> dict[str, int]:
    rows = (
        db.query(DailyTask)
        .filter(DailyTask.user_id == USER_ID, DailyTask.for_date == _today())
        .all()
    )
    quiz_need = 0
    gen_pages = 0
    for row in rows:
        payload = _loads(row.payload_json)
        if row.kind == "quiz":
            quiz_need += int(payload.get("need") or len(payload.get("question_ids") or []))
        elif row.kind == "generate":
            gen_pages += len(payload.get("page_numbers") or [])
    return {
        "assigned": len(rows),
        "quiz_need": quiz_need,
        "gen_pages": gen_pages,
        "pending": sum(1 for r in rows if r.status == "pending"),
        "completed": sum(1 for r in rows if r.status == "completed"),
        "expired": sum(1 for r in rows if r.status == "expired"),
    }


def _profile(db: Session) -> UserProfile:
    row = db.get(UserProfile, USER_ID)
    if row:
        return row
    row = UserProfile(user_id=USER_ID, onboarding_status="pending")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def is_day_closed(db: Session) -> bool:
    return _profile(db).task_closed_on == _today()


def set_day_closed(db: Session, closed: bool) -> None:
    row = _profile(db)
    row.task_closed_on = _today() if closed else None
    db.commit()


def _task_amount(row: DailyTask) -> str:
    payload = _loads(row.payload_json)
    if row.kind == "quiz":
        n = int(payload.get("need") or len(payload.get("question_ids") or []) or 0)
        return f"{n}题" if n else ""
    if row.kind == "generate":
        n = int(payload.get("need") or len(payload.get("page_numbers") or []) or 0)
        return f"{n}页" if n else ""
    if row.kind == "upload":
        return "1份"
    return ""


def _today_done_items(db: Session) -> list[dict[str, str]]:
    rows = (
        db.query(DailyTask)
        .filter(
            DailyTask.user_id == USER_ID,
            DailyTask.for_date == _today(),
            DailyTask.status == "completed",
        )
        .order_by(DailyTask.completed_at.asc(), DailyTask.created_at.asc())
        .all()
    )
    out = []
    for row in rows:
        out.append({
            "title": row.title,
            "kind": row.kind,
            "amount": _task_amount(row),
            "reason": (row.description or "").strip(),
        })
    return out


def needs_refill(db: Session) -> bool:
    if not get_active_goal(db):
        return False
    if is_day_closed(db):
        return False
    usage = _today_usage(db)
    return usage["assigned"] > 0 and usage["pending"] == 0


def refill_running() -> bool:
    return not _refill_idle.is_set()


def _do_refill() -> int:
    db = SessionLocal()
    try:
        expire_overdue_tasks(db)
        if not needs_refill(db):
            return 0
        assigned = 0
        try:
            from ..agents.task_agent import run_task_agent_sync

            assigned = run_task_agent_sync(is_refill=True)
        except Exception:
            logger.warning("完成后再评估失败", exc_info=True)
            return 0
        db.expire_all()
        if assigned <= 0 and needs_refill(db):
            set_day_closed(db, True)
        return assigned
    finally:
        db.close()


def start_refill_async() -> None:
    """一轮全部完成后，后台再问任务 Agent 要不要继续派。"""
    with _refill_lock:
        if refill_running():
            return
        db = SessionLocal()
        try:
            ready = needs_refill(db)
        finally:
            db.close()
        if not ready:
            return
        _refill_idle.clear()

    def _run() -> None:
        try:
            _do_refill()
        finally:
            _refill_idle.set()

    threading.Thread(target=_run, daemon=True, name="task-refill").start()


def wait_refill(timeout: float = 90) -> None:
    start_refill_async()
    _refill_idle.wait(timeout=timeout)


def _add_task(
    db: Session,
    *,
    goal_id: Optional[str],
    kind: str,
    checker: str,
    title: str,
    description: str,
    payload: dict[str, Any],
) -> Optional[DailyTask]:
    today = _today()
    fp = fingerprint(checker, payload)
    exists = (
        db.query(DailyTask)
        .filter(
            DailyTask.user_id == USER_ID,
            DailyTask.for_date == today,
            DailyTask.fingerprint == fp,
        )
        .first()
    )
    if exists:
        return None
    row = DailyTask(
        user_id=USER_ID,
        goal_id=goal_id,
        for_date=today,
        title=title,
        description=description,
        kind=kind,
        payload_json=json.dumps(payload, ensure_ascii=False),
        checker=checker,
        fingerprint=fp,
        status="pending",
        href=href_for(kind, payload),
        due_at=_due_at(today),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def collect_task_candidates(db: Session) -> list[dict[str, Any]]:
    """程序列出可派动作和资料里实际有的页/题；条数和每条做多少由 Agent 自己定。"""
    expire_overdue_tasks(db)
    today = _today()
    existing_fp = {
        row.fingerprint
        for row in db.query(DailyTask).filter(DailyTask.user_id == USER_ID, DailyTask.for_date == today)
    }

    goal = get_active_goal(db)
    goal_id = goal.id if goal else None
    out: list[dict[str, Any]] = []
    gen_page_cap = max(1, config.question_gen_max_pages)

    def _pack(
        cid: str,
        kind: str,
        checker: str,
        payload: dict[str, Any],
        title: str,
        reason: str,
        gap: str,
        *,
        min_quantity: int,
        max_quantity: int,
        default_quantity: int,
        unit: str,
    ) -> None:
        fp = fingerprint(checker, payload)
        if fp in existing_fp:
            return
        if max_quantity < min_quantity:
            return
        out.append({
            "id": cid,
            "kind": kind,
            "checker": checker,
            "payload": payload,
            "fallback_title": title,
            "fallback_reason": reason,
            "gap": gap,
            "goal_id": goal_id,
            "fingerprint": fp,
            "min_quantity": min_quantity,
            "max_quantity": max_quantity,
            "default_quantity": default_quantity,
            "unit": unit,
        })

    docs = _study_docs(db)
    if not docs:
        _pack(
            "upload",
            "upload",
            "upload",
            {},
            "先上传一份学习资料",
            "还没有能解析的书，有资料才能出题和刷题。",
            "学习区没有可用文档",
            min_quantity=1,
            max_quantity=1,
            default_quantity=1,
            unit="份",
        )
        return out

    for doc in docs[:8]:
        pages = _page_numbers(doc)
        have_q = _pages_with_questions(db, doc.id)
        missing = [n for n in pages if n not in have_q]
        stats = _doc_question_stats(db, doc.id)

        if missing:
            picked = missing[:gen_page_cap]
            n = len(picked)
            if n:
                _pack(
                    f"gen-{doc.id}",
                    "generate",
                    "generate_pages",
                    {
                        "document_id": doc.id,
                        "page_numbers": picked,
                        "need": n,
                        "baseline_have_count": len(have_q),
                    },
                    f"给《{doc.display_name}》出题",
                    f"还有 {len(missing)} 页没题。",
                    (
                        f"《{doc.display_name}》{len(pages)} 页，已出题 {len(have_q)} 页，"
                        f"缺 {len(missing)} 页；这一次最多可派 {n} 页（出题引擎单次上限）"
                    ),
                    min_quantity=1,
                    max_quantity=n,
                    default_quantity=n,
                    unit="页",
                )

        pool, label = _pick_quiz_pool(stats)
        if pool:
            n = len(pool)
            _pack(
                f"quiz-{doc.id}",
                "quiz",
                "quiz_n",
                {
                    "document_id": doc.id,
                    "question_ids": pool,
                    "need": n,
                    "filter": label,
                },
                f"刷《{doc.display_name}》的{label}题",
                f"交了就算，含「我不会」。不用全对。",
                (
                    f"《{doc.display_name}》题 {len(stats['question_ids'])}："
                    f"未做 {len(stats['undone'])} / 不会 {len(stats['unknown'])} / "
                    f"错 {len(stats['wrong'])} / 对 {stats['correct']}；今日优先{label}，池子 {n} 道"
                ),
                min_quantity=1,
                max_quantity=n,
                default_quantity=n,
                unit="题",
            )
    return out


def apply_candidate_quantity(cand: dict[str, Any], quantity: Optional[int]) -> dict[str, Any]:
    """按 Agent 选定的数量裁切 payload（题号/页码仍来自程序列表）。"""
    payload = dict(cand.get("payload") or {})
    lo = int(cand.get("min_quantity") or 1)
    hi = int(cand.get("max_quantity") or lo)
    default = int(cand.get("default_quantity") or lo)
    n = default if not quantity else int(quantity)
    n = max(lo, min(hi, n))
    kind = cand.get("kind")
    if kind == "quiz":
        ids = list(payload.get("question_ids") or [])[:n]
        payload["question_ids"] = ids
        payload["need"] = min(n, len(ids))
    elif kind == "generate":
        pages = list(payload.get("page_numbers") or [])[:n]
        payload["page_numbers"] = pages
        payload["need"] = len(pages)
    return payload


def task_agent_context(db: Session, *, is_refill: bool = False) -> dict[str, Any]:
    expire_overdue_tasks(db)
    goal = get_active_goal(db)
    usage = _today_usage(db)
    docs = _study_docs(db)
    books = []
    for doc in docs[:12]:
        pages = _page_numbers(doc)
        have_q = _pages_with_questions(db, doc.id)
        stats = _doc_question_stats(db, doc.id)
        books.append({
            "document_id": doc.id,
            "name": doc.display_name,
            "pages": len(pages),
            "pages_with_questions": len(have_q),
            "question_count": len(stats["question_ids"]),
            "undone": len(stats["undone"]),
            "unknown": len(stats["unknown"]),
            "wrong": len(stats["wrong"]),
            "correct": stats["correct"],
        })

    history_rows = list_task_history(db, days=14)
    by_day: dict[str, dict[str, Any]] = {}
    for row in history_rows:
        key = row.for_date.isoformat()
        bucket = by_day.setdefault(
            key,
            {"date": key, "assigned": 0, "completed": 0, "expired": 0, "pending": 0, "items": []},
        )
        bucket["assigned"] += 1
        bucket[row.status] = bucket.get(row.status, 0) + 1
        bucket["items"].append({"title": row.title, "kind": row.kind, "status": row.status})
    history = [by_day[k] for k in sorted(by_day.keys(), reverse=True)]

    last7 = [h for h in history if h["date"] >= (_today() - timedelta(days=7)).isoformat()]
    assigned7 = sum(h["assigned"] for h in last7)
    completed7 = sum(h["completed"] for h in last7)
    expired7 = sum(h["expired"] for h in last7)
    rate7 = round(completed7 / assigned7, 2) if assigned7 else None

    pending = [t for t in list_today_tasks(db) if t.status == "pending"]
    today_done = _today_done_items(db)

    study_min = 0
    quiz_min = 0
    weak_tags: list[dict[str, Any]] = []
    try:
        from .analytics import analytics_service

        act = analytics_service.get_activity(db)
        study_min = int(round((act.get("today_active_seconds") or 0) / 60))
        quiz_min = int(round((act.get("today_quiz_seconds") or 0) / 60))
        tags = analytics_service.get_tag_stats(db).get("by_tag") or []
        weak = [
            t for t in tags
            if (t.get("total_attempts") or 0) >= 3 and (t.get("accuracy_rate") or 1) < 0.6
        ]
        weak.sort(key=lambda t: (t.get("accuracy_rate") or 0, -(t.get("wrong_count") or 0)))
        weak_tags = [
            {
                "tag": t.get("tag"),
                "accuracy_pct": int(round((t.get("accuracy_rate") or 0) * 100)),
                "wrong": t.get("wrong_count"),
                "attempts": t.get("total_attempts"),
            }
            for t in weak[:8]
        ]
    except Exception:
        logger.debug("任务 Agent 附加学情读取失败", exc_info=True)

    return {
        "is_refill": is_refill,
        "goal_text": goal.text if goal else "",
        "valid_until": str(goal.valid_until) if goal and goal.valid_until else "",
        "books": books,
        "history": history[:14],
        "completion_rate_7d": rate7,
        "expired_7d": expired7,
        "completed_7d": completed7,
        "assigned_7d": assigned7,
        "pending_titles": [t.title for t in pending],
        "pending_count": len(pending),
        "today_assigned": usage["assigned"],
        "today_completed": usage["completed"],
        "today_quiz_need": usage["quiz_need"],
        "today_gen_pages": usage["gen_pages"],
        "today_done": today_done,
        "today_study_minutes": study_min,
        "today_quiz_minutes": quiz_min,
        "weak_tags": weak_tags,
    }


def _fallback_assign(db: Session) -> int:
    """Agent 一题没派时：只补最急的一条缺口。"""
    for cand in collect_task_candidates(db):
        payload = apply_candidate_quantity(cand, cand.get("default_quantity"))
        added = _add_task(
            db,
            goal_id=cand.get("goal_id"),
            kind=cand["kind"],
            checker=cand["checker"],
            title=cand["fallback_title"],
            description=cand["fallback_reason"],
            payload=payload,
        )
        if added:
            return 1
    return 0


def ensure_today_tasks(db: Session, *, force: bool = False) -> list[DailyTask]:
    expire_overdue_tasks(db)
    if not get_active_goal(db):
        return list_today_tasks(db)

    if force and is_day_closed(db):
        set_day_closed(db, False)

    usage = _today_usage(db)
    if usage["assigned"] == 0 or force:
        assigned = 0
        refill = usage["assigned"] > 0 and usage["pending"] == 0
        try:
            from ..agents.task_agent import run_task_agent_sync

            assigned = run_task_agent_sync(is_refill=refill)
        except Exception:
            logger.warning("任务 Agent 失败，回退规则派发", exc_info=True)

        db.expire_all()
        if assigned <= 0 and _today_usage(db)["assigned"] == 0:
            _fallback_assign(db)
        elif assigned <= 0 and refill and needs_refill(db):
            set_day_closed(db, True)
        return list_today_tasks(db)

    if needs_refill(db):
        wait_refill()
        db.expire_all()
    return list_today_tasks(db)


def _evidence_for(db: Session, task: DailyTask) -> Optional[dict[str, Any]]:
    if task.checker == "upload":
        return _check_upload(db, task)
    if task.checker == "generate_pages":
        return _check_generate(db, task)
    if task.checker == "quiz_n":
        return _check_quiz(db, task)
    return None


def _mark_completed(task: DailyTask, evidence: dict[str, Any]) -> None:
    task.status = "completed"
    task.completed_at = _now()
    task.evidence_json = json.dumps(evidence, ensure_ascii=False)


def _check_upload(db: Session, task: DailyTask) -> Optional[dict[str, Any]]:
    docs = (
        db.query(Document)
        .filter(Document.zone == "study", Document.indexing_status == "completed")
        .all()
    )
    for doc in docs:
        parsed = storage.read_parsed(doc.id) or ""
        if parsed.strip():
            return {"document_id": doc.id}
    return None


def _check_generate(db: Session, task: DailyTask) -> Optional[dict[str, Any]]:
    payload = _loads(task.payload_json)
    doc_id = payload.get("document_id")
    need = int(payload.get("need") or len(payload.get("page_numbers") or []) or 0)
    if not doc_id or need <= 0:
        return None
    have = _pages_with_questions(db, str(doc_id))
    have_n = len(have)
    if "baseline_have_count" in payload:
        base = int(payload.get("baseline_have_count") or 0)
        if have_n >= base + need:
            return {"document_id": doc_id, "pages_with_questions": have_n, "need": need}
        return None
    if have_n >= need:
        return {"document_id": doc_id, "pages_with_questions": have_n, "need": need}
    return None


def _check_quiz(db: Session, task: DailyTask) -> Optional[dict[str, Any]]:
    payload = _loads(task.payload_json)
    qids = payload.get("question_ids") or []
    need = int(payload.get("need") or len(qids) or 0)
    if not qids:
        return None
    since = task.created_at
    if since is not None and since.tzinfo is not None:
        since = since.replace(tzinfo=None)
    q = db.query(QuizAnswer.question_id).filter(QuizAnswer.question_id.in_(qids))
    if since is not None:
        q = q.filter(QuizAnswer.answered_at >= since)
    answered = q.distinct().all()
    n = len({row[0] for row in answered})
    if n >= min(need, len(qids)):
        return {"answered": n}
    return None


def evaluate(db: Session) -> list[dict[str, str]]:
    """扫描未完成任务（含已恢复、宽限期内的过去任务），命中则标完成。"""
    db.expire_all()
    expire_overdue_tasks(db)
    newly: list[dict[str, str]] = []
    rows = (
        db.query(DailyTask)
        .filter(DailyTask.user_id == USER_ID, DailyTask.status == "pending")
        .all()
    )
    for task in rows:
        evidence = _evidence_for(db, task)
        if not evidence:
            continue
        _mark_completed(task, evidence)
        newly.append({"id": task.id, "title": task.title})
    if newly:
        db.commit()
    if needs_refill(db):
        start_refill_async()
    return newly


def restore_task(db: Session, task_id: str) -> tuple[DailyTask, list[dict[str, str]]]:
    """把超时任务拉回 pending，宽限到今天结束，并立刻检查是否已经做完。"""
    expire_overdue_tasks(db)
    row = (
        db.query(DailyTask)
        .filter(DailyTask.user_id == USER_ID, DailyTask.id == task_id)
        .first()
    )
    if not row:
        raise LookupError("任务不存在")
    if row.status == "completed":
        return row, []
    if row.status != "expired":
        raise ValueError("只有超时的任务可以恢复")
    row.status = "pending"
    row.expired_at = None
    row.due_at = _due_at(_today())
    db.flush()
    newly: list[dict[str, str]] = []
    evidence = _evidence_for(db, row)
    if evidence:
        _mark_completed(row, evidence)
        newly.append({"id": row.id, "title": row.title})
    db.commit()
    db.refresh(row)
    return row, newly


def history_bundle(db: Session, *, days: int = 60) -> dict[str, Any]:
    newly = evaluate(db)
    rows = list_task_history(db, days=days)
    return {
        "tasks": [task_out(t) for t in rows],
        "completed_tasks": newly or None,
    }


def today_bundle(db: Session) -> dict[str, Any]:
    from .profile import get_or_create_profile

    newly = evaluate(db)
    goal = get_active_goal(db)
    tasks = [task_out(t) for t in list_today_tasks(db)]
    profile = get_or_create_profile(db)
    pending = sum(1 for t in tasks if t["status"] == "pending")
    closed = is_day_closed(db)
    return {
        "goal": goal_out(goal) if goal else None,
        "tasks": tasks,
        "pending_count": pending,
        "expired_count": sum(1 for t in tasks if t["status"] == "expired"),
        "onboarding_session_id": profile.onboarding_session_id,
        "completed_tasks": newly or None,
        "day_complete": bool(closed and pending == 0 and tasks),
        "refill_pending": bool(not closed and (refill_running() or needs_refill(db))),
    }
