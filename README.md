# 知拾

个人学习助手：把资料放进库里，自动出题、刷题、苏格拉底式辅导，并由 Tina 按目标和学情派当天的学习任务。

本机单用户，无登录。后端 FastAPI，前端 React，对话走云端 DeepSeek。

## 环境

| 需要 | 建议 |
|------|------|
| Python | **3.12**（3.11 也可） |
| Node.js | **20 或 22**（带 npm） |
| 网络 | 装依赖、首次下载向量模型、调用 DeepSeek |
| GPU / CUDA | **不需要** |

对话和出题走的是 DeepSeek HTTP API，不在本机跑大模型。本地只有一个很小的中文嵌入模型（`bge-small-zh-v1.5`，给资料检索用），`pip` 装到的是 **CPU 版 PyTorch**，没有显卡也能用。有 NVIDIA 也不会自动装 CUDA 版；扫描件 PDF 若另装 MinerU，那才可能用到 GPU，且不是本仓库安装的一部分。

## 安装

在**仓库根目录**执行（不要先 `cd backend`）。

Windows：

```bat
install.bat
```

macOS / Linux：

```bash
bash install.sh
```

脚本会：创建 `.venv` → 在 `backend/` 里 `pip install`（tina-python 从 PyPI 安装）→ `frontend` 里 `npm ci` → 若还没有 `backend/tina.env` 则从 example 复制一份。

然后编辑 `backend/tina.env`，把 `LLM_API_KEY` 换成你的 DeepSeek 密钥：

```
LLM_API_KEY=sk-your-key-here
BASE_URL=https://api.deepseek.com/chat/completions
MODEL_NAME=deepseek-v4-flash
```

没有有效密钥时后端仍能启动，但对话、出题、任务 Agent 不可用。

手动安装（脚本失败时）：`cd backend` 后 `pip install -r requirements.txt`（`tina-python` 从 PyPI 安装）。

## 启动

**后端**（根目录）：

```bat
start.bat
```

```bash
bash start.sh
```

打开 <http://127.0.0.1:7777> 。`GET /health` 返回 `"status": "ok"` 即就绪。

**前端开发**另开一个终端：

```bash
cd frontend
npm run dev
```

浏览器打开 <http://127.0.0.1:5173> 。开发时前后端不同源，首次配置页填：

```
127.0.0.1:7777
```

局域网其它设备填电脑 IP，例如 `192.168.1.10:7777`（防火墙放行 7777）。

### 只开一个地址

```bash
cd frontend
npm run build
```

再 `start.bat` / `start.sh`，只访问 <http://127.0.0.1:7777>，不必配服务器地址。

## Docker（可选）

```bash
cp .env.example .env   # 填入 LLM_API_KEY
docker compose up --build
```

端口同样是 `7777`。数据在 compose 的 volume 里。

## 部署到服务器（登录保护）

默认是**单账号**模式：首次用浏览器打开时会进入「创建管理员账号」，设置用户名 + 密码后即可使用；之后每次访问需要登录。会话用服务端 httpOnly Cookie，默认 30 天有效，可在顶栏头像菜单「退出登录」。

- 建议前面挂 **Caddy / Nginx 反向代理并启用 HTTPS**，后端只监听本机；HTTPS 下 Cookie 会自动带 `Secure`（按请求的 `X-Forwarded-Proto` 判断）。
- 后端默认监听 `0.0.0.0:7777`（见 `backend/src/main.py`）；只想给反代访问可改成 `127.0.0.1`。
- **首次部署请在开放公网前先完成账号初始化**，否则任何人都可能抢先创建管理员。
- 反代请保留原始 `Host` 头，并设置 `X-Forwarded-Proto: https`。
- 忘记密码：停服后执行
  ```bash
  sqlite3 data/zhishi.db "DELETE FROM auth_sessions; DELETE FROM auth_users;"
  ```
  即可重新初始化账号（只清账号，不影响其它数据）。

### 生产部署：Docker + Caddy 自动 HTTPS（推荐）

仓库已带 `Caddyfile` 和 `docker-compose.prod.yml`：Caddy 自动申请/续期证书，后端 `7777` 不对公网暴露，只在内部网络。

1. 把域名解析到服务器，放通 `80` / `443`。
2. 在服务器项目目录：
   ```bash
   cp .env.example .env          # 填 LLM_API_KEY 与 DOMAIN=你的域名
   docker compose -f docker-compose.prod.yml up -d --build
   ```
