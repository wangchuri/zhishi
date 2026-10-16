import { useEffect, useState } from "react"

/**
 * 软键盘在**布局之外**又挡住的高度（px）。
 *
 * 手机键盘不改 `dvh`：浏览器 UI 变化才改 dvh，键盘压小的是 **visual viewport**。
 * 所以固定高度的聊天面板（`h-dvh` + 内部滚动）不会跟着变矮 —— 表现就是
 * 「输入框被顶上来了一点，但消息还压在键盘下面」。
 *
 * 这里算的是「布局已经缩过之后，还差多少」，所以：
 * - 系统真的把 WebView 缩了（Android `adjustResize` / `interactive-widget=resizes-content`）→ 结果为 0，不会重复补偿；
 * - 键盘只是盖在上面（Android 15 边到边、iOS）→ 结果 ≈ 键盘高度，拿去当 paddingBottom 用。
 *
 * @param innerHeight window.innerHeight（布局视口高度）
 * @param view visualViewport 的高度 / 偏移 / 缩放
 */
export function keyboardInsetFrom(
  innerHeight: number,
  view: { height: number; offsetTop?: number; scale?: number },
): number {
  // 捏合缩放时 vv.height 也会变小，那不是键盘
  if ((view.scale ?? 1) > 1.05) return 0
  const hidden = innerHeight - view.height - (view.offsetTop ?? 0)
  // < 100px 的差异当浏览器地址栏/工具栏抖动（键盘一般 250~350px）
  return hidden > 100 ? Math.round(hidden) : 0
}

/** 见 keyboardInsetFrom；跟随 visualViewport 变化实时返回。 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let raf = 0
    const update = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setInset(keyboardInsetFrom(window.innerHeight, vv))
      })
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [])

  return inset
}
