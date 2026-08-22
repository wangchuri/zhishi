import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTinaCrisis } from "@/context/TinaCrisisContext"

/** `/tina?` 之后困在对话页，刷新整页才恢复。 */
export function TinaCrisisLock() {
  const { active, escaping } = useTinaCrisis()
  const location = useLocation()
  const navigate = useNavigate()
  const trapped = active || escaping

  useEffect(() => {
    if (!trapped) return
    if (location.pathname !== "/chat") {
      navigate("/chat", { replace: true })
    }
  }, [trapped, location.pathname, navigate])

  return null
}
