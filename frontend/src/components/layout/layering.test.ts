import { describe, expect, it } from "vitest"

import appShellSrc from "../../components/layout/AppShell.tsx?raw"
import dialogSrc from "../../components/ui/dialog.tsx?raw"
import topbarSrc from "../../components/layout/Topbar.tsx?raw"

/**
 * 层级防回归：模态一开，页面骨架（顶栏 / 侧栏 / 底部 tab）必须在遮罩之下。
 *
 * 这个坑踩过两次（顶栏曾用 z-[55]，比弹层的 z-50 还高 → 遮罩像被咬掉一条）。
 * 组件层级的 z-index 用 `tsc` 查不出来，单测里也没法量样式，所以直接读源码比对。
 */
function topbarZ(): number {
  const m = /<header[\s\S]*?z-\[(\d+)\]/.exec(topbarSrc)
  if (!m) throw new Error("Topbar.tsx 的 <header> 上找不到 z-[NN]")
  return Number(m[1])
}

function sidebarDrawerZ(): number {
  const m = /transition-all duration-200 z-(\d+)/.exec(appShellSrc)
  if (!m) throw new Error("AppShell.tsx 里找不到侧栏抽屉的 z-index")
  return Number(m[1])
}

function dialogLayerZ(): { overlay: number; content: number } {
  const overlay = /fixed inset-0 z-(\d+)/.exec(dialogSrc)
  const content = /left-\[50%\] z-(\d+)/.exec(dialogSrc)
  if (!overlay || !content) throw new Error("dialog.tsx 里找不到遮罩/内容的 z-index")
  return { overlay: Number(overlay[1]), content: Number(content[1]) }
}

describe("层级：顶栏与弹层", () => {
  const bar = topbarZ()
  const drawer = sidebarDrawerZ()
  const dialog = dialogLayerZ()

  it("顶栏必须低于弹层（否则遮罩盖不住顶栏）", () => {
    expect(bar).toBeLessThan(dialog.overlay)
    expect(bar).toBeLessThan(dialog.content)
  })

  it("顶栏仍要高于侧栏抽屉（保持现在的观感）", () => {
    expect(bar).toBeGreaterThan(drawer)
  })
})
