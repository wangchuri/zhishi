import { useEffect, type ReactNode } from "react"
import { useUI } from "@/context/UIContext"
import { RailOverlay } from "./RailOverlay"

interface RightPanelProps {
  title?: string
  children?: ReactNode
}

/** 页面自定义右侧栏。无 children 时不渲染。与顶栏按钮共用同一层覆盖弹出。 */
export function RightPanel({ title, children }: RightPanelProps) {
  const { rightPanelOpen, setRightPanelOpen, registerRightPanel } = useUI()

  useEffect(() => registerRightPanel(), [registerRightPanel])

  if (!children) return null

  return (
    <RailOverlay
      open={rightPanelOpen}
      title={title || "上下文"}
      onClose={() => setRightPanelOpen(false)}
    >
      {children}
    </RailOverlay>
  )
}
