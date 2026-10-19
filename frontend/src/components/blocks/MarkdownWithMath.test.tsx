import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"

/**
 * 回归：选项里的 LaTeX 必须渲染成公式，而不是把 $...$ 源码原样吐出来。
 * 曾经 QuizQuestionDetailPage / 笔记里的选择题选项是纯文本渲染，导致
 * 「$\lim\limits_{x\to a}\dfrac{f'(x)}{F'(x)}$」整段源码显示在选项里。
 */
describe("MarkdownWithMath 选项公式渲染", () => {
  const OPTION_C = String.raw`若 $\lim\limits_{x\to a}\dfrac{f'(x)}{F'(x)}$ 存在（或为 $\infty$），则原极限存在且等于该值`

  it("选项文本里的 LaTeX 渲染成 katex，视觉层不残留 $ 源码", () => {
    const { container } = render(<MarkdownWithMath>{OPTION_C}</MarkdownWithMath>)
    expect(container.querySelector(".katex")).toBeTruthy()
    // KaTeX 输出分两层：.katex-mathml（保留源码，供无障碍/复制）
    // 和 .katex-html（真正画出来的），要看视觉层
    const htmlLayer = container.querySelector(".katex-html")
    expect(htmlLayer).toBeTruthy()
    expect(htmlLayer?.textContent || "").not.toContain("$")
    expect(htmlLayer?.textContent || "").not.toContain("\\")
  })

  it("裸 LaTeX（不带 $）也会被包成公式", () => {
    const { container } = render(
      <MarkdownWithMath>{String.raw`洛必达：\frac{0}{0} 型才能用`}</MarkdownWithMath>
    )
    expect(container.querySelector(".katex")).toBeTruthy()
  })

  it("行内选项样式（inline）不影响公式渲染", () => {
    const { container } = render(
      <MarkdownWithMath
        proseClass="prose prose-sm max-w-none inline prose-p:inline prose-p:my-0"
        className="inline"
      >
        {String.raw`$\frac{f'(x)}{F'(x)}$ 有定义`}
      </MarkdownWithMath>
    )
    expect(container.querySelector(".katex")).toBeTruthy()
  })
})
