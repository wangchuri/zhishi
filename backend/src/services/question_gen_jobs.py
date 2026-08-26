"""出题 Agent 进行中的任务（进程内，供题库页轮询 / WebSocket 旁路观看）。"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_PUBLIC_KEYS = (
    "id",
    "document_id",
    "document_name",
    "status",
    "page_numbers",
    "questions_per_page",
    "submitted",
    "total_cap",
    "max_concurrency",
    "agents",
    "started_at",
)

_EVENT_BUFFER = 2500


def _public_job(job: dict) -> dict:
    out = {k: job[k] for k in _PUBLIC_KEYS if k in job}
    agents = job.get("agents") or {}
    if isinstance(agents, dict):
        out["agents"] = [dict(v) for v in agents.values()]
    return out


def _put_nowait(queue: asyncio.Queue, item: dict) -> None:
    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        try:
            queue.get_nowait()
            queue.put_nowait(item)
        except Exception:
            pass


class QuestionGenJobs:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(
        self,
        *,
        document_id: str,
        document_name: str,
        page_numbers: list[int],
        questions_per_page: int,
        total_cap: int,
        max_concurrency: int = 1,
    ) -> str:
        job_id = uuid.uuid4().hex
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            self._loop = loop
        with self._lock:
            stale = [i for i, j in self._jobs.items() if j.get("status") == "done"]
            for i in stale:
                self._jobs.pop(i, None)
            self._jobs[job_id] = {
                "id": job_id,
                "document_id": document_id,
                "document_name": document_name,
                "status": "running",
                "page_numbers": list(page_numbers),
                "questions_per_page": questions_per_page,
                "submitted": 0,
                "total_cap": total_cap,
                "max_concurrency": max(1, int(max_concurrency)),
                "agents": {},
                "started_at": datetime.now(timezone.utc).isoformat(),
                "events": deque(maxlen=_EVENT_BUFFER),
                "subscribers": set(),
                "loop": loop,
            }
        return job_id

    def update_submitted(self, job_id: str, submitted: int) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job["submitted"] = int(submitted)

    def upsert_agent(
        self,
        job_id: str,
        agent_id: str,
        *,
        page: int | None = None,
        status: str | None = None,
        submitted: int | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            agents: dict = job.setdefault("agents", {})
            rec = agents.setdefault(agent_id, {"id": agent_id})
            rec["id"] = agent_id
            if page is not None:
                rec["page"] = int(page)
            if status is not None:
                rec["status"] = status
            if submitted is not None:
                rec["submitted"] = int(submitted)

    def emit(self, job_id: str, event: dict[str, Any]) -> None:
        """写入环形缓冲并广播给 WebSocket 订阅者。同步/异步线程都可调用。"""
        payload = dict(event)
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job["events"].append(payload)
            if "submitted" in payload:
                job["submitted"] = int(payload["submitted"])
            queues = list(job.get("subscribers") or [])
            loop = job.get("loop") or self._loop
        for q in queues:
            try:
                if loop is not None and loop.is_running():
                    loop.call_soon_threadsafe(_put_nowait, q, payload)
                else:
                    _put_nowait(q, payload)
            except Exception:
                logger.debug("question_gen job emit 跳过失效订阅", exc_info=True)

    def subscribe(self, job_id: str):
        """返回 (snapshot, replay, queue)；任务不存在则 None。"""
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            job.setdefault("subscribers", set()).add(queue)
            replay = [dict(e) for e in job.get("events") or []]
            snapshot = _public_job(job)
        return snapshot, replay, queue

    def unsubscribe(self, job_id: str, queue: asyncio.Queue) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            subs = job.get("subscribers")
            if subs is not None:
                subs.discard(queue)

    def finish(self, job_id: str, result: dict | None = None) -> None:
        extra = dict(result or {})
        submitted = extra.get("total_questions")
        with self._lock:
            job = self._jobs.get(job_id)
            if job and submitted is None:
                submitted = job.get("submitted", 0)
        payload = {"event": "done", "submitted": submitted, **extra}
        self.emit(job_id, payload)
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job["status"] = "done"
                job["submitted"] = int(submitted or 0)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return _public_job(job) if job else None

    def list_running(self) -> list[dict]:
        with self._lock:
            return [
                _public_job(j)
                for j in self._jobs.values()
                if j.get("status") == "running"
            ]


question_gen_jobs = QuestionGenJobs()
