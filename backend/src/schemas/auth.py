"""鉴权请求 / 响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class AuthCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class AuthSetup(AuthCredentials):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
