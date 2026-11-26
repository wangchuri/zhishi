# 知拾 桌面端（Electron 外壳）

Electron 只负责开窗口 + 拉起 Python 后端，**界面本身由后端托管**
（`main.js` 打包后 `loadURL(http://127.0.0.1:7777/)`）。

## 目录约定

```
desktop/
├── app/                    ← 本工程（进 git）
│   ├── package.json        dependencies 必须保持为空！
│   ├── electron-builder.yml
│   ├── electron/
│   │   ├── main.js         主进程：拉起后端、splash、日志 IPC
│   │   └── preload.js      暴露 window.zhishi
│   └── build/
│       ├── icon.ico        （gitignore，用 npm run icon 生成）
│       └── installer.nsh   卸载时问要不要删用户数据
├── app/release/win-unpacked/   ← electron-builder 产物（gitignore）
│   ├── Zhishi.exe
│   └── zhishi-backend/         ← 后端旁路目录（junction 或拷贝）
├── zhishi-backend/         ← PyInstaller 产物 + 用户数据（gitignore）
└── Zhishi/                 ← 旧的可分发目录（gitignore，历史遗留）
```

## 打包

```powershell
# 1) 前端产物（后端要托管它）
cd frontend; npm run build; cd ..

# 2) Python 后端
.venv\Scripts\python.exe -m PyInstaller backend\packaging\zhishi-backend.spec `
  --noconfirm --distpath desktop\_newbackend --workpath desktop\build
# 把 _newbackend\zhishi-backend\{zhishi-backend.exe,_internal} 覆盖到
# desktop\zhishi-backend\（保留 storage/ data/ tina.env）

# 3) Electron
cd desktop\app
npm install
npm run icon        # 从 frontend/public/logo.png 生成 build/icon.ico
npm run pack        # → release/win-unpacked/

# 4) 组装（开发时用 junction 省磁盘）
cmd /c mklink /J "release\win-unpacked\zhishi-backend" "..\..\zhishi-backend"
```

或直接跑 `backend/packaging/assemble_desktop.ps1`。

## 体积（2026-11 实测）

| 部分 | 体积 |
|---|---|
| Electron 壳（`Zhishi.exe` 180 + dll + locales 2 个） | 228.8 MB |
| 后端程序（`exe` 25.8 + `_internal` 262.8） | 288.6 MB |
| **合计** | **517.4 MB** |

优化前的 774.2 MB 是怎么来的、怎么砍掉的：

| 项 | 省 | 做法 |
|---|---|---|
| torch / transformers / scipy / sklearn / pandas | 4054 MB | spec 里别 `collect_all("sentence_transformers")`，加 excludes |
| `app.asar` 里的 node_modules + sourcemap | 102 MB | `dependencies: {}` + `files` 只留 `electron/**` |
| `locales` 55 个语言包 | 40 MB | `electronLanguages: [zh-CN, en-US]` |
| `zhishi-backend.exe` 的 PYZ 字节码 | 58 MB | 同上（PYZ 在 exe 内部，删 `_internal` 里的目录不会让它变小） |

## 踩过的坑

1. **`dependencies` 不能有内容**。曾经把 `frontend/package.json` 当成 Electron 应用配置，
   56 个前端包（102 MB）被塞进 `app.asar`。前端依赖已经打进 `dist/`，由后端托管，
   Electron 侧只有 `main.js` + `preload.js` 两个文件。

2. **`.venv` 建在 miniconda 上** → venv 里没有 `DLLs/`，PyInstaller 的 bindepend
   找不到 `libssl-3-x64.dll` 等，会**静默漏收**，打出来的 exe 一启动就
   `ImportError: DLL load failed while importing _ssl`。spec 里已按名字从
   `base_prefix/Library/bin` 补齐。

3. **端口要对齐**。`main.py` 读 `ZHISHI_PORT`（默认 17777），而 `main.js` 的
   `BACKEND_URL` 是 7777。启动后端时必须传 `ZHISHI_PORT=7777`（已在 `main.js` 里做）。

4. **winCodeSign 解压失败**：包里含 macOS 符号链接，Windows 普通权限建不了。
   用国内镜像下载后手动解压跳过 darwin：
   ```powershell
   $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
   # 下载到 %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*.7z 后：
   node_modules\7zip-bin\win\x64\7za.exe x <x>.7z "-o$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0" "-x!darwin" -y
   ```
   不做这步的话 exe 的图标和版本信息不会写进去（显示成 Electron 默认）。

5. **`electronDist: node_modules/electron/dist`**：不加这行 electron-builder 会
   每次从 GitHub 重下 115 MB 的 electron zip。

## 待办

- 向量模型（`~/.cache/zhishi/fastembed`，约 100 MB）现在是**首次用到时**才下载，
  第一次导入文档会卡住。计划改成应用启动后后台预热 + 设置页显示下载进度。
- `npm run dist`（NSIS 安装包）还没接：需要先把后端程序（不含 `storage/` `data/`）
  准备成干净目录，用 `extraFiles` 打进去。
