# 复测单 · 第三轮：横向溢出 + 出题页手机端 + APK 图标

- **被测版本**：`master @ 5f47d83`（`origin/master`）
- **本轮改动**（全在前端，**后端不用重启**）：
  - `f61cac6` PageHeader 操作区不再顶宽页面
  - `7c08550` 出题页手机端三栏不再被裁
  - `e9fb7e6` 新增 `?overflow=1` 溢出探测（开发自用，不影响正常使用）
  - `5f47d83` APK 应用图标/启动图素材 + CI 生成步骤
- **执行人**：有浏览器 / Playwright 的 QA（本轮**全部可在桌面设备模拟下完成**，无真机项）
- **目标**：把「手机上有横向滚动条但找不到是谁」一次性扫干净，并确认出题页在手机上可用。

---

## 0. 前置（不照做会看到旧界面，全组会假失败）

1. `cd frontend && npm ci && npm run build`，把 `dist` 部署到被测实例（本地 17777 或 `python -m src.main` 直出）。
2. 访问一次 **`/api/v1/pwa-reset`** 清 Service Worker，再刷新。
3. **后端不用重启**（本轮没有后端改动）。
4. 视口：**390×844**（横向溢出只在窄屏暴露）；另外补 **1023 / 1024** 两个宽度只验断点。
5. 账号：`wangchuri / wc19967501986`。
6. 准备数据：**一份 10 页以上的资料**（页码栏限高要用到）；一条进行中的刷题会话（刷题页要看）。

---

## A. 横向溢出大扫除（本轮核心）

### 怎么用探测工具

在**任意页面地址后加 `?overflow=1`**，等约 1 秒：

- 所有**右边超出视口**的元素会被**描红**（红色描边）；
- 控制台（F12 ▸ Console）会打印一行汇总 + 一张表：`标签 / class / 右边 / 宽`。

原理与边界（避免误报/漏报）：

- 它会**跳过 `position: fixed` 的子树**（手机抽屉、底部 tab 栏在视口外属正常，不报）；
- 页面**滚动到底部**后它会因 SPA 路由变化重新扫，但**懒加载内容**可能要手动再切一次页/刷新再扫；
- **弹窗、抽屉、侧栏打开后再扫一次**（这些是独立的 fixed 子树，需要单独确认它们自己没被撑宽）。

### 用例

| 编号 | 级别 | 步骤 | 预期 | 结果 |
| --- | --- | --- | --- | --- |
| A1 | P0 | 390 宽，逐页加 `?overflow=1` 打开下表**全部**路由 | 每页**没有元素被描红**，控制台显示「**溢出元素 0 个**」 | |
| A2 | P0 | 每页再滚动到底部 / 打开页内弹窗后重复一次 | 同上 | |
| A3 | P0 | 每页检查 `document.documentElement.scrollWidth === clientWidth`，且 `main` 不出现横向滚动条（`main.scrollWidth === main.clientWidth`） | 全部相等 | |

**A1/A2 要覆盖的路由**（按手机底部 tab + 抽屉能到达的全部入口）：

```
/                      首页
/chat                  Tina
/notes                 笔记
/notes/new             新建笔记
/notes/:noteId          笔记详情
/quiz                  资料
/quiz/ongoing          进行中的刷题列表
/quiz/doc/:docId       资料详情
/quiz/group/:groupId   资料组详情
/quiz/question/:qid    题目详情
/quiz/session          刷题（答题中）
/question-gen/doc/:id  出题
/tasks                 任务
/analytics             进度
/settings              设置
/profile               个人
/knowledge/upload      上传
/knowledge/doc/:docId  文档查看
/companion/doc/:docId  阅读
/doc-parse             扫描件解析（导航里已隐藏，直链可达，可只跑一次）
/training/targeted     专项训练
```

> 若某页出现描红：**截图**（能看到红色描边）+ 把控制台表格里对应那行的 **class 名**抄下来。溢出的行我必须有 class 名才能改，光有页面截图改不动。

