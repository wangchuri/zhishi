import os
import urllib.parse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "your-very-secret-key")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

# 项目根目录（zhishi/），无论从 backend/ 还是仓库根启动均可解析
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_REPO_ROOT = _BACKEND_DIR.parent
_DEFAULT_SQLITE_PATH = _REPO_ROOT / "data" / "zhishi.db"


def _default_database_url() -> str:
    return f"sqlite:///{_DEFAULT_SQLITE_PATH.as_posix()}"


SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", _default_database_url())

# MySQL 连接参数（仅当 DATABASE_URL 未设置且需回退 MySQL 时使用；团队环境请直接设 DATABASE_URL）
password = urllib.parse.quote_plus(os.getenv("DB_PASSWORD", "@430524Lj"))
host = os.getenv("DB_HOST", "127.0.0.1")
port = os.getenv("DB_PORT", "3306")
db_name = os.getenv("DB_NAME", "my_ai_app")
user = os.getenv("DB_USER", "root")

# SMTP 邮件配置
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "your-email@gmail.com")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "your-app-password")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USER)
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Zhishi Backend")

# 邮箱验证码有效期（分钟）
EMAIL_VERIFICATION_EXPIRE_MINUTES = int(os.getenv("EMAIL_VERIFICATION_EXPIRE_MINUTES", 15))

# 密码重置链接有效期（分钟）
PASSWORD_RESET_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_EXPIRE_MINUTES", 30))

# 应用前端 URL（用于验证链接）
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Dify 知识库配置
DIFY_BASE_URL = os.getenv("DIFY_BASE_URL", "https://api.dify.ai/v1")
DIFY_DATASET_API_KEY = os.getenv("DIFY_DATASET_API_KEY", "dataset-bql2uhoANu9lXjJNuqou1Zm8")
DIFY_INDEXING_TECHNIQUE = os.getenv("DIFY_INDEXING_TECHNIQUE", "high_quality")
DIFY_PROCESS_RULE = {
    "rules": {
        "pre_processing_rules": [
            {"id": "remove_extra_spaces", "enabled": True},
            {"id": "remove_urls_emails", "enabled": True},
        ],
        "segmentation": {"separator": "###", "max_tokens": 512},
    },
    "mode": "custom",
}

# Dify 嵌入模型 & Rerank 配置
DIFY_EMBEDDING_MODEL = os.getenv("DIFY_EMBEDDING_MODEL", "multimodal-embedding-v1")
DIFY_EMBEDDING_MODEL_PROVIDER = os.getenv("DIFY_EMBEDDING_MODEL_PROVIDER", "tongyi")
DIFY_RERANKING_PROVIDER = os.getenv("DIFY_RERANKING_PROVIDER", "tongyi")
DIFY_RERANKING_MODEL = os.getenv("DIFY_RERANKING_MODEL", "gte-rerank")

# 欢迎文档路径（相对于 kt_backend 目录）
WELCOME_DOC_PATH = os.getenv("WELCOME_DOC_PATH", "docs/欢迎使用知拾.md")

# 文件存储配置
USE_OSS = os.getenv("USE_OSS", "false").lower() == "true"
LOCAL_STORAGE_DIR = os.getenv("LOCAL_STORAGE_DIR", "storage")

# Cloudflare Tunnel 演示环境文件大小上限（字节）
DEBUG_MAX_UPLOAD_SIZE = int(os.getenv("DEBUG_MAX_UPLOAD_SIZE", 10 * 1024 * 1024))  # 10MB

# 百度 OCR 配置（从 zhishi_app/assets/config/baidu_ocr.json 读取）
import json as _json
from pathlib import Path as _Path
_ocr_config_path = _Path(__file__).resolve().parent.parent.parent.parent / "zhishi_app" / "assets" / "config" / "baidu_ocr.json"
try:
    with open(_ocr_config_path, "r", encoding="utf-8") as _f:
        _ocr_cfg = _json.load(_f)
    BAIDU_OCR_API_KEY = os.getenv("BAIDU_OCR_API_KEY", _ocr_cfg.get("api_key", ""))
    BAIDU_OCR_SECRET_KEY = os.getenv("BAIDU_OCR_SECRET_KEY", _ocr_cfg.get("secret_key", ""))
    BAIDU_OCR_API_URL = os.getenv("BAIDU_OCR_API_URL", _ocr_cfg.get("api_url", "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic"))
except Exception:
    BAIDU_OCR_API_KEY = os.getenv("BAIDU_OCR_API_KEY", "")
    BAIDU_OCR_SECRET_KEY = os.getenv("BAIDU_OCR_SECRET_KEY", "")
    BAIDU_OCR_API_URL = os.getenv("BAIDU_OCR_API_URL", "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic")
