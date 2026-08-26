"""桌面打包入口：无控制台窗口启动知拾后端。"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _prepare_path() -> None:
    # 开发时本文件在 backend/packaging/；冻结后由 PyInstaller 注入
    if getattr(sys, "frozen", False):
        return
    backend = Path(__file__).resolve().parent.parent
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


def main() -> None:
    os.environ.setdefault("ZHISHI_DESKTOP", "1")
    _prepare_path()
    from src.main import main as run

    run()


if __name__ == "__main__":
    main()