---

## B. PageHeader（页头操作区）手机端

| 编号 | 级别 | 步骤 | 预期 | 结果 |
| --- | --- | --- | --- | --- |
| B1 | P0 | 390 宽打开「资料」页 | 标题「资料」**单独一行**；「新建资料组」「上传」两个按钮在**下一行**，都**完整可见、可点**（改动前「上传」被切掉） | |
| B2 | P0 | 390 宽打开「出题页」`/question-gen/doc/:id` | 同上：文档名一行，「返回资料」「导出题库」在下一行，完整可见 | |
| B3 | P0 | 390 宽检查其他页头带按钮的页面：笔记 / 任务 / 进度 / 设置 / 个人 / 上传 | 标题与操作分两行，无按钮被切、无横向滚动条 | |
| B4 | P0 | **1024 宽**再看「资料」「出题」 | **仍是一行**（标题左、按钮右），与改动前一致（桌面不回归） | |
| B5 | P1 | 390 宽，标题很长的页面（长文档名的出题页） | 标题换行/截断得体，不把按钮挤出视口 | |

---

## C. 出题页手机端可用性

| 编号 | 级别 | 步骤 | 预期 | 结果 |
| --- | --- | --- | --- | --- |
| C1 | P0 | 390 宽打开 `/question-gen/doc/:id`（**10 页以上**的资料） | 能看到**页码栏**；**向下滚动可以到达「内容」与「出题」面板**（改动前三栏被裁掉、后两栏够不到） | |
| C2 | P0 | 看页码栏高度 | 高度 ≤ **45dvh**，页码列表在栏内**内部滚动**（不会把出题面板顶到很下面） | |
| C3 | P0 | 点「全选」/「清空」，再勾选若干页 | 选中态正常；中间「内容」面板跟着更新 | |
| C4 | P0 | 点「AI 批量出题」 | 出题面板可见、日志在面板内滚动，内容不被裁 | |
| C5 | P0 | **1024 宽**打开同一页 | 仍是**三栏并排**（页码 / 内容 / 出题），各自内部滚动（桌面不回归） | |
| C6 | P1 | 390 宽，页码栏与出题面板的分隔线 | 手机上是横线（`border-b`/`border-t`），不是竖线（`border-r`/`border-l`） | |

---

## D. APK 图标（可选，需要能跑 `npx`）

> 这块没法用浏览器验，只能验素材与生成流程；真机图标要等 CI 真跑一次。

| 编号 | 级别 | 步骤 | 预期 | 结果 |
| --- | --- | --- | --- | --- |
| D1 | P1 | 看 `frontend/resources/icon.png` | 1024×1024；画面为**品牌青底 + sage 圆角方块 + 白色书+放大镜**；**四角是青色（#1F5C5A），不是白色** | |
| D2 | P1 | 看 `frontend/resources/splash.png` | 2732×2732；纸色底（#F3EFE6）+ 居中图标 | |
| D3 | P1 | 看 `.github/workflows/android-apk.yml` | 在 `cap sync` 之后、gradle 之前，有 `npx --yes @capacitor/assets@3.0.5 generate --android ...` 一步 | |
| D4 | P1 | 本地复现生成（在 `frontend/`）：`npx cap add android && npx cap sync android && npx --yes @capacitor/assets@3.0.5 generate --android --iconBackgroundColor '#1F5C5A' --iconBackgroundColorDark '#1F5C5A' --splashBackgroundColor '#F3EFE6' --splashBackgroundColorDark '#F3EFE6'` | 命令成功；`android/app/src/main/res/` 下生成 `mipmap-*/ic_launcher*.png` 与自适应图标 xml | |
| D5 | P1 | 从上一步抽一张 `mipmap-xxxhdpi/ic_launcher.png`（或 `ic_launcher_foreground.png`）看一眼 | 是**知拾的书+放大镜**，**不是 Capacitor 默认图标** | |
| D6 | P2 | 若无法触发 CI（`workflow_dispatch`，需要仓库变量 `ZHISHI_SERVER_URL`） | 记「未覆盖」即可，**不要用桌面模拟结果顶替** | |