3. 打开 `https://你的域名`，出现「创建管理员账号」，设置用户名 + 密码即可。

数据都在 Docker named volume（`zhishi-data` / `zhishi-storage`），升级只重建镜像、不丢数据。Caddy 会自动带 `X-Forwarded-Proto: https`，登录 Cookie 自动加 `Secure`。

> 想更稳妥：先别放公网。用基础 `docker compose up -d zhishi`（或把 prod 里 `127.0.0.1:7777:7777` 那两行取消注释），再用 SSH 隧道 `ssh -L 7777:127.0.0.1:7777 服务器` 在本机把管理员账号建好，最后再开 HTTPS。

## 目录

```
zhishi/
├── install.bat / install.sh   # 一键装依赖
├── start.bat / start.sh       # 启动后端 :7777
├── backend/                   # FastAPI
│   ├── tina.env.example       # 复制为 tina.env，勿提交密钥
│   └── config.yml.example     # 复制为 config.yml，勿提交密钥
├── frontend/                  # Vite + React
├── data/                      # SQLite（本地生成，不入库）
└── docs/                      # 笔记（部分可能落后于代码）
```

`data/`、`backend/storage/`、`.venv/`、`node_modules/` 都是本机文件，不要提交。

## 可选：PDF 扫描件 / 公式卷（MinerU）

普通 PDF / Word 用仓库依赖即可，**基础安装不含 PyTorch**（RAG 走 ONNX/fastembed）。扫描件或公式/结构缺失的 PDF 需要 OCR 时会用到 MinerU：

- 本机使用 **按需启动**（无任务不启动），空闲一段时间自动释放进程；
- 未安装时**不报错**——该资料会置为「等待 OCR」排队；到「设置 → MinerU 文档解析」可**一键安装到独立环境**（`~/.zhishi/mineru`），装好后自动重试排队资料；
- 也可改用**云端 mineru.net**（免安装，填 Token 即可）。

## 打包成 Android APK（可选）

不想装 Android Studio？仓库自带 GitHub Actions 工作流，**在网页上点一下就出 APK**。

**为什么是「同源壳」**：知拾登录用的是 `SameSite=Lax` 的 cookie，且写请求有同源校验
（`backend/src/main.py`）。所以 APK 用 Capacitor 的 `server.url` **直接加载后端地址**——
页面 origin 就是后端 origin，登录与写操作全部照常、**后端零改动**；后端更新后打开 APK
即最新版，不必重新打包。

**步骤**
1. 仓库 `Settings → Secrets and variables → Actions → Variables` 新增
   `ZHISHI_SERVER_URL`，值形如 `http://1.2.3.4:17777`
2. `Actions → Build Android APK → Run workflow`
3. 跑完后在该次运行的 **Artifacts** 下载 `zhishi-apk`（`app-debug.apk`），传到手机安装

**本地自建（可选，需 JDK 21 + Android SDK）**
```bash
cd frontend
CAP_SERVER_URL=http://1.2.3.4:17777 npm run build
npm run cap:add && npm run cap:sync
node scripts/enable-android-cleartext.mjs android/app/src/main/AndroidManifest.xml
cd android && ./gradlew assembleDebug
```

**注意**
- 后端是 **http 明文**：`capacitor.config.ts` 会开 `cleartext`，CI 再用
  `frontend/scripts/enable-android-cleartext.mjs` 往 AndroidManifest 补
  `usesCleartextTraffic`（API 28+ 默认禁明文，不加会白屏）
- APK 必须能访问到该地址（同一网络或公网可达）；地址变了要重跑一次 workflow
- `frontend/android/` 是 CI 现场生成的，不入库
- 若哪天上了 HTTPS（仓库已带 `Caddyfile` + `docker-compose.prod.yml`），也可以改用
  pwabuilder.com 直接生成 TWA —— 但那是另一条路，同源壳已经够用

## 常见问题

**找不到 `backend/config.yml`？**  
从 `backend/config.yml.example` 复制一份即可；也可以不建，程序会用内置默认值。

**前端「无法连接服务器」**  
后端是否已在 **7777** 监听（不是旧文档里的 8765）。

**对话报密钥错误**  
检查 `backend/tina.env` 里的 `LLM_API_KEY`。

**第一次检索很慢 / Hugging Face 失败**  
嵌入模型会下载到用户目录的 Hugging Face 缓存。需能访问 `huggingface.co`，或事先配好镜像。
