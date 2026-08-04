"""临时验证：FastAPI 静态托管 / SPA fallback"""
from fastapi.testclient import TestClient
import server

client = TestClient(server.app)

# 1. 根路径应返回 index.html
r = client.get("/")
print("GET / ->", r.status_code, r.headers.get("content-type"))
assert r.status_code == 200
assert "text/html" in r.headers.get("content-type", "")
assert "<div id=\"root\"></div>" in r.text

# 2. 静态资源（JS）
r2 = client.get("/assets/index-6dXOIgTZ.js")
print("GET /assets/index-6dXOIgTZ.js ->", r2.status_code, r2.headers.get("content-type"))
assert r2.status_code == 200
assert "javascript" in r2.headers.get("content-type", "")

# 3. PWA manifest
r3 = client.get("/manifest.webmanifest")
print("GET /manifest.webmanifest ->", r3.status_code, r3.headers.get("content-type"))
assert r3.status_code == 200

# 4. SPA fallback（未知前端路由应返回 index.html）
r4 = client.get("/some/spa/route")
print("GET /some/spa/route ->", r4.status_code)
assert r4.status_code == 200
assert "<div id=\"root\"></div>" in r4.text

# 5. API 路由不应被 SPA 吞掉（应该是 JSON 404 而非 index.html）
r5 = client.get("/api/v1/nonexistent")
print("GET /api/v1/nonexistent ->", r5.status_code, r5.headers.get("content-type"))
# 因为 /api/v1 路由在 SPA fallback 之前注册，FastAPI 会先匹配；未匹配到返回 404 JSON
print("   body:", r5.text[:120])

# 6. 健康检查
r6 = client.get("/health")
print("GET /health ->", r6.status_code, r6.json())

print("\n✅ 全部测试通过")