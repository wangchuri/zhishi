import { describe, expect, it } from "vitest"
import { MAX_HEIGHT, wrapInlineHtml } from "./inlineHtmlDoc"

/**
 * 内联图示的缩放靠 iframe 里的 fit 脚本，手机上曾经出现过「内容超出屏幕」：
 * - iframe 文档没有 viewport meta，iOS 会把布局视口当 980px，缩放算错；
 * - 外层宽度变了（旋转/键盘/面板换位）不重新算缩放，仍按旧宽度缩放；
 * - `<svg viewBox>` 不带 width/height 时 CSS 算出高度 0，图直接不见。
 * 这里守住这几个点。
 */
describe("wrapInlineHtml", () => {
  const doc = wrapInlineHtml('<div style="width:640px">x</div>', MAX_HEIGHT)

  it("带上 viewport meta，避免 iOS 把 iframe 布局视口当 980px", () => {
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
  })

  it("按 documentElement.clientWidth 算可用宽度，而不是 innerWidth", () => {
    expect(doc).toContain("document.documentElement.clientWidth")
    expect(doc).not.toContain("window.innerWidth)")
  })

  it("监听宽度变化（resize / 父页面 refit 消息）后重新缩放", () => {
    expect(doc).toContain("addEventListener('resize', refit)")
    expect(doc).toContain("zhishi-inline-html-refit")
    expect(doc).toContain("zhishi-inline-html-height")
  })

  it("无尺寸的 svg 按 viewBox 比例补上尺寸", () => {
    expect(doc).toContain("viewBox")
    expect(doc).toContain("data-zhishi-sized")
    // 必须走 inline style，否则会被样式表里的 svg{height:auto} 盖掉
    expect(doc).toContain("s.style.height=")
  })

  it("最大高度取自入参", () => {
    expect(doc).toContain(`var MAX_H=${MAX_HEIGHT}`)
  })

  it("片段原样放进容器", () => {
    expect(doc).toContain('<div id="zhishi-inline-fit"><div style="width:640px">x</div></div>')
  })
})
