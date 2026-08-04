import { useCallback, useEffect, useState } from "react"

/**
 * 浏览器全屏（Fullscreen API）封装。
 * 通过 document.fullscreenchange 保持状态同步。
 */
export function useFullscreen() {
  const [isFs, setIsFs] = useState(() => !!document.fullscreenElement)

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  const enter = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {})
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [])

  return { isFs, enter, exit, toggle }
}
