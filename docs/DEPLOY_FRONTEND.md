# 前端部署交接单（给有服务器操作权的人 / 服务器 agent）

> 本文只讲**把新的前端产物放到服务器上并验证**。
> 当前待部署版本：**`1a4d1c5`**（`origin/master`）
> ⚠️ 本轮**后端也要重启一次**（`a58fb6f` 动了 8 个后端文件：题目难度字段、会话创建参数、出题工具的 `difficulty`），
> 前端产物本身不需要重启后端，但**没重启过后端的话，难度筛选/多章节等新参数不会生效**。

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
Select-String -Path dist/assets/*.js -Pattern "本次将刷" -List   # 应命中，确认是本轮产物（刷题浮窗）
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
| 资料页（书详情） | 原来的「从头开始 / 未做 / 错题 / 不会」+「试卷模式」两块面板**没了**，变成一个「**刷题**」按钮 |
| 刷题浮窗 | 点开后是**宽浮窗**：章节 / 题型 / 难度 / 知识点 / 数量与分布，默认全选；选中是**浅青底 + ✓**（不是深色实心）；底部写「本次将刷：… 共 10 题」 |
| 难度 | 老题没有难度标注 → **难度那一段不出现**；重新出题后新题会带难度，那一段自动出现 |
| 顶栏 | 打开任意弹窗时，**顶栏也会被遮罩压暗**（原来它压在遮罩上面） |
| 「查看题目」弹窗 | 变宽（672px；原来写的是 672 但一直没生效，实际只有 512） |
| 其余 | 与上一轮相同（辅导面板无头像、资料卡片按钮位置、答题页「作答记录」入口、图片灯箱等） |

---

## 6. 服务器侧仍需确认（与本轮部署无关，但一直悬着）

1. Let's Encrypt **IP 证书 160 小时续期** + deploy-hook 里 reload 服务；
2. 反代透传 **`X-Forwarded-Proto: https`**；
3. **80 端口**只用于 ACME；
4. 若提供 HTTPS 且要跑 APK（Capacitor 壳），`ZHISHI_SERVER_URL` 必须用 `https://`。

> 这些都是「已经在服务器上配过、但需要在续期/变更时别踩坑」的项，不属于本次前端部署范围。
