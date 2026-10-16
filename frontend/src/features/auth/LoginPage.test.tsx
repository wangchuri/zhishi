import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LoginPage } from "./LoginPage"

/**
 * 登录页的**移动端**行为防回归。
 *
 * 这页是手机上的第一屏，但它的坑全都不是"看渲染对不对"能发现的：
 *  - iOS 在 <16px 的输入框聚焦时会**自动放大页面**（且不还原）；
 *  - 移动键盘默认首字母大写 / 自动纠错 → 用户名被改成 Wangchuri 之类；
 *  - viewport-fit=cover 下不给安全区，logo 顶到刘海、按钮压在手势条上；
 *  - 固定高度 + 父级居中，软键盘弹出时按钮被盖住且**滚不到**。
 * 所以这里直接断言类名/属性/内联样式。
 */
const loginMock = vi.fn()
const setupMock = vi.fn()

vi.mock("@/lib/api", () => ({
  isServerConfigured: () => true,
}))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    authPhase: "need_login",
    login: loginMock,
    setupAccount: setupMock,
  }),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe("登录页（移动端）", () => {
  beforeEach(() => {
    loginMock.mockReset()
    setupMock.mockReset()
  })

  it("输入框字号 ≥16px：否则 iOS 聚焦时会自动放大整页", () => {
    renderLogin()
    const username = screen.getByPlaceholderText("用户名")
    const password = screen.getByPlaceholderText("密码")
    for (const input of [username, password]) {
      expect(input.className).toContain("text-[16px]")
    }
    // 桌面端维持原来的 15px
    expect(username.className).toContain("sm:text-body")
  })

  it("输入框在手机上是 48px 高（手指点得动）", () => {
    renderLogin()
    expect(screen.getByPlaceholderText("用户名").className).toContain("h-12")
  })

  it("用户名不自动大写 / 不自动纠错；用对自动填充与回车键", () => {
    renderLogin()
    const username = screen.getByPlaceholderText("用户名")
    expect(username.getAttribute("autocapitalize")).toBe("none")
    expect(username.getAttribute("autocorrect")).toBe("off")
    expect(username.getAttribute("spellcheck")).toBe("false")
    expect(username.getAttribute("autocomplete")).toBe("username")
    expect(username.getAttribute("enterkeyhint")).toBe("next")

    const password = screen.getByPlaceholderText("密码")
    expect(password.getAttribute("autocomplete")).toBe("current-password")
    expect(password.getAttribute("enterkeyhint")).toBe("go") // 键盘上直接是"进入"
  })

  it("容器用 dvh + 滚动 + 安全区，键盘弹出时按钮还能滚到", () => {
    const { container } = renderLogin()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("min-h-dvh")
    expect(root.className).toContain("overflow-y-auto")
    expect(root.style.paddingTop).toContain("env(safe-area-inset-top)")
    expect(root.style.paddingBottom).toContain("env(safe-area-inset-bottom)")
  })

  it("主按钮是 submit（手机上按键盘「进入」能提交）", () => {
    renderLogin()
    expect(screen.getByRole("button", { name: /登录/ }).getAttribute("type")).toBe("submit")
  })
})
