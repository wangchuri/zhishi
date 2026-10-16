import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { keyboardInsetFrom, useKeyboardInset } from "./useKeyboardInset"

describe("keyboardInsetFrom", () => {
  it("键盘只是盖在上面 → 返回键盘高度", () => {
    expect(keyboardInsetFrom(800, { height: 450 })).toBe(350)
  })

  it("布局已经跟着缩过（innerHeight 一起变小）→ 0，不重复补偿", () => {
    expect(keyboardInsetFrom(450, { height: 450 })).toBe(0)
  })

  it("浏览器地址栏/工具栏抖动（差异 < 100px）忽略", () => {
    expect(keyboardInsetFrom(800, { height: 740 })).toBe(0)
  })

  it("捏合缩放不算键盘", () => {
    expect(keyboardInsetFrom(800, { height: 450, scale: 1.5 })).toBe(0)
  })

  it("页面被 pan 上去时扣掉 offsetTop", () => {
    expect(keyboardInsetFrom(800, { height: 450, offsetTop: 100 })).toBe(250)
  })
})

describe("useKeyboardInset", () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport")

  afterEach(() => {
    if (original) Object.defineProperty(window, "visualViewport", original)
  })

  function fakeViewport(initial: { height: number; offsetTop?: number; scale?: number }) {
    const vv = new EventTarget() as EventTarget & {
      height: number
      offsetTop: number
      scale: number
    }
    vv.height = initial.height
    vv.offsetTop = initial.offsetTop ?? 0
    vv.scale = initial.scale ?? 1
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true })
    return vv
  }

  const nextFrame = () =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

  it("没有 visualViewport（老浏览器/桌面）→ 恒为 0", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true })
    const { result } = renderHook(() => useKeyboardInset())
    expect(result.current).toBe(0)
  })

  it("跟随 resize 实时更新（键盘弹起 → 让出高度；收起 → 归零）", async () => {
    const vv = fakeViewport({ height: window.innerHeight - 350 })
    const { result } = renderHook(() => useKeyboardInset())
    await nextFrame()
    expect(result.current).toBe(350)

    vv.height = window.innerHeight
    await act(async () => {
      vv.dispatchEvent(new Event("resize"))
    })
    await nextFrame()
    expect(result.current).toBe(0)
  })
})
