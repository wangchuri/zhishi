import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

/** 画像已并入设置页，保留路由以免旧链接失效。 */
export function ProfilePage() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate("/settings", { replace: true })
  }, [navigate])
  return null
}
