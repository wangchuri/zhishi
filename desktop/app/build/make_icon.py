"""从 frontend/public/logo.png 生成 electron-builder 需要的 build/icon.ico。

用法（在 desktop/app 下）：
    npm run icon
或：
    ..\\..\\.venv\\Scripts\\python.exe build/make_icon.py
"""

from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parent.parent  # desktop/app
REPO = APP.parent.parent  # 仓库根
src = REPO / "frontend" / "public" / "logo.png"
dst = APP / "build" / "icon.ico"

if not src.is_file():
    raise SystemExit(f"找不到图标源文件：{src}")

img = Image.open(src).convert("RGBA")
# 补成正方形（透明底），否则小尺寸会变形
side = max(img.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
dst.parent.mkdir(parents=True, exist_ok=True)
canvas.save(dst, format="ICO", sizes=sizes)
print(f"{src.name} ({img.width}x{img.height}) -> {dst} ({dst.stat().st_size / 1024:.1f} KB)")
