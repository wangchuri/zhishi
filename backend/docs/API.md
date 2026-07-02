# 知拾 (Zhishi) 后端 API 文档

> **Base URL**: `http://localhost:8765`
>
> **Content-Type**: `application/json`（文件上传使用 `multipart/form-data`）
>
> **鉴权方式**: Bearer Token（`Authorization: Bearer <token>`），通过 `/api/v1/auth/token` 登录获取

---

## 目录

- [1. 账号认证 (Auth)](#1-账号认证-auth-apiv1auth)
- [2. 智能聊天 (Chat)](#2-智能聊天-chat-apiv1chat)
- [3. 知识库管理 (KB)](#3-知识库管理-kb-apiv1kb)
- [4. 题目 (Questions)](#4-题目-questions-apiv1questions)
- [5. 刷题 (Quiz)](#5-刷题-quiz-apiv1quiz)
- [6. 首页建议 (Dashboard)](#6-首页建议-dashboard-apiv1dashboard)
- [7. 知识追踪 (KT)](#7-知识追踪-kt-apiv1kt)
- [8. 用户套餐 (Plan)](#8-用户套餐-plan-apiv1plan)
- [9. 系统](#9-系统)

---

## 通用说明

### 鉴权

除登录和注册外，所有接口均需在请求头中携带 Token：

```
Authorization: Bearer eyJhbGciOi...
```

### 错误响应格式

```json
{
  "detail": "错误描述信息"
}
```

常见 HTTP 状态码：

| 状态码 | 含义 |
|:---:|------|
| 200 | 成功 |
| 400 | 请求参数有误 |
| 401 | 未登录或 Token 过期 |
| 404 | 资源不存在 |
| 413 | 文件过大 |
| 422 | 无法处理（如 OCR 识别失败） |
| 500 | 服务器内部错误 |
| 502 | 上游服务（Dify）异常 |

---

## 1. 账号认证 (Auth) — `/api/v1/auth`

### 1.1 注册

```
POST /api/v1/auth/register
```

**请求 Body**：

```json
{
  "email": "user@example.com",
  "password": "123456",
  "nickname": "用户昵称",
  "username": "可选用户名",
  "verification_code": "可选验证码"
}
```

**成功响应** (200)：

```json
{
  "id": 1,
  "email": "user@example.com",
  "nickname": "用户昵称",
  "phone": null,
  "gender": null,
  "signature": null,
  "tags": null,
  "username": null,
  "is_active": true,
  "created_at": "2025-01-01T00:00:00",
  "plan_info": {
    "plan_level": 1,
    "plan_name": "基础版",
    "daily_api_limit": 100,
    "token_limit_monthly": 10000,
    "kb_limit": 10,
    "available_models": [],
    "concurrent_limit": 1,
    "expires_at": null,
    "days_remaining": null
  },
  "dataset_id": "abc123...",
  "message": "注册成功"
}
```

**说明**: 注册成功后自动创建 Dify 知识库并上传欢迎文档。

---

### 1.2 登录

```
POST /api/v1/auth/token
```

**请求格式**: `application/x-www-form-urlencoded`

| 参数 | 说明 |
|------|------|
| `username` | 邮箱或手机号 |
| `password` | 密码 |

**成功响应** (200)：

```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer"
}
```

---

### 1.3 刷新 Token

```
POST /api/v1/auth/refresh-token
```

**请求 Body**：

```json
{
  "refresh_token": "旧的 access_token"
}
```

**成功响应** (200)：

```json
{
  "access_token": "新的 token",
  "token_type": "bearer",
  "expires_in": 604800,
  "message": "Token 刷新成功"
}
```

---

### 1.4 获取当前用户信息

```
GET /api/v1/auth/users/me
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "id": 1,
  "email": "user@example.com",
  "phone": null,
  "nickname": "用户昵称",
  "gender": null,
  "signature": null,
  "tags": null,
  "username": null,
  "is_active": true,
  "created_at": "2025-01-01T00:00:00",
  "plan_info": {
    "level": 1,
    "name": "基础版",
    "daily_api_limit": 100,
    "monthly_token_limit": 10000,
    "kb_limit": 10,
    "available_models": [],
    "concurrent_limit": 1,
    "expires_at": null,
    "days_remaining": null
  }
}
```

---

### 1.5 获取用户套餐详情

```
GET /api/v1/auth/users/me/plan
```

**鉴权**: ✅ 需要

**成功响应** (200)：包含完整套餐信息的用户对象。

---

### 1.6 检查 API 配额

```
GET /api/v1/auth/users/me/quota
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "has_quota": true,
  "plan_level": 1,
  "plan_name": "基础版",
  "api_limit_daily": 100,
  "expires_at": null,
  "days_remaining": null
}
```

---

### 1.7 升级套餐

```
POST /api/v1/auth/users/me/upgrade-plan
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "plan_level": 2,
  "months": 1
}
```

**成功响应** (200)：

```json
{
  "message": "套餐升级成功",
  "new_plan_level": 2
}
```

---

### 1.8 发送验证码

```
POST /api/v1/auth/send-verification
```

**请求 Body**：

```json
{
  "email": "user@example.com"
}
```

**成功响应** (200)：

```json
{
  "message": "验证码已发送"
}
```

---

### 1.9 验证邮箱

```
POST /api/v1/auth/verify-email
```

**请求 Body**：

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**成功响应** (200)：

```json
{
  "message": "邮箱验证成功"
}
```

---

### 1.10 忘记密码

```
POST /api/v1/auth/forgot-password
```

**请求 Body**：

```json
{
  "email": "user@example.com"
}
```

**成功响应** (200)：

```json
{
  "message": "密码重置邮件已发送"
}
```

---

### 1.11 重置密码

```
POST /api/v1/auth/reset-password
```

**请求 Body**：

```json
{
  "reset_token": "邮件中的重置令牌",
  "new_password": "新密码"
}
```

**成功响应** (200)：

```json
{
  "message": "密码重置成功"
}
```

---

### 1.12 退出登录

```
POST /api/v1/auth/logout
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "message": "退出成功"
}
```

---

### 1.13 检查邮箱验证状态

```
GET /api/v1/auth/check-email-verification/{email}
```

**无需鉴权**

**成功响应** (200)：

```json
{
  "email": "user@example.com",
  "is_email_verified": true,
  "email_verified_at": "2025-01-01T00:00:00"
}
```

---

### 1.14 修改密码

```
POST /api/v1/auth/change-password
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "old_password": "旧密码",
  "new_password": "新密码"
}
```

**成功响应** (200)：

```json
{
  "message": "密码修改成功，请使用新密码重新登录其他设备",
  "email": "user@example.com"
}
```

---

### 1.15 注销账号

```
DELETE /api/v1/auth/account
```

**鉴权**: ✅ 需要

**说明**: 删除用户账号、所有 Redis 会话，以及 Dify 知识库。

**成功响应** (200)：

```json
{
  "message": "账号已注销"
}
```

---

### 1.16 更新个人资料

```
PATCH /api/v1/auth/users/me
```

**鉴权**: ✅ 需要

**允许的字段**（白名单）：`phone`, `nickname`, `gender`, `signature`, `tags`

**请求 Body**：

```json
{
  "nickname": "新昵称",
  "signature": "新签名"
}
```

**成功响应** (200)：

```json
{
  "message": "资料更新成功",
  "updated_fields": ["nickname", "signature"]
}
```

---

### 1.17 Token 测试

```
GET /api/v1/auth/test-token-info
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "status": "验证成功",
  "message": "欢迎回来，user@example.com！",
  "server_time": "2025-01-01T00:00:00.000Z",
  "your_user_id": 1,
  "hint": "如果你能看到这条消息，说明你的 Redis Token 机制完全跑通了！"
}
```

---

## 2. 智能聊天 (Chat) — `/api/v1/chat`

### 2.1 发送消息（SSE 流式）

```
POST /api/v1/chat
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "session_id": "可选，已存在会话的 ID",
  "content": "你好，帮我总结一下知识库的内容",
  "stream": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `session_id` | string | | 已有会话 ID。不传则自动创建新会话 |
| `content` | string | ✅ | 用户消息内容 |
| `stream` | bool | | 是否 SSE 流式返回，默认 `true` |

**响应**: `text/event-stream`

```text
event: message
data: {"session_id":"abc123","role":"assistant","content":"你好"}

event: message
data: {"session_id":"abc123","role":"assistant","content":"！"}

event: message
data: {"session_id":"abc123","role":"assistant","content":"我是","tool_name":"search_knowledge_base"}

event: message
data: {"session_id":"abc123","role":"assistant","content":"Tina，你的知识助手。","reasoning_content":"正在分析..."}
```

**SSE 数据字段说明**：

| 字段 | 说明 |
|------|------|
| `session_id` | 当前会话 ID（新会话首次返回） |
| `role` | `"assistant"` |
| `content` | 本次增量文本片段 |
| `reasoning_content` | 可选，DeepSeek 推理过程（思维链） |
| `tool_name` | 可选，当前调用的工具名称 |

> **前端拼接方式**: 将所有 `content` 片段按顺序拼接得到完整回复。

**非流式模式** (`"stream": false`)：

```json
{
  "session_id": "abc123",
  "session_title": "你好，帮我总结一下...",
  "role": "assistant",
  "content": "你好！我是 Tina...",
  "created_at": "2025-01-01T00:00:00Z"
}
```

---

### 2.2 获取会话历史

```
GET /api/v1/chat/history?session_id={session_id}
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
[
  {
    "role": "user",
    "content": "你好",
    "created_at": "2025-01-01T00:00:00Z"
  },
  {
    "role": "assistant",
    "content": "你好！我是 Tina...",
    "created_at": "2025-01-01T00:00:01Z"
  }
]
```

---

### 2.3 列出所有会话

```
GET /api/v1/chat/sessions
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "sessions": [
    {
      "id": "abc123",
      "title": "帮我总结知识库内容",
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:05:00Z",
      "message_count": 6
    }
  ]
}
```

---

### 2.4 删除会话

```
DELETE /api/v1/chat/sessions/{session_id}
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "message": "Chat session deleted"
}
```

---

## 3. 知识库管理 (KB) — `/api/v1/kb`

### 3.0 知识库分区

#### 3.0.1 分区列表

```
GET /api/v1/kb/collections
```

**鉴权**: ✅ 需要

**说明**: 返回当前用户的知识库分区。新用户注册时自动 seed「学习区」(study) 与「生活区」(life)。

**成功响应** (200)：

```json
{
  "collections": [
    {
      "id": "uuid-1",
      "name": "学习区",
      "zone": "study",
      "description": null,
      "dataset_id": "dify-dataset-id",
      "is_default": true,
      "created_at": "2026-07-02T00:00:00",
      "updated_at": "2026-07-02T00:00:00"
    }
  ],
  "total": 2
}
```

#### 3.0.2 创建分区

```
POST /api/v1/kb/collections
```

**鉴权**: ✅ 需要

**请求体** (JSON)：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | ✅ | 分区名称（用户内唯一） |
| `zone` | string | ✅ | `study` 或 `life` |
| `description` | string | | 描述 |

**成功响应** (201)：单个 `CollectionOut` 对象。

#### 3.0.3 更新分区

```
PATCH /api/v1/kb/collections/{collection_id}
```

**鉴权**: ✅ 需要

**请求体** (JSON)：`name`、`description` 可选。

---

### 3.1 上传文档

```
POST /api/v1/kb/upload
```

**鉴权**: ✅ 需要

**请求格式**: `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `file` | file | ✅ | 文档文件 |
| `collection_id` | string | | 目标分区 ID；缺省使用默认「学习区」 |

**支持格式**: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.htm`, `.pdf`, `.docx`

**图片 OCR 支持**: `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`

> **演示环境限制**: 未配置 OSS 时，单文件上限 10 MB。

**上传流程（文档）**:
1. 文件大小校验
2. SHA256 哈希 → 查 `global_documents` 全局去重
3. 未命中则写入 `storage/global/{hash[:2]}/{hash}`
4. 解析文本内容并缓存
5. 上传至 Dify 知识库索引（`dataset_id` 优先取分区配置，否则 `users.dataset_id`）
6. 写入 `documents` 表；同用户同 hash 返回 `duplicate`

**上传流程（图片）**:
1. 文件大小校验
2. 保存至本地存储
3. SHA256 去重检查
4. **百度 OCR 识别文字**
5. OCR 结果写入 `.txt` 文件
6. 上传 `.txt` 至 Dify 知识库索引

**成功响应** (200)：

```json
{
  "message": "文件已上传，正在索引中",
  "batch_id": "abc123",
  "document_id": "def456",
  "id": "documents-uuid",
  "file_name": "notes.txt",
  "dataset_id": "ghi789",
  "collection_id": "collection-uuid",
  "status": "indexing",
  "ocr_processed": false
}
```

**重复文件**：

```json
{
  "message": "该文件已上传过，无需重复上传",
  "batch_id": "abc123",
  "document_id": "def456",
  "file_name": "notes.txt",
  "dataset_id": "ghi789",
  "status": "duplicate"
}
```

---

### 3.2 文档列表

```
GET /api/v1/kb/documents?page=1&limit=20&collection_id={uuid}
```

**鉴权**: ✅ 需要

**Query Params**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | int | 页码，默认 1 |
| `limit` | int | 每页数量，默认 20 |
| `collection_id` | string | 可选，按分区过滤 |

**说明**: 数据来自 `documents` 表。`id` 字段对外仍返回 `dify_document_id`（兼容旧前端）；完整业务主键见 `dify_document_id` 同级的内部 `documents.id`（上传响应中的 `id` 字段）。

**成功响应** (200)：

```json
{
  "documents": [
    {
      "id": "doc-001",
      "name": "notes.txt",
      "file_type": "text/plain",
      "file_size": 1234,
      "indexing_status": "completed",
      "created_at": "2025-01-01T00:00:00",
      "updated_at": "2025-01-01T00:05:00"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "dataset_id": "ghi789"
}
```

**索引状态说明**：

| `indexing_status` | 含义 |
|------|------|
| `waiting` | 等待处理 |
| `parsing` | 正在解析 |
| `splitting` | 正在分段 |
| `indexing` | 正在索引 |
| `completed` | 已完成 |
| `error` | 索引失败 |

---

### 3.3 索引进度查询

```
GET /api/v1/kb/documents/{batch_id}/status
```

**鉴权**: ✅ 需要

**说明**: 上传成功后使用返回的 `batch_id` 轮询此接口，查看索引状态。

**成功响应** (200)：

```json
{
  "batch_id": "abc123",
  "status": "indexing",
  "error_message": null,
  "completed_segments": 5,
  "total_segments": 12
}
```

---

### 3.4 删除文档

```
DELETE /api/v1/kb/documents/{doc_id}
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "message": "文档已删除",
  "doc_id": "doc-001"
}
```

---

### 3.5 文档内容预览

```
GET /api/v1/kb/documents/{doc_id}/content
```

**鉴权**: ✅ 需要

**说明**: 读取上传时缓存的解析文本内容。若缓存不存在（旧文档），返回提示信息。

**成功响应** (200)：

```json
{
  "doc_id": "doc-001",
  "file_name": "notes.txt",
  "content": "这是文档的完整文本内容...",
  "mock": false
}
```

---

### 3.6 文档分段列表

```
GET /api/v1/kb/documents/{doc_id}/segments
```

**鉴权**: ✅ 需要（仅文档 owner 可访问）

**说明**: 返回学习区文档的 `document_segments` 列表，用于出题溯源与 citation 定位。`doc_id` 支持 `documents.id` 或 `dify_document_id`。

**成功响应** (200)：

```json
{
  "document_id": "uuid-doc",
  "segment_status": "completed",
  "total": 2,
  "segments": [
    {
      "id": "uuid-seg-1",
      "document_id": "uuid-doc",
      "order_index": 0,
      "title": "第一章",
      "content": "# 第一章\n正文...",
      "char_start": 0,
      "char_end": 120,
      "created_at": "2025-01-01T00:00:00"
    }
  ]
}
```

**`segment_status` 说明**：

| 值 | 含义 |
|------|------|
| `not_started` | 未分段（生活区文档保持此状态） |
| `processing` | 分段进行中 |
| `completed` | 分段完成 |
| `failed` | 分段失败 |

---

### 3.7 配置查询

```
GET /api/v1/kb/config
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "use_oss": false,
  "max_upload_size": 10485760,
  "max_upload_size_display": "10.0 MB",
  "supported_extensions": [".txt", ".md", ".csv", ".json", ".html", ".htm", ".pdf", ".docx"]
}
```

---

## 4. 题目 (Questions) — `/api/v1/questions`

### 4.1 批量出题

```
POST /api/v1/questions/generate
```

**鉴权**: ✅ 需要

**说明**: 对学习区（`zone=study`）且分段已完成（`segment_status=completed`）的文档，从 `document_segments` 生成单选题，写入 `global_questions`（全局去重）、`question_provenance`（溯源）、`user_question_refs`（用户题库）。LLM 不可用时自动回退模板题。

**请求体**（`document_id` 与 `segment_ids` 至少一项）：

```json
{
  "document_id": "uuid-doc"
}
```

或指定分段：

```json
{
  "segment_ids": ["uuid-seg-1", "uuid-seg-2"]
}
```

**成功响应** (200)：

```json
{
  "document_id": "uuid-doc",
  "question_gen_status": "completed",
  "questions_created": 2,
  "questions_reused": 0,
  "total_questions": 2
}
```

**`question_gen_status` 说明**：

| 值 | 含义 |
|------|------|
| `not_started` | 未出题 |
| `processing` | 出题进行中 |
| `completed` | 出题完成（至少 1 题） |
| `failed` | 出题失败（无有效题目） |

**错误**：

| 状态码 | 场景 |
|--------|------|
| 400 | 非学习区、分段未完成、segment_ids 跨文档 |
| 404 | 文档或分段不存在 |

---

### 4.2 题目列表

```
GET /api/v1/questions?document_id=&collection_id=
```

**鉴权**: ✅ 需要

**说明**: 返回当前用户 `user_question_refs` 中的题目，可按 `document_id` 或 `collection_id` 过滤。

**成功响应** (200)：

```json
{
  "questions": [
    {
      "id": "uuid-q",
      "stem": "关于「导论」的核心内容，以下哪项正确？",
      "question_type": "single_choice",
      "options": [
        {"key": "A", "text": "选项 A"}
      ],
      "answer": "A",
      "explanation": "解析文本",
      "tags": ["测试"],
      "source_type": "generated",
      "document_id": "uuid-doc",
      "collection_id": "uuid-coll",
      "created_at": "2025-01-01T00:00:00"
    }
  ],
  "total": 1,
  "document_id": "uuid-doc",
  "collection_id": null
}
```

> 注：`options` 每项为 `{"key":"A","text":"..."}`。

---

### 4.3 题目详情（含溯源）

```
GET /api/v1/questions/{question_id}
```

**鉴权**: ✅ 需要（仅用户可见题目）

**成功响应** (200)：

```json
{
  "id": "uuid-q",
  "stem": "题干",
  "question_type": "single_choice",
  "options": [{"key": "A", "text": "..."}],
  "answer": "A",
  "explanation": "解析",
  "tags": [],
  "source_type": "generated",
  "document_id": "uuid-doc",
  "collection_id": "uuid-coll",
  "created_at": "2025-01-01T00:00:00",
  "provenance": [
    {
      "id": "uuid-prov",
      "document_id": "uuid-doc",
      "segment_id": "uuid-seg",
      "excerpt": "原文摘录片段..."
    }
  ]
}
```

---

## 5. 刷题 (Quiz) — `/api/v1/quiz`

### 5.1 创建刷题会话

```
POST /api/v1/quiz/sessions
```

**鉴权**: ✅ 需要

**说明**: 从 `user_question_refs` 按 `document_id` / `collection_id` 拉题，或指定 `question_ids`；题目顺序随机打乱后写入 `quiz_session_questions`。

**请求体**（`document_id`、`collection_id`、`question_ids` 至少一项）：

```json
{
  "document_id": "uuid-doc",
  "title": "可选会话标题"
}
```

**成功响应** (201)：

```json
{
  "id": "uuid-session",
  "title": "刷题 · notes.md",
  "status": "active",
  "document_id": "uuid-doc",
  "collection_id": null,
  "total_questions": 3,
  "answered_count": 0,
  "started_at": "2025-01-01T00:00:00",
  "finished_at": null,
  "questions": [
    {
      "question_id": "uuid-q",
      "order_index": 0,
      "stem": "题干",
      "question_type": "single_choice",
      "options": [{"key": "A", "text": "..."}]
    }
  ]
}
```

> 注：响应不含标准答案。

**错误**：

| 状态码 | 场景 |
|--------|------|
| 404 | 文档、知识库或题目不存在 |
| 409 | 文档未出题完成，或无可用题目 |

---

### 5.2 获取会话进度

```
GET /api/v1/quiz/sessions/{session_id}
```

**鉴权**: ✅ 需要

**成功响应** (200)：同 5.1 创建响应结构（含最新 `answered_count` 与 `status`）。

---

### 5.3 提交答案

```
POST /api/v1/quiz/sessions/{session_id}/answers
```

**鉴权**: ✅ 需要

**请求体**：

```json
{
  "question_id": "uuid-q",
  "user_answer": "A",
  "status": null,
  "time_spent_seconds": 12
}
```

「我不会」时传 `status: "unknown"`，`user_answer` 可省略。

**成功响应** (200) — 答对：

```json
{
  "question_id": "uuid-q",
  "status": "correct",
  "correct_answer": "A",
  "explanation": null,
  "citation": null,
  "answered_count": 1,
  "total_questions": 3,
  "session_status": "active"
}
```

**成功响应** (200) — 答错或 unknown：

```json
{
  "question_id": "uuid-q",
  "status": "wrong",
  "correct_answer": "A",
  "explanation": "解析文本",
  "citation": {
    "doc_id": "uuid-doc",
    "segment_id": "uuid-seg",
    "title": "导论",
    "char_start": 0,
    "char_end": 120,
    "snippet": "原文摘录片段..."
  },
  "answered_count": 1,
  "total_questions": 3,
  "session_status": "active"
}
```

**`status` 枚举**：`correct` | `wrong` | `unknown`

全部作答后 `session_status` 变为 `completed`。

---

### 5.4 错题汇总

```
GET /api/v1/quiz/sessions/{session_id}/results
```

**鉴权**: ✅ 需要

**说明**: 返回 `wrong` / `unknown` 题目列表，含 provenance 原文定位。

**成功响应** (200)：

```json
{
  "session_id": "uuid-session",
  "status": "completed",
  "total_questions": 3,
  "correct_count": 1,
  "wrong_count": 1,
  "unknown_count": 1,
  "items": [
    {
      "question_id": "uuid-q",
      "stem": "题干",
      "user_answer": "B",
      "status": "wrong",
      "correct_answer": "A",
      "explanation": "解析",
      "citation": {
        "doc_id": "uuid-doc",
        "segment_id": "uuid-seg",
        "title": "导论",
        "char_start": 0,
        "char_end": 120,
        "snippet": "原文摘录..."
      }
    }
  ]
}
```

---

## 6. 首页建议 (Dashboard) — `/api/v1/dashboard`

### 6.1 获取个性化建议

```
GET /api/v1/dashboard/suggestions
```

**鉴权**: ✅ 需要

**说明**: 根据用户知识库中的文档列表，调用 LLM 生成 2-3 条个性化学习建议。

**成功响应** (200)：

```json
{
  "suggestions": [
    "复习「高等数学」第三章的积分部分",
    "尝试上传更多数据结构相关文档",
    "向 Tina 提问线性代数中的矩阵运算"
  ]
}
```

**无文档时**：

```json
{
  "suggestions": [
    "上传你的第一份文档，开启智能学习",
    "完善学习画像，获得精准推荐"
  ]
}
```

---

## 7. 知识追踪 (KT) — `/api/v1/kt`

### 7.1 LADL 修正认知状态

```
POST /api/v1/kt/correct
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "states": [0.5, 0.3, 0.8, 0.1, 0.6, 0.4, 0.7, 0.2, 0.9]
}
```

**成功响应** (200)：

```json
{
  "corrected_states": [0.52, 0.28, 0.79, ...],
  "correction_applied": true
}
```

---

### 7.2 评估能力指标

```
POST /api/v1/kt/evaluate
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "states": [0.5, 0.3, 0.8, 0.1, 0.6, 0.4, 0.7, 0.2, 0.9]
}
```

**成功响应** (200)：

```json
{
  "lvr": 0.45,
  "vs": 0.62,
  "skill_levels": { ... }
}
```

---

### 7.3 推荐学习路径

```
POST /api/v1/kt/learning-path
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "states": [0.5, 0.3, 0.8, 0.1, 0.6, 0.4, 0.7, 0.2, 0.9],
  "top_k": 3
}
```

**成功响应** (200)：

```json
{
  "recommendations": [
    {"skill_id": 0, "skill_name": "基础概念", "priority": 0.92, "reason": "掌握度低且为多技能先修"},
    {"skill_id": 3, "skill_name": "...", "priority": 0.85},
    {"skill_id": 1, "skill_name": "...", "priority": 0.71}
  ]
}
```

---

### 7.4 查询技能先修/后继关系

```
POST /api/v1/kt/prerequisites
```

**鉴权**: ✅ 需要

**请求 Body**：

```json
{
  "skill_id": 5
}
```

**成功响应** (200)：

```json
{
  "skill": {"id": 5, "name": "高级积分", "category": "数学"},
  "prerequisites": [
    {"id": 0, "name": "基础概念"},
    {"id": 1, "name": "导数"}
  ],
  "successors": [
    {"id": 7, "name": "微分方程"}
  ]
}
```

---

### 7.5 获取完整知识依赖图

```
GET /api/v1/kt/skill-graph
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "nodes": [
    {"id": 0, "name": "基础概念", "category": "数学"},
    {"id": 1, "name": "导数", "category": "数学"},
    ...
  ],
  "edges": [
    {"source": 0, "target": 1, "relation": "prerequisite"},
    {"source": 1, "target": 5, "relation": "prerequisite"},
    ...
  ]
}
```

---

## 8. 用户套餐 (Plan) — `/api/v1/plan`

### 8.1 获取所有套餐

```
GET /api/v1/plan/
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
[
  {
    "id": 1,
    "level": 1,
    "name": "基础版",
    "description": "适合个人学习",
    "price": 0,
    "api_limit_daily": 100,
    "token_limit_monthly": 10000,
    "kb_limit": 10,
    "model_access": "",
    "concurrent_limit": 1
  },
  {
    "id": 2,
    "level": 2,
    "name": "专业版",
    "description": "适合深度学习者",
    "price": 29.9,
    "api_limit_daily": 500,
    "token_limit_monthly": 50000,
    "kb_limit": 50,
    "model_access": "deepseek-chat,deepseek-reasoner",
    "concurrent_limit": 3
  }
]
```

---

### 8.2 获取我的套餐

```
GET /api/v1/plan/my-plan
```

**鉴权**: ✅ 需要

**成功响应** (200)：

```json
{
  "current_plan": {
    "level": 1,
    "name": "基础版",
    "api_limit_daily": 100,
    "token_limit_monthly": 10000,
    "expires_at": null
  },
  "available_upgrades": [
    {
      "id": 2,
      "level": 2,
      "name": "专业版",
      "price": 29.9,
      ...
    }
  ]
}
```

---

## 9. 系统

### 9.1 健康检查

```
GET /health
```

**无需鉴权**

**成功响应** (200)：

```json
{
  "status": "degraded",
  "skills_count": 9,
  "model_loaded": false
}
```

| 状态 | 含义 |
|------|------|
| `healthy` | 所有组件正常 |
| `degraded` | LEKT 模型未加载（NumPy fallback 可用） |
| `unhealthy` | 关键组件不可用 |

---

## 存储机制说明

### 会话历史存储

聊天记录采用 **Redis + 本地文件双写** 策略：

- **Redis**: 作为热存储，读取速度快，按 `chat:history:{user_id}:{session_id}` 键存储
- **本地文件**: 作为持久化备份，存储路径 `storage/{user_id}/history/{session_id}.json`
- **读取回退**: 优先从 Redis 读取；若 Redis 数据丢失，自动从文件恢复
- **Redis RDB 持久化**: 服务端配置为每 60 秒至少 1 次写入时自动快照

### 文件存储

- **原始文件**: `storage/{user_id}/original/`
- **解析缓存**: `storage/{user_id}/parsed/`
- 启用 OSS 后可切换至云存储

### 上传去重

基于 SHA256 哈希的全局去重，记录存储在 `upload_hashes.json`。

---

## 快速测试

```bash
# 健康检查
curl http://127.0.0.1:8765/health

# 注册
curl -X POST http://127.0.0.1:8765/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456","nickname":"测试用户"}'

# 登录（记录返回的 access_token）
curl -X POST http://127.0.0.1:8765/api/v1/auth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=test@test.com&password=123456"

# 获取用户信息（替换 YOUR_TOKEN）
curl http://127.0.0.1:8765/api/v1/auth/users/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# 发送聊天消息（SSE 流式）
curl -X POST http://127.0.0.1:8765/api/v1/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"你好","stream":true}'

# 上传文档
curl -X POST http://127.0.0.1:8765/api/v1/kb/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@notes.txt"

# 获取文档列表
curl http://127.0.0.1:8765/api/v1/kb/documents \
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取首页建议
curl http://127.0.0.1:8765/api/v1/dashboard/suggestions \
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取知识图谱
curl http://127.0.0.1:8765/api/v1/kt/skill-graph \
  -H "Authorization: Bearer YOUR_TOKEN"