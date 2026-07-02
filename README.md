<div align="center">

# 知拾 KT 融合项目

### Patchouli Knowledge × LEKT

**将 LEKT / LADL 知识追踪算法集成到「知拾」Flutter App，融合登录注册体系，使其从"聊天助手"升级为"懂教育规律的个性化学习助手"。**

![Flutter](https://img.shields.io/badge/Flutter-02569B?logo=flutter&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Python](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)
![Database](https://img.shields.io/badge/DB-MySQL-4479A1?logo=mysql&logoColor=white)
![Cache](https://img.shields.io/badge/Cache-Redis-DC382D?logo=redis&logoColor=white)
![License](https://img.shields.io/badge/License-Internal-lightgrey)

</div>

---

## 功能亮点

| 模块 | 能力 | 技术要点 |
|:---:|------|------|
| 🧠 **知识追踪** | LADL 修正认知状态，推荐最优学习路径 | LEKT `.pyd` 原生加速 + NumPy fallback |
| 💬 **AI 对话** | 知识管理 + AI Agent 对话，支持附件上传 | 自研 Agent 框架 + 文件解析 |
| 🔐 **登录注册** | 邮箱/手机号双登录，验证码注册，JWT 鉴权 | bcrypt 哈希 + Redis 会话管理 |
| 📊 **学习仪表盘** | 可视化学习进度与知识掌握度 | Flutter 自绘图表 |
| 🌐 **公网联调** | ngrok 穿透，队友可直接注册使用 | 一键暴露本地后端 |
| 🖥️ **Web 端** | React 管理后台：知识库上传/AI对话/Dashboard | Vite + Tailwind + shadcn/ui |

---

## 技术架构

```
┌──────────────────────────┬──────────────────────────────┐
│  Flutter 前端 (zhishi_app/)  │  React Web 端 (zhishi-web/)  │
│                            │                              │
│  ┌──────────┐ ┌─────────┐ │ ┌───────┐ ┌──────────────┐   │
│  │ ChatPage │ │Dashboard│ │ │ChatPage│ │KnowledgeBase │   │
│  │  聊天对话  │ │学习仪表盘│ │ │AI 对话 │ │知识库上传预览  │   │
│  └──────────┘ └─────────┘ │ └───────┘ └──────────────┘   │
│  ┌──────────────────────┐ │ ┌──────────────────────────┐   │
│  │      AuthPage         │ │ │  DashboardPage  AI 搜索  │   │
│  │  登录/注册/个人中心    │ │ │  LoginPage    登录/注册   │   │
│  └──────────────────────┘ │ └──────────────────────────┘   │
│                            │                              │
│  AuthService · KTApiService│  api.ts · SSE stream · JWT   │
│  AgentService · FileServe  │  react-router-dom · Context  │
└────────────────┬───────────┴──────────────┬───────────────┘
                 │      HTTP :8765          │
                 └─────────┬───────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│               Python FastAPI 后端 (kt_backend/)           │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │  /api/v1/auth/*   登录 · 注册 · 个人资料           │   │
│   │  /api/v1/kt/*     LEKT 推理 · 学习路径             │   │
│   │  /api/v1/kb/*     知识库 · OCR · 文档管理          │   │
│   │  /api/v1/chat/*   AI 聊天 · 会话历史               │   │
│   │  /api/v1/dashboard/* 仪表盘 · 智能建议             │   │
│   │  /api/v1/plan/*   套餐管理                        │   │
│   └─────────────────────────────────────────────────┘   │
│                                                         │
│   MySQL  ·  Redis  ·  LEKT .pyd (Cython 原生加速)        │
│   Dify KB  ·  Baidu OCR  ·  本地文件存储                 │
└─────────────────────────────────────────────────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │   ngrok / 公网穿透    │
                  │   队友可直接访问       │
                  └─────────────────────┘
```

---

## 工程目录

```
patchouli-knowledge-kt/
├── README.md
├── PLAN.md                        # 项目计划文档
├── TEAM.md                        # 团队成员
├── .gitignore
│
├── zhishi_app/                    # Flutter 前端 —「知拾」App
│   ├── lib/
│   │   ├── main.dart              # 入口 + 主页面 + 登录入口
│   │   ├── pages/
│   │   │   ├── auth_page.dart     #   登录/注册（邮箱 + 手机号双登录）
│   │   │   ├── identity_page.dart #   个人中心（资料编辑 + 登出）
│   │   │   ├── chat_page.dart     #   聊天页（附件上传 + 文件解析）
│   │   │   ├── welcome_page.dart  #   欢迎页（登录流程接入）
│   │   │   ├── learning_dashboard_page.dart
│   │   │   └── learning_path_page.dart
│   │   ├── serve/
│   │   │   ├── auth_service.dart  #   Auth HTTP 客户端
│   │   │   ├── kt_api_service.dart#   KT HTTP 客户端（JWT 鉴权）
│   │   │   ├── file_serve.dart    #   文件/配置/数据库管理
│   │   │   └── agent_serve.dart   #   AI Agent 服务
│   │   ├── models/
│   │   │   ├── user_info.dart     #   用户模型
│   │   │   └── kt_models.dart     #   KT 数据模型
│   │   └── AI/tina_dart/          #   AI Agent 框架
│   └── pubspec.yaml
│
├── kt_backend/                    # Python 后端 — 融合服务
│   ├── server.py                  #   FastAPI 入口（统一 lifespan）
│   ├── models.py                  #   KT Pydantic 模型
│   ├── lekt_service.py            #   LEKT API 封装
│   ├── requirements.txt           #   Python 依赖
│   ├── .env                       #   环境变量（DB/Redis/SMTP）
│   ├── logic_matrix.npy           #   先修关系矩阵（9 技能）
│   ├── generate_matrix.py         #   矩阵生成工具
│   ├── app/                       #   业务逻辑（从 zhishi_backend 迁入）
│   │   ├── api/v1/
│   │   │   ├── router.py          #     统一路由汇总
│   │   │   ├── auth.py            #     注册/登录/改密/邮箱验证
│   │   │   ├── kt.py              #     KT 推理接口（JWT 鉴权）
│   │   │   ├── chat.py            #     AI 聊天接口
│   │   │   └── plan.py            #     套餐管理
│   │   ├── api/deps.py            #   鉴权依赖
│   │   ├── core/                  #   配置/数据库/Redis/安全/邮件
│   │   ├── models/models.py       #   SQLAlchemy 模型
│   │   ├── schemas/schemas.py     #   Pydantic 请求/响应模型
│   │   ├── crud/crud.py           #   数据库操作
│   │   └── services/auth_service.py #  登录/注册/验证码/改密
│   ├── lekt_api.cp314-win_amd64.pyd
│   └── lekt_core.cp314-win_amd64.pyd
│
└── lekt_release_cython(3)/        # LEKT 算法 Cython 源码 & 构建产物
```

---

## 环境要求

### 前端

| 依赖 | 版本 |
|------|------|
| Flutter SDK | `>=3.0.0` |
| Dart | `>=3.0.0` |
| dio | HTTP 请求 |
| file_picker | 文件选择 |
| image_picker | 图片选择 |
| flutter_markdown | Markdown 渲染 |

### 后端

| 依赖 | 版本 | 备注 |
|------|------|------|
| **Python** | **3.14** | `.pyd` 文件仅支持此版本，**必须** |
| PyTorch | `>=1.12.0` | |
| NumPy | `>=1.21.0` | |
| FastAPI | `0.109.0` | |
| Uvicorn | `0.27.0` | |
| SQLAlchemy | `2.0.25` | MySQL ORM |
| PyMySQL | `1.1.0` | MySQL 驱动 |
| Redis | `5.0.1` | 会话 / 验证码存储 |
| passlib[bcrypt] | `1.7.4` | 密码哈希 |
| python-jose | `3.3.0` | JWT Token |
| pydantic | `2.5.3` | 锁定版本，忽略命名空间 warning |

### 数据库 & 中间件

| 组件 | 说明 |
|------|------|
| **MySQL** | 用户 / 套餐数据，数据库名 `my_ai_app` |
| **Redis** | JWT Session + 验证码存储，端口 `6379` |

---

## 快速开始

### 1 · 启动后端

```bash
cd kt_backend

# 创建 conda 环境（必须 Python 3.14）
conda create -n xzs python=3.14 -y
conda activate xzs

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
# 编辑 .env，确认 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME

# 确保 MySQL 和 Redis 已启动，然后启动后端
uvicorn server:app --host 0.0.0.0 --port 8765
```

<details>
<summary>📖 验证后端（点击展开）</summary>

```bash
# 健康检查
curl http://127.0.0.1:8765/health
# → {"status":"degraded","skills_count":9,"model_loaded":false}
# "degraded" 是因为 lekt_api.pyd 不在 Python 路径中，
# 推理自动降级为 NumPy fallback，不影响功能使用。

# 注册
curl -X POST http://127.0.0.1:8765/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456","nickname":"测试用户"}'

# 登录
curl -X POST http://127.0.0.1:8765/api/v1/auth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=test@test.com&password=123456"
```

</details>

### 2 · 启动前端

```bash
cd zhishi_app
flutter pub get
flutter run              # 桌面端
# 或
flutter run -d chrome    # Web 端
```

### 3 · 公网穿透（可选）

```bash
cd KT_project
./ngrok http 8765
```

获取公网地址后，修改 `zhishi_app/lib/serve/auth_service.dart` 中的 `_defaultUrl`，队友即可通过公网访问你的后端。

---

## API 参考

### 认证模块 — `/api/v1/auth`

| 方法 | 路径 | 鉴权 | 说明 |
|:---:|------|:---:|------|
| `POST` | `/register` | | 用户注册（支持验证码） |
| `POST` | `/token` | | 登录（邮箱或手机号 + 密码） |
| `POST` | `/send-verification` | | 发送验证码（邮箱或手机号） |
| `GET` | `/users/me` | ✅ | 获取当前用户完整信息 |
| `PATCH` | `/users/me` | ✅ | 更新资料（白名单：phone / nickname / gender / signature / tags） |
| `POST` | `/change-password` | ✅ | 修改密码 |
| `POST` | `/logout` | ✅ | 退出登录 |

### 知识追踪模块 — `/api/v1/kt`

| 方法 | 路径 | 鉴权 | 说明 |
|:---:|------|:---:|------|
| `POST` | `/correct` | ✅ | LADL 修正认知状态 |
| `POST` | `/evaluate` | ✅ | 评估 LVR / VS 指标 |
| `POST` | `/learning-path` | ✅ | 推荐最优学习路径 |
| `POST` | `/prerequisites` | ✅ | 查询技能先修 / 后继关系 |
| `GET` | `/skill-graph` | ✅ | 获取完整知识依赖图 |

### 其他

| 方法 | 路径 | 说明 |
|:---:|------|------|
| `GET` | `/health` | 健康检查（无需鉴权） |
| `GET` | `/api/v1/plan/plans/` | 获取套餐列表 |
| `POST` | `/api/v1/chat/chat` | AI 聊天 |

---

## 数据模型

### `users` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int (PK) | 用户 ID |
| `email` | varchar(255) UNIQUE | 邮箱（登录凭据） |
| `password_hash` | varchar(255) | bcrypt 密码哈希 |
| `phone` | varchar(20) UNIQUE | 手机号（可选，用于手机号登录） |
| `nickname` | varchar(50) | 昵称 |
| `gender` | varchar(10) | 性别 |
| `signature` | varchar(200) | 个性签名 |
| `tags` | varchar(500) | 身份标签（JSON 数组） |
| `plan_level` | int | 套餐等级 |
| `is_email_verified` | bool | 邮箱是否已验证 |
| `api_limit_daily` | int | 每日 API 限额 |
| `created_at` | datetime | 注册时间 |

---

## 开发路线

| 阶段 | 内容 | 状态 |
|:---:|------|:---:|
| Phase 1 | 环境搭建 + Python 后端 | ✅ 完成 |
| Phase 2 | Flutter 数据模型 + Service 层 | ✅ 完成 |
| Phase 3 | 登录注册体系（前后端） | ✅ 完成 |
| Phase 4 | 公网穿透 + 队友联调 | ✅ 完成 |
| Phase 5 | 附件上传（聊天页文件 / 图片） | ✅ 完成 |
| Phase 6 | 可视化组件（学习仪表盘 / 学习路径） | 🔄 进行中 |
| Phase 7 | 手机号短信验证码（替代 DEV_MODE） | ⏳ 待开始 |

---

## 核心设计原则

1. **追加而非修改** — 新功能以新增方式集成，不破坏已有功能
2. **最小化依赖** — 复用现有库，控制新增依赖
3. **优雅降级** — 后端不可用时，App 其他功能不受影响
4. **单例模式** — Service 层与现有 FileServe 模式保持一致
5. **白名单鉴权** — PATCH 接口仅允许修改白名单字段，防止越权

---

## 常见问题

<details>
<summary><b>健康检查返回 <code>degraded</code>，有问题吗？</b></summary>

没有问题。`degraded` 状态表示 `lekt_api.pyd` 未被加载到 Python 路径中，推理会自动降级为 NumPy fallback。功能完全正常，只是推理速度稍慢。如需启用原生加速，确保 `.pyd` 文件在 `kt_backend/` 目录下且 Python 版本为 3.14。

</details>

<details>
<summary><b>前端无法连接后端？</b></summary>

1. 确认后端已启动：`curl http://127.0.0.1:8765/health`
2. 检查 `auth_service.dart` 中 `_defaultUrl` 是否指向正确的后端地址
3. 如果使用 ngrok，确保公网地址已更新到前端配置

</details>

<details>
<summary><b>Python 版本不对，<code>.pyd</code> 加载失败？</b></summary>

`.pyd` 文件编译自 Cython，仅支持 **Python 3.14**。请使用 conda 创建指定版本的环境：

```bash
conda create -n xzs python=3.14 -y
conda activate xzs
```

</details>

<details>
<summary><b>MySQL / Redis 连接失败？</b></summary>

检查 `.env` 文件中的配置项是否正确：
- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`
- 确认 Redis 运行在 `localhost:6379`

</details>

---

## 参与贡献

本项目为团队内部项目。团队成员请遵循以下流程：

1. 克隆仓库 → 创建功能分支（`feature/xxx`）
2. 遵循「追加而非修改」原则，不破坏已有功能
3. 提交 PR，经 Review 后合并至 `main`
4. 详见 [TEAM.md](./TEAM.md) 了解团队成员分工

---

## 许可证

内部项目，仅供团队使用。
