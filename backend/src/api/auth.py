"""鉴权 API：单账号 status / setup / login / logout / me。

- `/auth/status|setup|login` 是公开接口（main.py 的中间件白名单）
- 其余 `/api/v1/*` 由中间件校验会话，未登录返回 401
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas import auth as auth_schemas
from ..services import auth as auth_service

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _request_is_secure(request: Request) -> bool:
    """反代后面按 X-Forwarded-Proto 判断是否 HTTPS，决定 Cookie 是否加 Secure。"""
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    if proto:
        return proto == "https"
    return request.url.scheme == "https"


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key=auth_service.SESSION_COOKIE,
        value=token,
        max_age=auth_service.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_request_is_secure(request),
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=auth_service.SESSION_COOKIE, path="/")


def _client_key(request: Request, username: str) -> str:
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    ip = fwd or (request.client.host if request.client else "") or "unknown"
    return f"{ip}:{(username or '').strip().lower()}"


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    user = getattr(request.state, "user", None)
    return {
        "configured": auth_service.is_configured(db),
        "authenticated": user is not None,
        "username": getattr(user, "username", None),
    }


@router.post("/setup")
def setup(
    body: auth_schemas.AuthSetup,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """首次初始化管理员账号；已初始化则不允许再调。"""
    if auth_service.is_configured(db):
        raise HTTPException(status_code=400, detail="账号已初始化，请直接登录")
    user = auth_service.create_user(db, body.username, body.password)
    token = auth_service.create_session(db, user)
    _set_session_cookie(response, request, token)
    return {"ok": True, "username": user.username}


@router.post("/login")
def login(
    body: auth_schemas.AuthCredentials,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    key = _client_key(request, body.username)
    locked = auth_service.login_locked(key)
    if locked > 0:
        raise HTTPException(status_code=429, detail=f"尝试过于频繁，请 {locked} 秒后再试")

    user = auth_service.authenticate(db, body.username, body.password)
    if not user:
        auth_service.record_login_failure(key)
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    auth_service.clear_login_failures(key)
    token = auth_service.create_session(db, user)
    _set_session_cookie(response, request, token)
    return {"ok": True, "username": user.username}


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    auth_service.delete_session(db, request.cookies.get(auth_service.SESSION_COOKIE))
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="未登录")
    return {"username": user.username}
