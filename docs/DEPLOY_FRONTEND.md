# 前端部署交接单（给有服务器操作权的人 / 服务器 agent）

> 本文只讲**把新的前端产物放到服务器上并验证**。最近几轮改动**全在前端**，后端不用重启。
> 当前待部署版本：**`2cf1681`**（`origin/master`）

---

## 0. 一句话背景

后端是按「同一进程托管前端静态产物 + `/api/v1/*`」跑的：

- 源码方式运行（`python -m src.main`）：静态目录 = **`<服务器上的仓库目录>/frontend/dist`**
  （见 `backend/src/core/paths.py` 的 `frontend_dist_dir()` = `runtime_dir()/frontend/dist`）
- PyInstaller 打包运行：静态目录 = **exe 同级的 `frontend_dist/`**

所以部署 = **把新构建出来的 `dist/` 换上去**，不需要重启后端（FastAPI 的 `StaticFiles` 每次请求读盘；`index.html` / `sw.js` 本来就是 `no-store`）。

---

## 1. 在本地构建（在开发机上跑）

```powershell
cd <仓库>/frontend
npm ci                      # 或 npm install
npm run build               # 产物：<仓库>/frontend/dist
```

产物自检（应该有 `index.html`、`sw.js`、`manifest.webmanifest`、`assets/*.js|css`）：

```powershell
Get-ChildItem dist | Select-Object Name, Length
Select-String -Path dist/assets/*.js -Pattern "查看这道题的作答记录" -List   # 应命中，确认是本轮产物
```

---

## 2. 上传（二选一）

### 方案 A：服务器上有仓库 + 有 node（推荐，最省事）

```bash
ssh ubuntu@<服务器>
cd <服务器上的仓库目录>
git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 pull --ff-only
cd frontend && npm ci && npm run build
```

### 方案 B：只上传产物（服务器上没有 node）

本地打包：

```powershell
cd <仓库>
$hash = git rev-parse --short HEAD
Compress-Archive -Path frontend\dist\* -DestinationPath "zhishi-frontend-$hash.zip" -Force
```

服务器上**先备份再替换**（关键，便于回滚）：

```bash
cd <服务器上的仓库目录>/frontend
mv dist "dist.bak-$(date +%Y%m%d-%H%M)"
mkdir dist
# 把 zip 传到服务器后：
cd dist && unzip -o ~/zhishi-frontend-<hash>.zip && cd ..
ls dist/index.html dist/assets | head
```

> 别把 zip 解到 `dist/` 外层，否则会出现 `dist/dist/...`。

---

## 3. 验证（三条，30 秒）

```bash
# ① 服务活着
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7777/            # 期望 200

# ② 新产物确实生效（换成你这次的 hash 文件名，或直接 grep 新文案）
curl -s http://127.0.0.1:7777/ | grep -o 'assets/[^"]*\.js' | head

# ③ 接口正常
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7777/api/v1/auth/me   # 期望 200 或 401（未登录），不是 500
```

**浏览器侧**：手机/电脑上如果还看到旧界面，说明浏览器握着旧 Service Worker —— 访问一次 **`/api/v1/pwa-reset`** 再刷新即可（不要只用 `Ctrl+F5` 对付 SW）。

---

## 4. 回滚（1 条命令）

```bash
cd <服务器上的仓库目录>/frontend
mv dist "dist.failed-$(date +%s)"
mv dist.bak-<刚才备份的后缀> dist
```

无需重启后端，刷新即可回到上一版。

---

## 5. 本次部署后应看到的变化（便于肉眼确认）

| 区域 | 变化 |
| --- | --- |
| 辅导面板 | 标题左侧的青绿圆形图标**没了**，只有「AI辅导」文字；每条 AI 回复旁边的小头像**也没了** |
| 资料页（手机） | 卡片封面左上角**没有**按钮（只剩右上角进度角标）；「重新解析 / 删除」在卡片底部信息行右侧 |
| 答题页（手机） | 顶部「题目 / 辅导」二选一；点「我不会」「标记为不会」会**自动切到辅导** |
| 答题反馈底部 | 多了一个「查看这道题的作答记录」入口 |
| 图片放大 | 全屏灯箱（Esc / ✕ / 点背景都能关） |
| 传图 | 超大图会先压缩；选到非图片会提示「只能上传图片文件…」；断网会提示「连不上服务器…」 |

---

## 6. 服务器侧仍需确认（与本轮部署无关，但一直悬着）

1. Let's Encrypt **IP 证书 160 小时续期** + deploy-hook 里 reload 服务；
2. 反代透传 **`X-Forwarded-Proto: https`**；
3. **80 端口**只用于 ACME；
4. 若提供 HTTPS 且要跑 APK（Capacitor 壳），`ZHISHI_SERVER_URL` 必须用 `https://`。

> 这些都是「已经在服务器上配过、但需要在续期/变更时别踩坑」的项，不属于本次前端部署范围。
