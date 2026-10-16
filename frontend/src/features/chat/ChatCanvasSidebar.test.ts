import { describe, expect, it } from "vitest"
import { wrapCanvasHtml } from "./ChatCanvasSidebar"

/**
 * 画布的适配脚本是拼在模板字符串里的 JS：
 * - TS 编译器**不会**检查它，写错了只在 iframe 里静默失败；
 * - 它决定"内容是否按窗口缩放"，之前就因为首次量得太早而出现
 *   「显示 100% 但没适配、要手动缩一档才好」。
 * 所以这里把生成的脚本抠出来做语法检查 + 断言关键触发器还在。
 */
describe("wrapCanvasHtml 生成的自适配脚本", () => {
  const html = wrapCanvasHtml("<div>hi</div>")
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ""

  it("脚本语法合法（只解析不执行）", () => {
    expect(script.length).toBeGreaterThan(0)
    expect(() => new Function(script)).not.toThrow()
  })

  it("内容变大后能重新适配：ResizeObserver / load / 图片 load", () => {
    expect(script).toContain("ResizeObserver")
    expect(script).toContain("addEventListener('load'")
    expect(script).toContain("querySelectorAll('img')")
  })

  it("保留按窗口计算 fit 的核心逻辑", () => {
    expect(script).toContain("window.innerWidth")
    expect(script).toContain("scrollWidth")
    expect(script).toContain("Math.min(1")
  })
})
