"""通用后台作业：一个有界 worker + 一张进程内 job 表。

为什么要有这一层
- 长活不能在请求里等：nginx 到点会掐断，用户看到 502/504，却以为活儿失败；
- 也不能"随用随开裸线程"（原来的 `_spawn_background` 就是）：
  · 没有并发上限 → 同时点几个大活，内存和 SQLite 写会被一起拖垮；
  · 没有可见性 → 用户不知道到底在不在跑；
  · 没有取消；
  · 进程重启即丢（这点由各业务自己的恢复逻辑兜，例如 kb 的启动重新入队）。

两种用法
1) 只要"别阻塞事件循环 + 限并发"（替代裸线程，fire-and-forget）：
       jobs.spawn(fn, *args)
2) 还要"能查进度/结果"（新增长活一律用这个）：
       jobs.submit_task("parse", fn, args=(doc_id,), title="《xx》", document_id=doc_id,
                        key=f"parse:{doc_id}")
       jobs.submit("import", worker, title=..., key=...)   # worker(job) -> dict|None

约定
- 进程内存储，重启即丢；完成/失败/取消的记录保留 ttl_seconds 后清理。
- `key` 相同且仍在排队/运行 → 不重复提交，直接返回已有 job（防连点、防重复重试）。
- `spawn` 只进池子不建记录；`submit*` 两者都做。
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

logger = logging.getLogger(__name__)

# 默认并发：宁可小。解析/向量化这类活会吃满 CPU 与磁盘，串行一点更稳。
JOB_MAX_WORKERS = max(1, int(os.environ.get("ZHISHI_JOB_WORKERS") or 3))
JOB_TTL_SECONDS = max(60, int(os.environ.get("ZHISHI_JOB_TTL_SECONDS") or 1800))

_ACTIVE = ("queued", "running")
_TERMINAL = ("done", "failed", "cancelled")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Job:
    """交给 worker 的句柄：只暴露 id 和上报口，防止 worker 直接改内部状态。"""

    __slots__ = ("_mgr", "id")

    def __init__(self, mgr: "JobManager", job_id: str) -> None:
        self._mgr = mgr
        self.id = job_id

    def report(self, *, message: str | None = None, progress: float | None = None) -> None:
        """worker 线程里上报进度（message 给用户看，progress 0~1 选填）。"""
        self._mgr._update(self.id, message=message, progress=progress)


class JobManager:
    def __init__(
        self,
        max_workers: int = JOB_MAX_WORKERS,
        ttl_seconds: int = JOB_TTL_SECONDS,
    ) -> None:
        self.max_workers = max(1, int(max_workers))
        self.ttl_seconds = int(ttl_seconds)
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._futures: dict[str, Future] = {}
        self._pool = ThreadPoolExecutor(
            max_workers=self.max_workers, thread_name_prefix="zhishi-job"
        )

    # ---------- 提交 ----------

    def spawn(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        """丢进有界线程池，不建 job 记录；异常只记日志，不影响其它作业。"""
        self._pool.submit(self._guard(fn), *args, **kwargs)

    def submit_task(
        self,
        kind: str,
        fn: Callable[..., Any],
        *,
        args: tuple = (),
        kwargs: dict | None = None,
        title: str = "",
        document_id: str | None = None,
        key: str | None = None,
    ) -> dict:
        """提交一个普通可调用（迁移既有长活用）。"""

        def _work(_job: Job) -> Any:
            return fn(*args, **(kwargs or {}))

        return self.submit(kind, _work, title=title, document_id=document_id, key=key)

    def submit(
        self,
        kind: str,
        worker: Callable[[Job], Any],
        *,
        title: str = "",
        document_id: str | None = None,
        key: str | None = None,
    ) -> dict:
        """提交一个 worker(job)；worker 可用 job.report(...) 上报进度。"""
        job, created = self._create(kind, title, document_id, key)
        if not created:
            return job
        with self._lock:
            self._futures[job["id"]] = self._pool.submit(self._run, job["id"], worker)
        return job

    # ---------- 查询 / 取消 ----------

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return self._public(job) if job else None

    def list_jobs(self, *, active_only: bool = False, limit: int = 50) -> list[dict]:
        with self._lock:
            self._cleanup_locked()
            rows = [j for j in self._jobs.values() if not active_only or j["status"] in _ACTIVE]
            rows.sort(key=lambda j: j["created_at"], reverse=True)
            return [self._public(j) for j in rows[: max(1, limit)]]

    def cancel(self, job_id: str) -> bool:
        """只在还没轮到执行时能真取消（线程已开跑就取消不了）。"""
        with self._lock:
            fut = self._futures.get(job_id)
        if fut is not None and fut.cancel():
            self._update(job_id, status="cancelled", message="已取消")
            with self._lock:
                self._futures.pop(job_id, None)
            return True
        return False

    # ---------- 内部 ----------

    def _create(
        self,
        kind: str,
        title: str,
        document_id: str | None,
        key: str | None,
    ) -> tuple[dict, bool]:
        with self._lock:
            self._cleanup_locked()
            if key:
                for existing in self._jobs.values():
                    if existing.get("key") == key and existing["status"] in _ACTIVE:
                        return self._public(existing), False
            job_id = uuid.uuid4().hex[:12]
            job: dict[str, Any] = {
                "id": job_id,
                "kind": kind,
                "title": title or kind,
                "document_id": document_id,
                "key": key,
                "status": "queued",
                "message": "排队中…",
                "progress": None,
                "result": None,
                "error": None,
                "created_at": _now(),
                "updated_at": _now(),
            }
            self._jobs[job_id] = job
            return self._public(job), True

    def _run(self, job_id: str, worker: Callable[[Job], Any]) -> None:
        self._update(job_id, status="running", message="进行中…")
        try:
            result = worker(Job(self, job_id))
            self._update(
                job_id,
                status="done",
                message="完成",
                progress=1.0,
                result=result if isinstance(result, dict) else None,
            )
        except Exception as exc:  # noqa: BLE001 — 作业失败不能影响进程
            logger.warning("作业失败 job=%s kind 见 job 表: %s", job_id, exc, exc_info=True)
            self._update(
                job_id,
                status="failed",
                message="失败",
                error=f"{type(exc).__name__}: {exc}",
            )
        finally:
            with self._lock:
                self._futures.pop(job_id, None)

    def _guard(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        def _wrapped(*args: Any, **kwargs: Any) -> None:
            try:
                fn(*args, **kwargs)
            except Exception:  # noqa: BLE001
                logger.warning("后台任务异常：%s", getattr(fn, "__name__", fn), exc_info=True)

        return _wrapped

    def _update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for name, value in fields.items():
                if value is not None:
                    job[name] = value
            job["updated_at"] = _now()

    def _cleanup_locked(self) -> None:
        if not self._jobs:
            return
        cutoff = _now() - timedelta(seconds=self.ttl_seconds)
        stale = [
            jid
            for jid, job in self._jobs.items()
            if job["status"] in _TERMINAL and job["updated_at"] < cutoff
        ]
        for jid in stale:
            self._jobs.pop(jid, None)

    def _public(self, job: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in job.items() if k != "key"}
        for field in ("created_at", "updated_at"):
            value = out.get(field)
            if isinstance(value, datetime):
                out[field] = value.isoformat()
        return out


# 模块级单例：全项目共用一个有界池
jobs = JobManager()
