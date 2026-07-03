"""LEKT 服务访问 — 通过 FastAPI app.state，避免 server 循环导入。"""

from fastapi import Request


def get_lekt(request: Request):
    return request.app.state.lekt
