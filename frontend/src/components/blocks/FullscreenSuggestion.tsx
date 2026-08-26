import { useState } from "react"
import { Maximize } from "lucide-react"
import { useFullscreen } from "@/hooks/useFullscreen"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const DISMISS_KEY = "zhishi_fs_suggested"

/**
 * 首次打开（本标签页会话）且未全屏时，建议进入全屏。
 * 桌面/平板均可触发；关闭或进入后本会话不再打扰，顶栏常驻切换按钮。
 */
export function FullscreenSuggestion() {
  const { isFs, enter } = useFullscreen()
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "1"
  )

  const show =
    !isFs && !dismissed && !!document.fullscreenEnabled

  const handleEnter = () => {
    enter()
    sessionStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  const handleClose = () => {
    sessionStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  return (
    <Dialog open={show} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>建议全屏使用</DialogTitle>
          <DialogDescription>
            全屏模式隐藏地址栏，阅读与刷题体验更沉浸。之后可在右上角随时切换。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose}>
            知道了
          </Button>
          <Button variant="primary" onClick={handleEnter}>
            <Maximize className="w-4 h-4 mr-1" strokeWidth={2} />
            进入全屏
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