> D4 生成的 `frontend/android/` 是 `.gitignore` 里的产物，**不会被提交**，验完删掉即可。

---

## E. 仍未验证（上一轮遗留，无真机）

`A5` 点「+图片」是否弹系统选择器 · `A6`「拍照」是否调起后置相机 · `E4` 刘海屏安全区 · `J3` iOS Safari 登录/写操作。
**无实体机就标 🚫 阻塞**，不要用设备模拟顶替。

---

## F. 报 bug 要求（溢出类必须带这三样）

1. `?overflow=1` 的**描红截图**（要能看出红色描边在哪块）；
2. 控制台那张表的**对应行原文**（至少 class 名 + 右边 + 宽）；
3. **视口宽度**（例如 390 / 360 / 412）与页面路由。

其余沿用上轮模板（环境 / 复现步骤 / 期望 / 实际 / Console 报错 / Network）。

---

## G. 给 Agent 的脚本化做法（可选，比人肉看描红更彻底）

如果执行方是带 **Playwright MCP** 的 Agent（`browser_run_code_unsafe` 可直接跑 JS），
可以不依赖 `?overflow=1`，**一次调用扫完所有路由**并把结果打成表。逻辑与探测工具一致：

```js
// Playwright MCP: browser_run_code_unsafe
async (page) => {
  const origin = new URL(page.url()).origin
  const routes = ["/", "/chat", "/notes", "/quiz", "/quiz/ongoing", "/tasks",
                  "/analytics", "/settings", "/profile", "/knowledge/upload"]
  const rows = []
  for (const path of routes) {
    await page.goto(origin + path, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1200)
    // 滚到底触发懒加载，再量一次
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(600)
    rows.push(await page.evaluate((path) => {
      const vw = document.documentElement.clientWidth
      const main = document.querySelector("main")
      const inFixed = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
          if (getComputedStyle(p).position === "fixed") return true
        return false
      }
      const bad = []
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) return
        if (r.right <= vw + 1 && r.left >= -1) return
        if (inFixed(el)) return
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 80),
          right: Math.round(r.right),
          w: Math.round(r.width),
        })
      })
      return {
        path,
        vw,
        docW: document.documentElement.scrollWidth,          // 不等于 vw 就是有页面级横向溢出
        mainOverflow: main ? main.scrollWidth - main.clientWidth : null,
        badCount: bad.length,
        bad: bad.slice(0, 8),
      }
    }, path))
  }
  return rows
}
```

**读结果**：`docW > vw` 或 `mainOverflow > 0` 或 `badCount > 0` 就是失败项，
`bad[]` 里的 `cls` 就是我要的 class 名。

注意事项：

- 需要**已登录**状态；`/quiz/session`、`/quiz/doc/:id`、`/question-gen/doc/:id` 需要真实 id，
  路由表里按实际数据补全后再跑。
- 弹窗/抽屉类（如引用侧栏、题目列表弹窗）是独立 `fixed` 子树，**不会被上面的扫描覆盖**，
  需要单独 `browser_click` 打开后再跑一次同一段量测。
- 页面里有 iframe 的话（本应用没有），需要单独进 frame 量。

---

## H. 结果汇总

| 区块 | 条数 | 通过 | 失败 | 阻塞 | 备注 |
| --- | --- | --- | --- | --- | --- |
| A 横向溢出 | 3（×21 个路由） | | | | |
| B PageHeader | 5 | | | | |
| C 出题页手机端 | 6 | | | | |
| D APK 图标 | 6 | | | | |
| E 真机遗留 | 4 | | | | 无真机 |

**总评**：☐ 通过　☐ 有条件通过　☐ 不通过

**A 组扫出来的溢出清单**（有几条写几条，附 class 名）：

```
1.
2.
3.
```
