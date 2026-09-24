"""鉴权服务：单账号密码校验 + 服务端会话。

- 密码用标准库 hashlib.scrypt 加盐哈希（零额外依赖）
- 会话令牌只把 sha256 哈希落库，Cookie 里放原始随机串；登出即删，可撤销
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import AuthSession, AuthUser

logger = logging.getLogger(__name__)

SESSION_COOKIE = "zhishi_session"
SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 天
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

# 登录失败限流：key -> [失败次数, 首次失败时间, 锁定到期时间]
_FAILS: dict[str, list[float]] = {}
_MAX_FAILS = 8
_FAIL_WINDOW = 10 * 60
_LOCK_SECONDS = 30


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---- 密码 ----

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT["n"],
        _SCRYPT["r"],
        _SCRYPT["p"],
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, hash_b64 = (stored or "").split("$")
        if algo != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# ---- 账号 ----

def get_user(db: Session) -> Optional[AuthUser]:
    return db.query(AuthUser).order_by(AuthUser.created_at.asc()).first()


def is_configured(db: Session) -> bool:
    return db.query(AuthUser.id).first() is not None


def create_user(db: Session, username: str, password: str) -> AuthUser:
    user = AuthUser(username=username.strip()[:64], password_hash=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, username: str, password: str) -> Optional[AuthUser]:
    user = (
        db.query(AuthUser)
        .filter(AuthUser.username == (username or "").strip())
        .first()
    )
    if user and user.is_active and verify_password(password, user.password_hash):
        return user
    return None


# ---- 登录限流 ----

def login_locked(key: str) -> int:
    """返回剩余锁定秒数；未锁定返回 0。"""
    rec = _FAILS.get(key)
    if not rec:
        return 0
    remaining = int(rec[2] - time.time())
    if remaining > 0:
        return remaining
    if time.time() - rec[1] > _FAIL_WINDOW:
        _FAILS.pop(key, None)
    return 0


def record_login_failure(key: str) -> None:
    now = time.time()
    rec = _FAILS.get(key)
    if not rec or now - rec[1] > _FAIL_WINDOW:
        _FAILS[key] = [1, now, 0.0]
        return
    rec[0] += 1
    if rec[0] >= _MAX_FAILS:
        rec[2] = now + _LOCK_SECONDS


def clear_login_failures(key: str) -> None:
    _FAILS.pop(key, None)


# ---- 会话 ----

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: AuthUser) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=_token_hash(token),
            user_id=user.id,
            expires_at=_utcnow_naive() + timedelta(seconds=SESSION_TTL_SECONDS),
        )
    )
    db.commit()
    return token


def resolve_session(db: Session, token: Optional[str]) -> Optional[AuthUser]:
    if not token:
        return None
    sess = db.get(AuthSession, _token_hash(token))
    if sess is None:
        return None
    if sess.expires_at and sess.expires_at < _utcnow_naive():
        db.delete(sess)
        db.commit()
        return None
    user = db.get(AuthUser, sess.user_id)
    return user if user and user.is_active else None


def delete_session(db: Session, token: Optional[str]) -> None:
    if not token:
        return
    sess = db.get(AuthSession, _token_hash(token))
    if sess is not None:
        db.delete(sess)
        db.commit()
