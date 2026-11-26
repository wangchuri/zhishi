# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller：无窗口后端 zhishi-backend.exe

构建（在仓库根目录）:
  .venv\\Scripts\\python.exe -m pip install pyinstaller
  cd frontend && npm run build && cd ..
  .venv\\Scripts\\pyinstaller.exe backend/packaging/zhishi-backend.spec --noconfirm

产物: desktop/zhishi-backend/zhishi-backend.exe
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

SPECDIR = Path(SPEC).resolve().parent  # type: ignore[name-defined]
BACKEND = SPECDIR.parent
REPO = BACKEND.parent
FRONTEND_DIST = REPO / "frontend" / "dist"
OUT = REPO / "desktop" / "zhishi-backend"

datas = [
    (str(BACKEND / "prompts"), "prompts"),
    # 只带模板，不带 config.yml：里面有 mineru_api_token 等本机配置，不能进安装包。
    # 缺 config.yml 时 config.py 会退回内置默认值，首次保存设置时自动生成。
    (str(BACKEND / "config.yml.example"), "."),
    (str(BACKEND / "tina.env.example"), "."),
]
if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file():
    datas.append((str(FRONTEND_DIST), "frontend_dist"))

binaries = []

# 本项目的 .venv 建在 miniconda 上（sys.base_prefix = ...\miniconda），venv 里没有
# DLLs/ 目录，PyInstaller 的 bindepend 因此找不到 _ssl / _sqlite3 / _lzma / pyexpat
# 依赖的 OpenSSL 等 DLL，会静默漏收 —— 打出来的 exe 一启动就
# "ImportError: DLL load failed while importing _ssl"。
# 这里按名字从 base_prefix 补齐（标准 CPython 在 DLLs/，conda 在 Library/bin/）。
_EXTRA_DLLS = (
    "libssl-3-x64.dll",
    "libcrypto-3-x64.dll",
    "sqlite3.dll",
    "liblzma.dll",
    "libexpat.dll",
    "LIBBZ2.dll",
    "ffi.dll",
    "VCOMP140.DLL",
    "MSVCP140_ATOMIC_WAIT.dll",
)
_DLL_DIRS = [
    Path(sys.base_prefix) / "Library" / "bin",
    Path(sys.base_prefix) / "DLLs",
    Path(sys.base_prefix),
]
for _name in _EXTRA_DLLS:
    for _dir in _DLL_DIRS:
        _candidate = _dir / _name
        if _candidate.is_file():
            binaries.append((str(_candidate), "."))
            break
    else:
        print(f"WARNING: 未找到 {_name}，打包后可能缺 DLL")

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

# 只收集真正需要的包。
# 千万不要收 sentence_transformers：它会把 torch / transformers / scipy / sklearn /
# pandas 整条链拉进 PYZ 和 _internal（实测 +4 GB，exe 也会从 ~18 MB 涨到 83 MB）。
# 嵌入走的是 fastembed（ONNX），chromadb 对 sentence_transformers 是延迟导入
# （sentence_transformer_embedding_function.py 里在 __init__ 内才 import），不收也安全。
for pkg in ("chromadb", "tina"):
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

a = Analysis(
    [str(BACKEND / "packaging" / "desktop_entry.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "pytest",
        "IPython",
        # 以下是 sentence-transformers 的连带依赖，本项目不用（嵌入走 fastembed/ONNX）
        "torch",
        "torchvision",
        "torchaudio",
        "transformers",
        "sentence_transformers",
        "scipy",
        "sklearn",
        "pandas",
        # opencv 只有独立安装的 MinerU 用，后端本体不 import
        "cv2",
    ],
    # 只能 1，不能 2：tina 靠工具函数的 docstring 生成 JSON Schema，
    # optimize=2 会剥掉 docstring，工具参数描述全空、模型调用会出错。
    optimize=1,
    noarchive=False,
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
