# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller：无窗口后端 zhishi-backend.exe

构建（在仓库根目录）:
  .venv\\Scripts\\python.exe -m pip install pyinstaller
  cd frontend && npm run build && cd ..
  .venv\\Scripts\\pyinstaller.exe backend/packaging/zhishi-backend.spec --noconfirm

产物: desktop/zhishi-backend/zhishi-backend.exe
"""

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

SPECDIR = Path(SPEC).resolve().parent  # type: ignore[name-defined]
BACKEND = SPECDIR.parent
REPO = BACKEND.parent
FRONTEND_DIST = REPO / "frontend" / "dist"
OUT = REPO / "desktop" / "zhishi-backend"

datas = [
    (str(BACKEND / "prompts"), "prompts"),
    (str(BACKEND / "config.yml"), "."),
    (str(BACKEND / "tina.env.example"), "."),
]
if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file():
    datas.append((str(FRONTEND_DIST), "frontend_dist"))

binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "sqlalchemy.dialects.sqlite",
]

for pkg in ("chromadb", "sentence_transformers", "tina"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        hiddenimports += collect_submodules(pkg)

try:
    datas += collect_data_files("jinja2")
except Exception:
    pass

# tina wheel 本地路径
for whl_hint in (BACKEND / "3rdParty").glob("tina_python*.whl"):
    pass  # 已通过 pip 安装进 venv，collect_all(tina) 即可

a = Analysis(
    [str(BACKEND / "packaging" / "desktop_entry.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest", "IPython"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="zhishi-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # 由 Electron windowsHide 藏窗；保留 stdout 供设置页查看
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="zhishi-backend",
)

# 将 COLLECT 默认 dist 挪到 desktop/（见 build 脚本）
