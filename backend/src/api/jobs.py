"""通用后台作业查询：进度与结果。

长活一律「立刻返回 + 后台跑 + 前端轮询这里」，而不是让请求干等（会被 nginx 掐断）。
"""

from fastapi import APIRouter, HTTPException, Query

from ..services.jobs import jobs

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("")
def list_jobs(
    active: bool = Query(False, description="只看排队中/进行中的"),
    limit: int = Query(50, ge=1, le=200),
):
    return {"jobs": jobs.list_jobs(active_only=active, limit=limit)}


@router.get("/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "作业不存在或已过期")
    return job
