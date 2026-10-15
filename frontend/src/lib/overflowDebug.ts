import { useEffect } from "react"

/**
 * 自用的「谁把页面顶宽了」探测工具。
 *
 * 手机上出现横向滚动条、但在代码里找不到是谁溢出时：在地址后加 `?overflow=1` 打开页面，
 * 所有超出视口右边界的元素会被描红，控制台还会打印一份带 class 名与右边距的表格。
 * 看完刷新即可去掉（参数去掉就失效，不影响正常使用）。
 *
 * 只统计「能撑宽页面」的元素：
 * - 跳过 `position: fixed` 及其后代（手机抽屉、tab 栏在视口外是正常现象）；
 * - 跳过祖先已经裁剪掉的子树（祖先 `overflow-x != visible`，如 KaTeX 的 MathML 无障碍层
 *   `width:1px; overflow-x:hidden`）——它们撑不宽页面，只会把结果刷屏；
 * - 跳过 `aria-hidden="true"` 的子树（关掉的抽屉/弹窗）。
 * 走到 `main` 就停：`main` 自己有 `overflow-y-auto`，它里面溢出**是真 bug**（会出滚动条）。
 */
export function useOverflowDebug(active: boolean, key?: string) {
  useEffect(() => {
    if (!active) return
    // 等布局稳定（图片、字体、异步列表渲染完）再量
    const timer = window.setTimeout(() => {
      const vw = document.documentElement.clientWidth
      const bad: HTMLElement[] = []

      const isContained = (el: HTMLElement): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (p.tagName === "MAIN" || p === document.body) return false
          if (p.getAttribute("aria-hidden") === "true") return true
          const cs = getComputedStyle(p)
          if (cs.position === "fixed") return true
          if (cs.overflowX !== "visible") return true
        }
        return false
      }

      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        if (r.right <= vw + 1 && r.left >= -1) return
        if (isContained(el)) return
        bad.push(el)
      })

      bad.forEach((el) => {
        el.style.outline = "2px solid #e5484d"
        el.style.outlineOffset = "-1px"
      })

      console.warn(
        `[overflow] 视口 ${vw}px / 文档宽 ${document.documentElement.scrollWidth}px / 溢出元素 ${bad.length} 个`,
      )
      if (bad.length) {
        console.table(
          bad.slice(0, 25).map((el) => ({
            标签: el.tagName.toLowerCase(),
            class: String(el.className || "").slice(0, 80),
            右边: Math.round(el.getBoundingClientRect().right),
            宽: Math.round(el.getBoundingClientRect().width),
          })),
        )
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [active, key])
}
