import { describe, expect, it } from "vitest"
import { maskStreamingHtml } from "./streamingHtmlMask"

/**
 * 流式输出时不能把 ```html 源码直接甩给用户看：
 * 未写完的块要藏起来并提示「正在绘图」，写完的块也先占位，等消息结束再渲染成图。
 */
describe("maskStreamingHtml", () => {
  it("没有代码块时原样返回", () => {
    const r = maskStreamingHtml("普通文字，没有代码")
    expect(r.text).toBe("普通文字，没有代码")
    expect(r.drawing).toBe(false)
  })

  it("未闭合的 ```html 块被隐藏，并标记正在绘图", () => {
    const r = maskStreamingHtml("看这张图：\n```html\n<svg width=\"40\"><circle/></svg>")
    expect(r.drawing).toBe(true)
    expect(r.text).not.toContain("<svg")
    expect(r.text).toContain("看这张图")
  })

  it("已闭合的 ```html 块隐藏并提示稍后显示", () => {
    const r = maskStreamingHtml("看这张图：\n```html\n<svg/>\n```\n后面还有话")
    expect(r.drawing).toBe(false)
    expect(r.text).not.toContain("<svg")
    expect(r.text).toContain("输出结束后显示")
    expect(r.text).toContain("后面还有话")
  })

  it("普通代码块（js）不受影响", () => {
    const src = "```js\nconst a = 1\n```"
    const r = maskStreamingHtml(src)
    expect(r.text).toContain("const a = 1")
    expect(r.drawing).toBe(false)
  })

  it("大小写语言标记也识别", () => {
    const r = maskStreamingHtml("```HTML\n<div>x</div>\n```")
    expect(r.text).not.toContain("<div>")
  })
})
